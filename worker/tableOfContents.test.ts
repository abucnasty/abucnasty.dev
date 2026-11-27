// The "On this page" list (src/tableOfContents.ts) against the page it sits beside: every id the
// list builds must be the id of a heading the page renders, with the plugins the page uses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { normaliseWikiIndex } from '../src/wikiCore.ts';
import { parseHeadings } from '../src/tableOfContents.ts';
import { prepareWikiSource, wikiMarkdownOptions } from '../src/wikiMarkdown.ts';

const index = normaliseWikiIndex({
  schema: 1,
  generatedAt: '2026-11-27T00:00:00Z',
  pages: [
    { title: 'Setting Up Arch', slug: 'setting-up-arch', folder: 'Guides', aliases: [], headings: [{ depth: 2, text: 'Prerequisites', id: 'prerequisites' }], excerpt: '', links: [], files: [], blob: 'a' },
    { title: 'Made Up', slug: 'made-up', folder: '', aliases: [], headings: [], excerpt: '', links: [], files: [], blob: 'b' },
  ],
  files: [],
});
const page = index.pages.find((p) => p.slug === 'made-up')!;

/** The (level, id) of every heading the wiki renders for this markdown, in order. */
function renderedWiki(markdown: string) {
  const html = renderToStaticMarkup(createElement(Markdown, { ...wikiMarkdownOptions({ index, page }), children: prepareWikiSource(markdown) }));
  return [...html.matchAll(/<h([1-6]) id="([^"]*)"/g)].map((m) => ({ level: Number(m[1]), id: m[2] }));
}

/** The same for a benchmark page (MarkdownRenderer's plugins). */
function renderedBenchmark(markdown: string) {
  const html = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeRaw, rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]], children: markdown }),
  );
  return [...html.matchAll(/<h([1-6]) id="([^"]*)"/g)].map((m) => ({ level: Number(m[1]), id: m[2] }));
}

const listed = (rendered: { level: number; id: string }[]) => rendered.filter((h) => h.level <= 4).map((h) => h.id);

const wikiPage = [
  '---',
  'tags: [made-up]',
  '---',
  '# Made up page',
  '',
  'Text %% a comment',
  '## hidden %%',
  '',
  '## Plain heading',
  '## Repeated title',
  '### Repeated title',
  '## Repeated title',
  '## Step 2.1: Generate a Test Map',
  '## Step 1: Install `belt`',
  '## Read the [guide](https://example.com/guide) first',
  '## About [[Setting Up Arch|the Arch page]]',
  '## About [[Setting Up Arch]]',
  '## Needs [[Setting Up Arch#Prerequisites]]',
  '## Needs [[Setting Up Arch#Prerequisites|its prerequisites]]',
  '## Update time in µs',
  '## Über die Größe',
  '## 📈 Results',
  '## Cars / Tanks',
  '## snake_case name',
  '## Closing hashes ##',
  '#### Deep heading',
  '##### Fifth level',
  '##### Fifth level',
  '## Fifth level',
  '',
  '```',
  '## Not a heading in a fence',
  '```',
  '~~~',
  '```',
  '## Not a heading in a tilde fence',
  '~~~',
  '## After the fences',
  '',
].join('\n');

test('wiki page: every id the list builds is the id of the heading the page renders, in order', () => {
  const rendered = renderedWiki(wikiPage);
  const list = parseHeadings(prepareWikiSource(wikiPage), { wikiLinks: true });
  assert.ok(list.length > 15, `${list.length} headings listed`);
  assert.deepEqual(
    list.map((h) => h.id),
    listed(rendered),
  );
});

test('wiki page: the ids of the cases the list gets wrong without care', () => {
  const ids = new Map(parseHeadings(prepareWikiSource(wikiPage), { wikiLinks: true }).map((h) => [h.text, h.id]));
  assert.equal(ids.get('Plain heading'), 'plain-heading');
  assert.deepEqual(
    parseHeadings('## Repeated title\n### Repeated title\n## Repeated title').map((h) => h.id),
    ['repeated-title', 'repeated-title-1', 'repeated-title-2'],
  );
  assert.equal(ids.get('Step 2.1: Generate a Test Map'), 'step-21-generate-a-test-map');
  assert.equal(ids.get('Step 1: Install belt'), 'step-1-install-belt');
  assert.equal(ids.get('Read the guide first'), 'read-the-guide-first');
  assert.equal(ids.get('About the Arch page'), 'about-the-arch-page');
  assert.equal(ids.get('Needs its prerequisites'), 'needs-its-prerequisites');
  assert.equal(ids.get('Update time in µs'), 'update-time-in-µs');
  assert.equal(ids.get('Über die Größe'), 'über-die-größe');
  assert.equal(ids.get('📈 Results'), '-results');
});

test('wiki page: the list shows h1 to h4 and skips fenced lines, comments and frontmatter', () => {
  const list = parseHeadings(prepareWikiSource(wikiPage), { wikiLinks: true });
  assert.ok(list.every((h) => h.level >= 1 && h.level <= 4));
  const texts = list.map((h) => h.text);
  assert.ok(texts.includes('Deep heading'));
  assert.ok(texts.includes('After the fences'));
  assert.ok(!texts.some((t) => /Fifth level|Not a heading|hidden/.test(t) && t !== 'Fifth level'));
  assert.equal(texts.filter((t) => t === 'Fifth level').length, 1, 'the h2 only');
  assert.equal(texts[0], 'Made up page');
});

test('a page with no heading lists none', () => {
  assert.deepEqual(parseHeadings('Just text.\n\n```\n# not a heading\n```\n'), []);
});

test('benchmark page: the list keeps the ids of its headings, emoji and non-ASCII letters included', () => {
  const readme = [
    '# Benchmark',
    '## 📈 Results',
    '## 🧠 Analysis & Conclusions',
    '## ⚙️ Assembling Machines',
    '## Whole-update scaling (median µs)',
    '## Results',
    '## Results',
    '## Literal [[Page|label]] stays text',
    '##### Deep',
    '',
  ].join('\n');
  assert.deepEqual(
    parseHeadings(readme).map((h) => h.id),
    listed(renderedBenchmark(readme)),
  );
});
