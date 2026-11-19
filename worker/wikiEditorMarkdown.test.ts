// The wiki editor's markdown round trip (src/wikiEditor/markdown.ts): the remark plugin and the
// house-style serialiser the visual editor uses, on a page with everything Obsidian writes. The
// editor UI itself is checked in a browser (see the README).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { remarkWiki, wikiStringifyOptions } from '../src/wikiEditor/markdown.ts';
import { composePage, splitPage } from '../src/wikiSource.ts';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkWiki).use(remarkStringify, wikiStringifyOptions);
const roundTrip = (markdown: string) => processor.stringify(processor.runSync(processor.parse(markdown)) as never);

const SAMPLE = `---
aliases: [Old Title]
tags: [guide]
---

# Sample page

Intro with **bold**, _italic_, ~~struck~~, \`code [[not a link]]\` and a [link](https://example.com).
See [[Other Page]], [[Other Page|a label]], [[Other Page#Some Heading]] and [[#Local]].

![[diagram.webp]]

![[photo.png|400]] inline %% a short comment %% after.

> [!note] A note
> Callout body with [[Linked]].

> [!warning]-
> Folded warning.

> Plain quote.

%%
A block comment
with **markdown** and [[links]] inside.

Even a blank line.
%%

- one
- two
  - nested
- [ ] task
- [x] done

1. first
2. second

| Name | Value    |
| ---- | -------- |
| a    | [[B\\|b]] |

\`\`\`sh
echo "%% not a comment %%"
\`\`\`

---

https://youtu.be/pXz01Be-9hE

Last line with snake_case, 5 * 3 and a [[Page_With_Underscores]].
`;

test('editor markdown: a house-style page with frontmatter and every Obsidian construct comes back unchanged', () => {
  const { frontmatter, body } = splitPage(SAMPLE);
  assert.equal(frontmatter, '---\naliases: [Old Title]\ntags: [guide]\n---\n\n');
  assert.equal(composePage(frontmatter, roundTrip(body)), SAMPLE);
});

test('editor markdown: wiki links, embeds, comments and callouts are their own nodes', () => {
  const tree = processor.runSync(processor.parse(splitPage(SAMPLE).body)) as any;
  const found = new Map<string, string[]>();
  const walk = (n: any) => {
    if (['wikiLink', 'wikiEmbed', 'wikiComment', 'wikiCommentBlock', 'calloutMarker'].includes(n.type)) found.set(n.type, [...(found.get(n.type) ?? []), n.value]);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  assert.deepEqual(found.get('wikiLink'), ['Other Page', 'Other Page|a label', 'Other Page#Some Heading', '#Local', 'Linked', 'B\\|b', 'Page_With_Underscores']);
  assert.deepEqual(found.get('wikiEmbed'), ['diagram.webp', 'photo.png|400']);
  assert.deepEqual(found.get('wikiComment'), ['%% a short comment %%']);
  assert.equal(found.get('wikiCommentBlock')?.length, 1);
  assert.match(found.get('wikiCommentBlock')![0], /^%%\nA block comment\n[\s\S]*Even a blank line\.\n%%$/);
  assert.deepEqual(found.get('calloutMarker'), ['[!note]', '[!warning]-']);
});

test('editor markdown: other styles are written in the house style, Obsidian syntax untouched', () => {
  const input = '* a [[Page|x *y*]]\n* b %% keep *this* %%\n\nSome *it* and __b__ text.\n\nSee https://example.com/x, ok.\n\nTitle\n=====\n\n~~~\ncode\n~~~\n\n%% unclosed comment\nruns to the end *of* the page\n';
  assert.equal(
    roundTrip(input),
    '- a [[Page|x *y*]]\n- b %% keep *this* %%\n\nSome _it_ and **b** text.\n\nSee https://example.com/x, ok.\n\n# Title\n\n```\ncode\n```\n\n%% unclosed comment\nruns to the end *of* the page\n',
  );
});
