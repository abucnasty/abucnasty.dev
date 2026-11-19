// The markdown mode: CodeMirror 6 with the markdown language, `[[` completing page titles, and
// the toolbar's actions as plain text edits.
import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
// Only the GFM markdown language: markdown() would bring the HTML, CSS and JavaScript parsers.
import { markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, LanguageSupport, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { BlockStyle, VisualAction } from './milkdown';

export type MarkdownAction = VisualAction | { kind: 'wikiLink' } | { kind: 'embed'; value: string };

function wikiCompletion(titles: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/!?\[\[[^\]\n|#]*/);
    if (!m) return null;
    const from = m.from + m.text.indexOf('[[') + 2;
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]';
    return {
      from,
      options: titles().map((t) => ({ label: t, apply: closed ? t : `${t}]]` })),
      validFor: /^[^\]\n|#]*$/,
    };
  };
}

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: '#fca300' },
  { tag: [tags.monospace, tags.processingInstruction], color: '#9cdcfe' },
  { tag: tags.quote, color: '#b0b0b0' },
  { tag: tags.comment, color: '#888' },
]);

export function MarkdownEditor({
  value,
  onChange,
  titles,
  onImageFiles,
  onBlockStyle,
  apiRef,
}: {
  value: string;
  onChange: (text: string) => void;
  titles: () => string[];
  onImageFiles: (files: File[]) => void;
  /** The cursor moved or the text changed: the style of the cursor's line. */
  onBlockStyle: (style: BlockStyle) => void;
  /** Set while it is open: runs a toolbar action on it. */
  apiRef: React.MutableRefObject<{ run(a: MarkdownAction): void } | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const latest = useRef({ onChange, titles, onImageFiles, onBlockStyle });
  latest.current = { onChange, titles, onImageFiles, onBlockStyle };

  useEffect(() => {
    const images = (list: FileList | undefined | null) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            // The usual formatting shortcuts, as in the visual editor.
            { key: 'Mod-b', run: (v) => (runMarkdownAction(v, { kind: 'bold' }), true) },
            { key: 'Mod-i', run: (v) => (runMarkdownAction(v, { kind: 'italic' }), true) },
            // Text and headings, as in the visual editor (and Google Docs): Ctrl+Alt+0 to 6, Cmd+Option on a Mac.
            { key: 'Mod-Alt-0', run: (v) => (runMarkdownAction(v, { kind: 'paragraph' }), true) },
            ...[1, 2, 3, 4, 5, 6].map((level) => ({ key: `Mod-Alt-${level}`, run: (v: EditorView) => (runMarkdownAction(v, { kind: 'heading', level }), true) })),
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          new LanguageSupport(markdownLanguage),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          placeholder('Write the page in markdown…'),
          autocompletion({ override: [wikiCompletion(() => latest.current.titles())], activateOnTyping: true }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString());
            latest.current.onBlockStyle(lineStyle(u.state));
          }),
          EditorView.domEventHandlers({
            paste(e) {
              const files = images(e.clipboardData?.files);
              if (files.length === 0) return false;
              e.preventDefault();
              latest.current.onImageFiles(files);
              return true;
            },
            drop(e, v) {
              const files = images(e.dataTransfer?.files);
              if (files.length === 0) return false;
              e.preventDefault();
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos !== null) v.dispatch({ selection: { anchor: pos } });
              latest.current.onImageFiles(files);
              return true;
            },
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Page markdown', 'data-wiki-markdown-editor': '' }),
          EditorView.theme(
            {
              '&': { backgroundColor: theme.palette.background.paper, color: theme.palette.text.primary, fontSize: '14px', minHeight: '50vh' },
              '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', padding: '12px 0', caretColor: theme.palette.primary.main },
              '.cm-line': { padding: '0 12px' },
              '&.cm-focused': { outline: 'none' },
              '.cm-cursor': { borderLeftColor: theme.palette.primary.main },
              '.cm-tooltip-autocomplete': { backgroundColor: theme.palette.background.default },
            },
            { dark: theme.palette.mode === 'dark' },
          ),
        ],
      }),
    });
    apiRef.current = { run: (a) => runMarkdownAction(view, a) };
    latest.current.onBlockStyle(lineStyle(view.state));
    return () => {
      view.destroy();
      apiRef.current = null;
    };
    // The editor owns its text after it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Box ref={host} data-wiki-markdown-host sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }} />;
}

/** Wrap the selection (or a placeholder) in `before`/`after`. */
function wrap(view: EditorView, before: string, after: string, fallback: string) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to) || fallback;
      return {
        changes: { from: range.from, to: range.to, insert: before + text + after },
        range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length),
      };
    }),
  );
}

/** Set the prefix of every selected line (replacing a heading, list or quote marker). */
function prefixLines(view: EditorView, prefix: (i: number) => string) {
  const changes = selectedLines(view.state).map((line, i) => {
    const marker = /^(?:#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)?/.exec(line.text)![0];
    return { from: line.from, to: line.from + marker.length, insert: prefix(i) };
  });
  view.dispatch({ changes });
}

/** The lines the selection touches. */
function selectedLines(state: EditorState) {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n);
  return [...lines].map((n) => state.doc.line(n));
}

/**
 * A line's heading marker (`## `), after any quote or list markers it starts with: where it starts,
 * and the marker as written ('' when the line is not a heading).
 */
function headingMarker(text: string): { at: number; marker: string } {
  const m = /^((?:[ \t]*(?:>[ \t]?|(?:[-*+](?: \[[ xX]\])?|\d+[.)])[ \t]+))*)([ \t]{0,3}#{1,6}(?:[ \t]+|$))?/.exec(text)!;
  return { at: m[1].length, marker: m[2] ?? '' };
}

/** Make every selected line a heading of `level`, or text (0): only its `#` marker changes. */
function setHeading(view: EditorView, level: number) {
  const changes = selectedLines(view.state).flatMap((line) => {
    const { at, marker } = headingMarker(line.text);
    const insert = level > 0 ? `${'#'.repeat(level)} ` : '';
    // A blank line stays blank: picking Text there changes nothing.
    if (marker === insert || (level === 0 && marker === '')) return [];
    return [{ from: line.from + at, to: line.from + at + marker.length, insert }];
  });
  if (changes.length) view.dispatch({ changes });
}

/** The style of the cursor's line: its heading level as the parser reads it (not in code), or 0. */
export function lineStyle(state: EditorState): BlockStyle {
  const line = state.doc.lineAt(state.selection.main.head);
  const tree = syntaxTree(state);
  for (const [pos, side] of [[line.to, -1], [line.from, 1]] as const) {
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); node; node = node.parent) {
      const m = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
      if (m) return Number(m[1]);
    }
  }
  // Not parsed this far yet (a long page): read the marker.
  if (tree.length < line.to) {
    const { marker } = headingMarker(line.text);
    return marker ? marker.trim().length : 0;
  }
  return 0;
}

/** Insert whole lines after the cursor's line, with blank lines around them. */
function insertBlock(view: EditorView, text: string, cursorOffset = text.length) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const empty = line.text.trim() === '';
  const from = empty ? line.from : line.to;
  const insert = `${empty ? '' : '\n\n'}${text}\n`;
  view.dispatch({ changes: { from, to: empty ? line.to : line.to, insert }, selection: { anchor: from + (empty ? 0 : 2) + cursorOffset } });
}

export function runMarkdownAction(view: EditorView, a: MarkdownAction) {
  switch (a.kind) {
    case 'heading':
      setHeading(view, a.level);
      break;
    case 'paragraph':
      setHeading(view, 0);
      break;
    case 'bold':
      wrap(view, '**', '**', 'bold text');
      break;
    case 'italic':
      wrap(view, '_', '_', 'italic text');
      break;
    case 'strike':
      wrap(view, '~~', '~~', 'struck text');
      break;
    case 'link': {
      const r = view.state.selection.main;
      const text = view.state.sliceDoc(r.from, r.to) || a.text || a.href;
      view.dispatch({ changes: { from: r.from, to: r.to, insert: `[${text}](${a.href})` } });
      break;
    }
    case 'wikiLink': {
      const r = view.state.selection.main;
      view.dispatch({ changes: { from: r.from, to: r.to, insert: '[[' }, selection: { anchor: r.from + 2 } });
      break;
    }
    case 'embed': {
      const r = view.state.selection.main;
      view.dispatch({ changes: { from: r.from, to: r.to, insert: `![[${a.value}]]` } });
      break;
    }
    case 'bullet':
      prefixLines(view, () => '- ');
      break;
    case 'ordered':
      prefixLines(view, (i) => `${i + 1}. `);
      break;
    case 'task':
      prefixLines(view, () => '- [ ] ');
      break;
    case 'quote':
      prefixLines(view, () => '> ');
      break;
    case 'callout': {
      const title = a.type[0].toUpperCase() + a.type.slice(1);
      insertBlock(view, `> [!${a.type}] ${title}\n> Text`);
      break;
    }
    case 'code':
      insertBlock(view, '```\n\n```', 4);
      break;
    case 'table':
      insertBlock(view, '| Column | Column |\n| ------ | ------ |\n|        |        |', 2);
      break;
    case 'youtube':
      insertBlock(view, a.url);
      break;
  }
  view.focus();
}
