// How the visual editor shows a code block: its language in a small field above it (so a block
// made with the toolbar can be given one), the code as written, and, for a ```mermaid block, the
// diagram drawn live below it.
//
// The field and the preview are not part of the document: they are contenteditable=false, the
// editor ignores their events and DOM changes, and drawing never dispatches a transaction, so the
// markdown is exactly what it would be without them. Only typing a language changes the document
// (the block's `language`, written as its fence's info string).
//
// The diagram is drawn by src/mermaid.ts (its strict, locked config and SVG clean-up), imported
// the first time a mermaid block is shown: an edit without one never downloads mermaid. Drawing
// waits until typing stops for DEBOUNCE ms; one diagram is drawn at a time across the editor (a
// queue), and a block shows only its latest source's result. A source that doesn't parse keeps
// the last diagram drawn, with a short note of what is wrong.
import type { Node as ProseNode } from '@milkdown/prose/model';
import { TextSelection } from '@milkdown/prose/state';
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/prose/view';
import { fitDiagram } from '../components/MermaidDiagram';

const DEBOUNCE = 400;
const MAX_NOTE = 120;

let queue: Promise<unknown> = Promise.resolve();

/** `source` drawn after any drawing already asked for (mermaid's render is not safe to interleave). */
function draw(source: string): Promise<SVGSVGElement> {
  const run = queue.then(() => import('../mermaid')).then((m) => m.renderMermaid(source));
  queue = run.catch(() => {});
  return run;
}

/** mermaid's error as one short line (its first: "Parse error on line 2"), not its whole report. */
export function shortError(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const line = (text.split('\n').find((l) => l.trim() !== '') ?? '').trim().replace(/:$/, '');
  if (line === '') return "it couldn't be drawn";
  return line.length > MAX_NOTE ? `${line.slice(0, MAX_NOTE - 1)}…` : line;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** The diagram under a ```mermaid block. */
class MermaidPreview {
  readonly dom = el('div', 'wiki-mermaid-preview', { contenteditable: 'false', 'data-mermaid-preview': 'loading' });
  private readonly toggle = el('button', 'wiki-mermaid-toggle', { type: 'button' });
  private readonly box = el('div', 'wiki-mermaid-diagram');
  private readonly note = el('div', 'wiki-mermaid-note', { role: 'status' });
  private source: string | null = null;
  /** The source last asked to be drawn while shown; drawn results for anything else are dropped. */
  private wanted: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown = true;
  private drawn = false;
  private live = true;

  constructor() {
    const head = el('div', 'wiki-mermaid-head');
    head.append(Object.assign(el('span', 'wiki-mermaid-label'), { textContent: 'Diagram preview' }), this.toggle);
    this.toggle.addEventListener('click', () => this.setShown(!this.shown));
    // The note above the diagram, next to the code it is about.
    this.dom.append(head, this.note, this.box);
    this.setShown(true);
  }

  /** The block's code now; drawn at once the first time, then once typing stops. */
  update(source: string) {
    if (source === this.source) return;
    const first = this.source === null;
    this.source = source;
    clearTimeout(this.timer);
    if (this.shown) this.timer = setTimeout(() => this.render(), first ? 0 : DEBOUNCE);
  }

  private setShown(shown: boolean) {
    this.shown = shown;
    this.toggle.textContent = shown ? 'Hide preview' : 'Show preview';
    this.toggle.setAttribute('aria-expanded', String(shown));
    this.box.hidden = !shown || !this.drawn;
    this.note.hidden = !shown || this.note.textContent === '';
    this.dom.toggleAttribute('data-hidden', !shown);
    if (shown && this.source !== null && this.source !== this.wanted) this.render();
  }

  private state(s: 'loading' | 'drawn' | 'error' | 'empty', note = '') {
    this.dom.setAttribute('data-mermaid-preview', s);
    this.note.textContent = note;
    this.note.hidden = !this.shown || note === '';
    this.box.hidden = !this.shown || !this.drawn;
  }

  private render() {
    clearTimeout(this.timer);
    const source = this.source ?? '';
    this.wanted = source;
    if (source.trim() === '') {
      this.drawn = false;
      this.box.replaceChildren();
      this.state('empty', 'Write the diagram above to see it here.');
      return;
    }
    if (!this.drawn) this.state('loading', 'Drawing the diagram…');
    draw(source).then(
      (svg) => {
        if (!this.live || this.wanted !== source) return;
        fitDiagram(svg);
        this.box.replaceChildren(svg);
        this.drawn = true;
        this.state('drawn');
      },
      (err) => {
        if (!this.live || this.wanted !== source) return;
        this.state('error', `Diagram has an error: ${shortError(err)}`);
      },
    );
  }

  destroy() {
    this.live = false;
    clearTimeout(this.timer);
  }
}

export class CodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly pre: HTMLPreElement;
  private readonly language: HTMLInputElement;
  private preview: MermaidPreview | null = null;

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = el('div', 'wiki-code-block');
    this.bar = el('div', 'wiki-code-bar', { contenteditable: 'false' });
    this.language = el('input', 'wiki-code-language', { type: 'text', placeholder: 'language', 'aria-label': 'Code block language', spellcheck: 'false', autocomplete: 'off' });
    this.bar.append(this.language);
    this.pre = el('pre', '');
    this.contentDOM = el('code', '', { spellcheck: 'false' });
    this.pre.append(this.contentDOM);
    this.dom.append(this.bar, this.pre);

    this.language.addEventListener('input', () => this.setLanguage(this.language.value.replace(/\s+/g, '')));
    this.language.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'Escape') return;
      e.preventDefault();
      this.toCode();
    });
    this.show();
  }

  /** The language as typed: the block's `language` (an edit, undone like any other). */
  private setLanguage(language: string) {
    const pos = this.getPos();
    if (pos === undefined || language === this.node.attrs.language) return;
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'language', language));
  }

  /** Back from the language field to the start of the code. */
  private toCode() {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1)));
    this.view.focus();
  }

  private show() {
    const language = String(this.node.attrs.language ?? '');
    if (language) this.pre.dataset.language = language;
    else delete this.pre.dataset.language;
    // While it is being typed in, the field keeps what was typed.
    if (document.activeElement !== this.language && this.language.value !== language) this.language.value = language;
    if (language === 'mermaid') {
      if (!this.preview) {
        this.preview = new MermaidPreview();
        this.dom.append(this.preview.dom);
      }
      this.preview.update(this.node.textContent);
    } else if (this.preview) {
      this.preview.destroy();
      this.preview.dom.remove();
      this.preview = null;
    }
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.show();
    return true;
  }

  /** The field and the preview are the page's, not the editor's. */
  stopEvent(event: Event) {
    const target = event.target as Node | null;
    return !!target && (this.bar.contains(target) || !!this.preview?.dom.contains(target));
  }

  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target);
  }

  destroy() {
    this.preview?.destroy();
  }
}
