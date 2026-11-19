// The visual editor's Link button (src/wikiEditor/links.ts) on a small ProseMirror schema shaped like
// the editor's: paragraphs, a link mark (href, title), strong, and the wiki link atom.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema, type Node as ProseNode } from '@milkdown/prose/model';
import { EditorState, NodeSelection, TextSelection } from '@milkdown/prose/state';
import { applyLink, linkTarget, removeLink } from '../src/wikiEditor/links.ts';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    wiki_link: { group: 'inline', inline: true, atom: true, attrs: { value: { default: '' } } },
  },
  marks: {
    link: { attrs: { href: {}, title: { default: null } } },
    strong: {},
  },
});

const link = (href: string) => schema.marks.link.create({ href });
// "See the docs here now." with "the docs" linked, "docs" also bold (so the link is two text nodes).
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [
    schema.text('See '),
    schema.text('the ', [link('https://old.example')]),
    schema.text('docs', [link('https://old.example'), schema.marks.strong.create()]),
    schema.text(' here '),
    schema.node('wiki_link', { value: 'Other Page' }),
    schema.text(' now.'),
  ]),
]);
// Positions: paragraph content starts at 1. "See " 1-5, "the docs" 5-13, " here " 13-19, wiki 19-20.
const at = (from: number, to = from) => EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });

/** The paragraph as text with links written as markdown. */
function md(d: ProseNode): string {
  let out = '';
  let open: string | null = null;
  d.firstChild!.forEach((n) => {
    const href = n.marks.find((m) => m.type.name === 'link')?.attrs.href ?? null;
    if (open !== href) {
      if (open) out += `](${open})`;
      if (href) out += '[';
      open = href;
    }
    out += n.isText ? n.text : `[[${n.attrs.value}]]`;
  });
  if (open) out += `](${open})`;
  return out;
}

test('the cursor inside a link finds the whole link, across its text nodes', () => {
  for (const pos of [6, 9, 11, 13]) {
    const t = linkTarget(at(pos));
    assert.equal(t.kind, 'link', `at ${pos}`);
    if (t.kind === 'link') assert.deepEqual([t.from, t.to, t.href, t.text], [5, 13, 'https://old.example', 'the docs']);
  }
  assert.equal(linkTarget(at(3)).kind, 'cursor');
});

test('editing the URL with the cursor in the link updates the whole link, not a toggle', () => {
  const tr = applyLink(at(9), 'https://new.example', 'the docs')!;
  assert.equal(md(tr.doc), 'See [the docs](https://new.example) here [[Other Page]] now.');
  // Bold is kept on its part.
  assert.ok(tr.doc.firstChild!.child(2).marks.some((m) => m.type.name === 'strong'));
});

test('a selection inside or over a link edits that link', () => {
  assert.equal(md(applyLink(at(10, 12), 'https://new.example', 'the docs')!.doc), 'See [the docs](https://new.example) here [[Other Page]] now.');
  const t = linkTarget(at(2, 15));
  assert.ok(t.kind === 'link');
  assert.deepEqual([t.from, t.to, t.text], [2, 15, 'ee the docs h']);
});

test('changing the text replaces the link text', () => {
  const tr = applyLink(at(9), 'https://new.example', 'the manual')!;
  assert.equal(md(tr.doc), 'See [the manual](https://new.example) here [[Other Page]] now.');
});

test('Remove link keeps the text', () => {
  assert.equal(md(removeLink(at(7))!.doc), 'See the docs here [[Other Page]] now.');
  assert.equal(removeLink(at(2)), null);
});

test('a selection without a link gets one (set, never toggled), only on its text', () => {
  const tr = applyLink(at(14, 18), 'https://x.example', '')!;
  assert.equal(md(tr.doc), 'See [the docs](https://old.example) [here](https://x.example) [[Other Page]] now.');
  // Over a wiki link: the atom is not marked (it would serialise as [[[...]]](...)).
  const over = applyLink(at(18, 22), 'https://x.example', '')!;
  assert.equal(md(over.doc), 'See [the docs](https://old.example) here[ ](https://x.example)[[Other Page]][ n](https://x.example)ow.');
});

test('nothing selected outside a link inserts linked text', () => {
  assert.equal(md(applyLink(at(3), 'https://x.example', 'more')!.doc), 'Se[more](https://x.example)e [the docs](https://old.example) here [[Other Page]] now.');
});

test('a selected wiki link is left alone', () => {
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 19) });
  assert.deepEqual(linkTarget(state), { kind: 'wiki', pos: 19, value: 'Other Page' });
  assert.equal(applyLink(state, 'https://x.example', ''), null);
});
