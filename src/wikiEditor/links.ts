// The visual editor's Link button, as ProseMirror state in and transactions out (no DOM, so it is
// unit tested in worker/wikiEditorLinks.test.ts):
// - the cursor in, or a selection on, a link: the whole link (every adjacent piece of text with the
//   same link mark) is edited or unlinked, never toggled off;
// - a selection with no link: the link is set on its text;
// - nothing selected outside a link: new linked text at the cursor;
// - a wiki link (`[[...]]`, an atom) selected: left alone here; the editor opens the page picker.
import type { Mark, MarkType, Node as ProseNode, ResolvedPos } from '@milkdown/prose/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@milkdown/prose/state';

/** What the Link button would act on. */
export type LinkTarget =
  /** An existing link, over [from, to); `text` is null when its text can't be edited as plain text. */
  | { kind: 'link'; from: number; to: number; href: string; text: string | null; mark: Mark }
  /** A wiki link node, selected. */
  | { kind: 'wiki'; pos: number; value: string }
  /** Text selected, with no link in it. */
  | { kind: 'selection'; from: number; to: number }
  /** Nothing selected, not in a link. */
  | { kind: 'cursor' };

const linkType = (state: EditorState): MarkType => state.schema.marks.link;

/** The full extent of `mark` around a position in a textblock: every adjacent child carrying it. */
function markExtent($pos: ResolvedPos, mark: Mark): { from: number; to: number } | null {
  const parent = $pos.parent;
  const index = $pos.index();
  const candidates = $pos.textOffset > 0 ? [index] : [index - 1, index];
  const at = candidates.find((i) => i >= 0 && i < parent.childCount && mark.isInSet(parent.child(i).marks));
  if (at === undefined) return null;
  let first = at;
  let last = at;
  while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first--;
  while (last < parent.childCount - 1 && mark.isInSet(parent.child(last + 1).marks)) last++;
  const start = $pos.start();
  let from = start;
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = first; i <= last; i++) to += parent.child(i).nodeSize;
  return { from, to };
}

/** The range's text, or null when it holds anything but text (a wiki link, an image) or spans blocks. */
function plainText(doc: ProseNode, from: number, to: number): string | null {
  const $from = doc.resolve(from);
  if (!$from.sameParent(doc.resolve(to))) return null;
  let plain = true;
  doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !node.isText) plain = false;
    return !node.isInline;
  });
  return plain ? doc.textBetween(from, to) : null;
}

export function linkTarget(state: EditorState): LinkTarget {
  const { selection, doc } = state;
  const type = linkType(state);
  if (selection instanceof NodeSelection && selection.node.type.name === 'wiki_link') {
    return { kind: 'wiki', pos: selection.from, value: String(selection.node.attrs.value ?? '') };
  }
  const link = (mark: Mark, $pos: ResolvedPos, from: number, to: number): LinkTarget | null => {
    const extent = markExtent($pos, mark);
    if (!extent) return null;
    const range = { from: Math.min(from, extent.from), to: Math.max(to, extent.to) };
    return { kind: 'link', ...range, href: String(mark.attrs.href ?? ''), text: plainText(doc, range.from, range.to), mark };
  };
  if (selection.empty) {
    const $pos = selection.$from;
    const mark = type.isInSet(state.storedMarks ?? $pos.marks());
    return (mark && link(mark, $pos, $pos.pos, $pos.pos)) || { kind: 'cursor' };
  }
  const { from, to } = selection;
  let found: LinkTarget | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    const mark = node.isInline ? type.isInSet(node.marks) : undefined;
    if (mark) found = link(mark, doc.resolve(pos + Math.min(1, node.nodeSize)), from, to);
    return !found;
  });
  return found ?? { kind: 'selection', from, to };
}

/** Link only the text in [from, to): a link mark on a wiki link or embed would break its markdown. */
function markText(tr: Transaction, from: number, to: number, mark: Mark) {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), mark);
  });
}

/**
 * Link `href`: edit the link at the cursor or selection (its whole extent; its text too when `text`
 * is given and differs), link the selected text, or insert `text` (or the address) linked.
 * Returns null for a selected wiki link, which this does not touch.
 */
export function applyLink(state: EditorState, href: string, text: string): Transaction | null {
  const target = linkTarget(state);
  const type = linkType(state);
  const tr = state.tr;
  switch (target.kind) {
    case 'wiki':
      return null;
    case 'cursor':
      return tr.replaceSelectionWith(state.schema.text(text || href, [type.create({ href })]), false).scrollIntoView();
    case 'selection':
      tr.removeMark(target.from, target.to, type);
      markText(tr, target.from, target.to, type.create({ href }));
      return tr.scrollIntoView();
    case 'link': {
      const mark = type.create({ ...target.mark.attrs, href });
      if (target.text !== null && text !== '' && text !== target.text) {
        const first = state.doc.resolve(target.from).nodeAfter;
        const marks = mark.addToSet(type.removeFromSet(first?.marks ?? []));
        tr.replaceWith(target.from, target.to, state.schema.text(text, marks));
        tr.setSelection(TextSelection.create(tr.doc, target.from + text.length));
        return tr.scrollIntoView();
      }
      tr.removeMark(target.from, target.to, type);
      markText(tr, target.from, target.to, mark);
      return tr.scrollIntoView();
    }
  }
}

/** Unlink the link at the cursor or selection, keeping its text. Null when there is none. */
export function removeLink(state: EditorState): Transaction | null {
  const target = linkTarget(state);
  if (target.kind !== 'link') return null;
  return state.tr.removeMark(target.from, target.to, linkType(state)).scrollIntoView();
}
