// The visual editor: Milkdown (ProseMirror) with the CommonMark and GFM presets, the wiki's own
// nodes for what markdown.ts reads (wiki links, embeds, comments, callout markers), house-style
// serialising, and the hooks the React side needs (`[[` opens the page picker, pasted or dropped
// images are handed over for upload).
import { Editor, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import { history } from '@milkdown/plugin-history';
import {
  commonmark,
  createCodeBlockCommand,
  remarkPreserveEmptyLinePlugin,
  toggleEmphasisCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark';
import { gfm, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import type { Node as ProseNode, NodeType } from '@milkdown/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { $node, $prose, $remark, callCommand } from '@milkdown/utils';
import type { MarkdownNode } from '@milkdown/transformer';
import { applyLink, linkTarget, removeLink, type LinkTarget } from './links';
import { remarkWiki, wikiStringifyOptions } from './markdown';

/** How the editor shows a wiki link or embed: supplied by the page (it knows the wiki index). */
export interface WikiLookup {
  /** A link's text and whether its page exists. */
  link(value: string): { label: string; missing: boolean };
  /** An image embed's URL (a published file or a picture added in this edit), or null. */
  image(value: string): string | null;
}

export interface VisualCallbacks {
  /** The document changed (typing, a command, a paste). */
  onChange(): void;
  /** `[[` typed: open the page picker at these window coordinates. */
  onWikiLinkTrigger(at: { left: number; top: number; bottom: number }): void;
  /** Image files pasted or dropped. */
  onImageFiles(files: File[]): void;
}

const inlineAtom = (name: string, value: string, cls: string, text: string, extra: Record<string, string> = {}) =>
  ['span', { class: cls, 'data-wiki-node': name, 'data-value': value, contenteditable: 'false', ...extra }, text] as const;

function wikiNodes(lookup: WikiLookup) {
  const literal = (mdType: string, nodeName: string) => ({
    parseMarkdown: {
      match: (node: MarkdownNode) => node.type === mdType,
      runner: (state: { addNode: (t: NodeType, a?: Record<string, unknown>) => unknown }, node: MarkdownNode, type: NodeType) => {
        state.addNode(type, { value: String((node as { value?: unknown }).value ?? '') });
      },
    },
    toMarkdown: {
      match: (node: ProseNode) => node.type.name === nodeName,
      runner: (state: { addNode: (t: string, c?: undefined, v?: string) => unknown }, node: ProseNode) => {
        state.addNode(mdType, undefined, node.attrs.value as string);
      },
    },
  });
  const attrs = { value: { default: '' } };
  const parseValue = (tag: string) => [{ tag, getAttrs: (dom: HTMLElement | string) => ({ value: typeof dom === 'string' ? '' : (dom.dataset.value ?? '') }) }];

  const wikiLink = $node('wiki_link', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs,
    parseDOM: parseValue('span[data-wiki-node="wiki_link"]'),
    toDOM: (node) => {
      const { label, missing } = lookup.link(node.attrs.value);
      return inlineAtom('wiki_link', node.attrs.value, missing ? 'wiki-link-node wiki-missing' : 'wiki-link-node', label, { title: `[[${node.attrs.value}]]` }) as never;
    },
    ...literal('wikiLink', 'wiki_link'),
  }));

  const wikiEmbed = $node('wiki_embed', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    attrs,
    parseDOM: parseValue('[data-wiki-node="wiki_embed"]'),
    toDOM: (node) => {
      const value = node.attrs.value as string;
      const src = lookup.image(value);
      if (!src) return inlineAtom('wiki_embed', value, 'wiki-embed-node', `![[${value}]]`) as never;
      const width = /\|\s*(\d+)/.exec(value)?.[1];
      return ['img', { src, alt: value.split('|')[0], title: `![[${value}]]`, 'data-wiki-node': 'wiki_embed', 'data-value': value, class: 'wiki-embed-image', ...(width ? { width } : {}) }] as never;
    },
    ...literal('wikiEmbed', 'wiki_embed'),
  }));

  const wikiComment = $node('wiki_comment', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs,
    parseDOM: parseValue('span[data-wiki-node="wiki_comment"]'),
    toDOM: (node) => inlineAtom('wiki_comment', node.attrs.value, 'wiki-comment-node', node.attrs.value, { title: 'Comment: not shown on the site. Edit it in Markdown mode.' }) as never,
    ...literal('wikiComment', 'wiki_comment'),
  }));

  const wikiCommentBlock = $node('wiki_comment_block', () => ({
    group: 'block',
    atom: true,
    selectable: true,
    attrs,
    parseDOM: parseValue('div[data-wiki-node="wiki_comment_block"]'),
    toDOM: (node) =>
      [
        'div',
        { class: 'wiki-comment-block', 'data-wiki-node': 'wiki_comment_block', 'data-value': node.attrs.value, contenteditable: 'false', title: 'Comment: not shown on the site. Edit it in Markdown mode.' },
        node.attrs.value,
      ] as never,
    ...literal('wikiCommentBlock', 'wiki_comment_block'),
  }));

  const calloutMarker = $node('callout_marker', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs,
    parseDOM: parseValue('span[data-wiki-node="callout_marker"]'),
    toDOM: (node) => {
      const kind = /^\[!([^\]]+)\]/.exec(node.attrs.value as string)?.[1] ?? 'note';
      return inlineAtom('callout_marker', node.attrs.value, 'callout-marker', kind.toUpperCase()) as never;
    },
    ...literal('calloutMarker', 'callout_marker'),
  }));

  return { wikiLink, wikiEmbed, wikiComment, wikiCommentBlock, calloutMarker };
}

const pickerKey = new PluginKey('wiki-picker');

/** Take the browser's cursor as the editor's selection if it moved without the editor noticing. */
function syncSelection(view: EditorView) {
  if (view.isDestroyed || !view.hasFocus() || view.composing) return;
  // ProseMirror's own DOM reader: it compares with the last selection it saw and only acts on a change.
  (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
}

function hooks(callbacks: VisualCallbacks) {
  return $prose(
    () =>
      new Plugin({
        key: pickerKey,
        view: () => ({
          update(view, prev) {
            if (!view.state.doc.eq(prev.doc)) callbacks.onChange();
          },
        }),
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== '[' || from < 1 || view.state.doc.textBetween(from - 1, from) !== '[') return false;
            // `[[`: remove the first `[` and let the picker insert the link.
            view.dispatch(view.state.tr.delete(from - 1, from));
            const c = view.coordsAtPos(from - 1);
            callbacks.onWikiLinkTrigger({ left: c.left, top: c.top, bottom: c.bottom });
            return true;
          },
          handlePaste(_view, event) {
            const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (files.length === 0) return false;
            callbacks.onImageFiles(files);
            return true;
          },
          handleDrop(view, event) {
            const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (files.length === 0) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
            callbacks.onImageFiles(files);
            return true;
          },
          handleDOMEvents: {
            // Before a key is handled, and after a click, the editor reads the cursor from the page.
            // It normally learns of a moved cursor from the browser's selectionchange event, which
            // Chromium stops sending after a dialog's text field had focus (the Link dialog): a
            // click then left the cursor where it was and Enter split the old paragraph.
            keydown(view) {
              syncSelection(view);
              return false;
            },
            mouseup(view) {
              setTimeout(() => syncSelection(view), 0);
              return false;
            },
            // A link in the text is edited, not followed: the click only places the cursor.
            click(_view, event) {
              if ((event.target as Element | null)?.closest?.('a[href]')) event.preventDefault();
              return false;
            },
            auxclick(_view, event) {
              if ((event.target as Element | null)?.closest?.('a[href]')) event.preventDefault();
              return false;
            },
          },
          handleClickOn(view, _pos, node, nodePos, event) {
            // A task list item's box (drawn before its text) toggles it.
            if (node.type.name !== 'list_item' || node.attrs.checked == null) return false;
            const li = event.target as HTMLElement;
            if (li.tagName !== 'LI' || event.offsetX > 28) return false;
            view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
            return true;
          },
        },
      }),
  );
}

export interface VisualEditor {
  /** The document as markdown, in the house style. */
  markdown(): string;
  run(action: VisualAction): void;
  /** Insert at the cursor. */
  insertWikiLink(value: string): void;
  insertEmbed(value: string): void;
  /** What the Link button acts on: the link at the cursor or selection, a selected wiki link, ... */
  linkTarget(): LinkTarget;
  /** Unlink the link at the cursor or selection, keeping its text. */
  removeLink(): void;
  focus(): void;
  view(): EditorView;
  destroy(): void;
}

export type VisualAction =
  | { kind: 'heading'; level: number }
  | { kind: 'paragraph' }
  | { kind: 'bold' | 'italic' | 'strike' | 'bullet' | 'ordered' | 'task' | 'quote' | 'code' | 'table' }
  | { kind: 'callout'; type: string }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'youtube'; url: string };

/**
 * A visual editor on `root` showing `markdown`. Throws if the page has markdown it cannot show
 * (the caller then uses the markdown editor instead).
 */
export async function createVisualEditor(root: HTMLElement, markdown: string, lookup: WikiLookup, callbacks: VisualCallbacks): Promise<VisualEditor> {
  const nodes = wikiNodes(lookup);
  const remark = $remark('remarkWiki', () => remarkWiki as never);
  // No `<br />` stand-ins for empty paragraphs: the site does not render HTML.
  const preset = commonmark.filter((p) => !(remarkPreserveEmptyLinePlugin as unknown as unknown[]).includes(p));
  const editor = Editor.make()
    .config((ctx: Ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, ...wikiStringifyOptions, handlers: { ...o.handlers, ...wikiStringifyOptions.handlers } }));
    })
    .use(preset)
    .use(gfm)
    .use(history)
    .use(remark)
    .use(Object.values(nodes))
    .use(hooks(callbacks));
  try {
    await editor.create();
  } catch (err) {
    await editor.destroy().catch(() => {});
    throw err;
  }

  const action = <T>(f: (ctx: Ctx) => T): T => editor.action(f);
  const view = () => action((ctx) => ctx.get(editorViewCtx));
  const type = (name: string) => view().state.schema.nodes[name];
  const insertNode = (node: ProseNode) => {
    const v = view();
    v.dispatch(v.state.tr.replaceSelectionWith(node).scrollIntoView());
    v.focus();
  };

  const md = () => action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
  // The editor must show what the text says: an empty result from a non-empty page means it could not read it.
  if (markdown.trim() !== '' && view().state.doc.textContent.trim() === '' && view().state.doc.childCount <= 1 && md().trim() === '') {
    await editor.destroy();
    throw new Error('The visual editor could not read this page.');
  }

  return {
    markdown: md,
    view,
    focus: () => view().focus(),
    insertWikiLink(value) {
      insertNode(type('wiki_link').create({ value }));
    },
    insertEmbed(value) {
      insertNode(type('wiki_embed').create({ value }));
    },
    linkTarget: () => linkTarget(view().state),
    removeLink() {
      const v = view();
      const tr = removeLink(v.state);
      if (tr) v.dispatch(tr);
      v.focus();
    },
    run(a) {
      const call = (key: Parameters<typeof callCommand>[0], payload?: unknown) => action(callCommand(key as never, payload as never));
      switch (a.kind) {
        case 'heading':
          call(wrapInHeadingCommand.key, a.level);
          break;
        case 'paragraph':
          call(turnIntoTextCommand.key);
          break;
        case 'bold':
          call(toggleStrongCommand.key);
          break;
        case 'italic':
          call(toggleEmphasisCommand.key);
          break;
        case 'strike':
          call(toggleStrikethroughCommand.key);
          break;
        case 'bullet':
          call(wrapInBulletListCommand.key);
          break;
        case 'ordered':
          call(wrapInOrderedListCommand.key);
          break;
        case 'task': {
          call(wrapInBulletListCommand.key);
          const v = view();
          const { $from } = v.state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const n = $from.node(d);
            if (n.type.name === 'list_item') {
              v.dispatch(v.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, checked: false }));
              break;
            }
          }
          break;
        }
        case 'quote':
          call(wrapInBlockquoteCommand.key);
          break;
        case 'callout': {
          const s = view().state.schema;
          const title = a.type[0].toUpperCase() + a.type.slice(1);
          const quote = s.nodes.blockquote.create(null, [
            s.nodes.paragraph.create(null, [type('callout_marker').create({ value: `[!${a.type}]` }), s.text(` ${title}`)]),
            s.nodes.paragraph.create(null, s.text('Text')),
          ]);
          insertBlock(view(), quote);
          break;
        }
        case 'code':
          call(createCodeBlockCommand.key);
          break;
        case 'table':
          call(insertTableCommand.key, { row: 3, col: 2 });
          break;
        case 'link': {
          // Edits the link at the cursor (its whole extent), links a selection, or inserts a link.
          const v = view();
          const tr = applyLink(v.state, a.href, a.text);
          if (tr) v.dispatch(tr);
          break;
        }
        case 'youtube': {
          const s = view().state.schema;
          insertBlock(view(), s.nodes.paragraph.create(null, s.text(a.url, [s.marks.link.create({ href: a.url })])));
          break;
        }
      }
      view().focus();
    },
    async destroy() {
      await editor.destroy();
    },
  } as VisualEditor;
}

/** Insert a block after the block the cursor is in (or in place of an empty paragraph). */
function insertBlock(view: EditorView, node: ProseNode) {
  const { state } = view;
  const { $from } = state.selection;
  const depth = Math.max(1, $from.depth);
  const block = $from.node(depth);
  let tr = state.tr;
  if (block.type.name === 'paragraph' && block.content.size === 0) {
    tr = tr.replaceWith($from.before(depth), $from.after(depth), node);
  } else {
    tr = tr.insert($from.after(depth), node);
  }
  const at = tr.mapping.map($from.pos);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 2, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
}

