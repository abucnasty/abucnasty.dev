// The wiki: index normalising, link and image resolution (both link forms), and the page renderer
// (sanitising, callouts, comments, YouTube), rendered with react-markdown exactly as the site does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { findWikiAlias, normaliseWikiIndex, resolveWikiFile, resolveWikiHref, wikiFolders, youtubeVideo, type WikiIndex } from '../src/wikiCore.ts';
import { mermaidSource } from '../src/markdownMermaid.ts';
import { prepareWikiSource, wikiMarkdownOptions } from '../src/wikiMarkdown.ts';
import { matchRoute, wikiPreview, wikiRedirect } from './previews.ts';

const V = 'https://vault.abucnasty.dev/wiki';

const index: WikiIndex = normaliseWikiIndex({
  schema: 1,
  generatedAt: '2026-11-18T00:00:00Z',
  futureField: true,
  pages: [
    { title: 'Home', slug: 'home', folder: '', aliases: [], headings: [], excerpt: 'Welcome.', links: [], files: [], blob: 'a' },
    {
      title: 'How to Benchmark',
      slug: 'how-to-benchmark',
      folder: 'Guides',
      aliases: ['Benchmarking 101'],
      headings: [
        { depth: 2, text: 'Step 2.1: Generate a Test Map', id: 'step-21-generate-a-test-map' },
        { depth: 2, text: 'Tips', id: 'tips' },
        { depth: 2, text: 'Tips', id: 'tips-1' },
      ],
      excerpt: 'How to.',
      links: [],
      files: ['Guides/_attachments/logo.png'],
      blob: 'b',
    },
    { title: 'Setting Up Arch', slug: 'setting-up-arch', folder: 'Guides/Linux', aliases: [], headings: [], excerpt: '', links: [], files: [], blob: 'c' },
    { slug: 'broken' },
  ],
  files: [
    { path: 'Guides/_attachments/logo.png', published: 'Guides/_attachments/logo.webp', type: 'image/webp', size: 2, v: 'v1' },
    { path: 'Other/_attachments/logo.png', published: 'Other/_attachments/logo.webp', type: 'image/webp', size: 2, v: 'v2' },
    { path: 'Other/anim.gif', published: 'Other/anim.gif', type: 'image/gif', size: 2, v: 'v3' },
    { path: 'Guides/Linux/shot one.png', published: 'Guides/Linux/shot one.webp', type: 'image/webp', size: 2, v: 'v4' },
  ],
});
const page = (slug: string) => index.pages.find((p) => p.slug === slug)!;
const render = (markdown: string, slug = 'how-to-benchmark') =>
  renderToStaticMarkup(createElement(Markdown, { ...wikiMarkdownOptions({ index, page: page(slug) }), children: prepareWikiSource(markdown) }));

test('normaliseWikiIndex: keeps usable pages by title, groups folders top first', () => {
  assert.deepEqual(index.pages.map((p) => p.slug), ['home', 'how-to-benchmark', 'setting-up-arch']);
  assert.deepEqual(wikiFolders(index).map((g) => [g.folder, g.pages.length]), [['', 1], ['Guides', 1], ['Guides/Linux', 1]]);
  assert.equal(findWikiAlias(index, 'benchmarking-101')?.slug, 'how-to-benchmark');
  assert.equal(findWikiAlias(index, 'how-to-benchmark'), undefined);
});

test('links: [[...]] and relative markdown links resolve by title, with heading anchors; missing pages show as missing', () => {
  const html = render(
    [
      '[[Setting Up Arch]] [[setting up arch|Arch]] [[Guides/How to Benchmark#Step 2.1 Generate a Test Map]] [[#Tips|tips]] [[Home]] [[Benchmarking 101]]',
      '',
      '[md](Linux/Setting%20Up%20Arch.md) [md2](../Home.md#Nowhere) [anchor](#Step%202.1:%20Generate%20a%20Test%20Map) [ext](https://example.com) [draft](Draft%20Page.md) [[No Such Page]]',
    ].join('\n'),
  );
  for (const [href, text] of [
    ['/wiki/setting-up-arch', 'Setting Up Arch'],
    ['/wiki/setting-up-arch', 'Arch'],
    ['#step-21-generate-a-test-map', 'Guides/How to Benchmark &gt; Step 2.1 Generate a Test Map'],
    ['#tips', 'tips'],
    ['/wiki', 'Home'],
    ['/wiki/how-to-benchmark', 'Benchmarking 101'],
    ['/wiki/setting-up-arch', 'md'],
    ['/wiki#nowhere', 'md2'],
    ['#step-21-generate-a-test-map', 'anchor'],
    ['https://example.com', 'ext'],
  ]) {
    assert.ok(html.includes(`<a href="${href}">${text}</a>`), `${href} ${text} in ${html}`);
  }
  assert.ok(html.includes('<span class="wiki-missing" title="This page does not exist yet" data-page="Draft Page">draft</span>'), html);
  assert.ok(html.includes('<span class="wiki-missing" title="This page does not exist yet" data-page="No Such Page">No Such Page</span>'), html);
  assert.deepEqual(resolveWikiHref(index, page('home'), 'Guides/How%20to%20Benchmark.md#Tips'), {
    kind: 'page',
    url: '/wiki/how-to-benchmark#tips',
    page: page('how-to-benchmark'),
  });
});

test('images: ![[...]] with a width and ![](relative) resolve Obsidian style to the published file', () => {
  // The page's own _attachments first, though another folder has the same name.
  assert.equal(resolveWikiFile(index, 'logo.png', 'Guides')?.path, 'Guides/_attachments/logo.png');
  assert.equal(resolveWikiFile(index, 'logo.png', 'Other')?.path, 'Other/_attachments/logo.png');
  assert.equal(resolveWikiFile(index, 'anim.gif', 'Guides/Linux')?.path, 'Other/anim.gif');
  assert.equal(resolveWikiFile(index, '../Other/anim.gif', 'Guides')?.path, 'Other/anim.gif');
  const html = render('![[logo.png|400]] ![[anim.gif|An animation]]\n\n![Shot](Linux/shot%20one.png) ![[gone.png]] ![[Other Page]] ![x](https://example.com/a.png)');
  assert.ok(html.includes(`<img src="${V}/files/Guides/_attachments/logo.webp?v=v1" alt="" width="400"/>`), html);
  assert.ok(html.includes(`<img src="${V}/files/Other/anim.gif?v=v3" alt="An animation"/>`), html);
  assert.ok(html.includes(`<img src="${V}/files/Guides/Linux/shot%20one.webp?v=v4" alt="Shot"/>`), html);
  assert.ok(html.includes('<span class="wiki-missing" title="This image is not in the wiki">gone.png</span>'), html);
  assert.ok(html.includes('![[Other Page]]'), 'a page embed stays plain text');
  assert.ok(html.includes('<img src="https://example.com/a.png" alt="x"/>'));
});

test('sanitising: raw HTML, script and javascript: URLs do not survive', () => {
  const html = render(
    [
      '<script>alert(1)</script>',
      '',
      'Hi <img src=x onerror="alert(2)"> <a href="javascript:alert(3)">raw</a> <iframe src="https://evil.example"></iframe>',
      '',
      '[click](javascript:alert(4)) [also](JaVaScRiPt:alert(5)) ![img](javascript:alert(6))',
      '',
      '<div class="callout youtube-embed" data-youtube="dQw4w9WgXcQ">fake</div>',
    ].join('\n'),
  );
  assert.doesNotMatch(html, /<script|onerror|javascript:|<iframe|evil\.example|data-youtube|<div/i, html);
  assert.match(html, /click/);
});

test('a ```mermaid block survives sanitising as code (drawn in the browser); its source is found, other code is not', () => {
  const diagram = 'flowchart TD\n  A["<script>alert(1)</script>"] --> B\n  %% a mermaid comment, not an Obsidian one';
  const found: (string | undefined)[] = [];
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      ...wikiMarkdownOptions({ index, page: page('how-to-benchmark') }),
      components: { pre: ({ node, children }) => (found.push(mermaidSource(node)), createElement('pre', null, children)) },
      children: prepareWikiSource(['```mermaid', diagram, '```', '', '```js', 'let a = 1;', '```', '', '    indented'].join('\n')),
    }),
  );
  assert.match(html, /<code class="language-mermaid">flowchart TD/);
  assert.doesNotMatch(html, /<script/);
  assert.deepEqual(found, [`${diagram}\n`, undefined, undefined]);
});

test('callouts, comments, GFM and YouTube paragraphs', () => {
  const html = render(
    [
      '---',
      'aliases: [secret]',
      '---',
      '> [!warning]- Mind the **gap**',
      '> Body text.',
      '',
      '> [!tip]',
      '> Just a tip.',
      '',
      '> [!custom] Odd type',
      '',
      '> A plain quote.',
      '',
      'Visible %% hidden inline %% text.',
      '',
      '%%',
      'hidden block',
      '%%',
      '',
      '```js',
      'const x = "%% kept in code %%";',
      '```',
      '',
      '- [x] done',
      '',
      '| a | b |',
      '|---|---|',
      '| [[Home\\|home]] | ~~old~~ |',
      '',
      'https://youtu.be/pXz01Be-9hE',
      '',
      'https://www.youtube.com/watch?v=pXz01Be-9hE&t=1m30s',
      '',
      'Watch https://youtu.be/pXz01Be-9hE here.',
    ].join('\n'),
  );
  assert.doesNotMatch(html, /secret|aliases|hidden/);
  assert.match(html, /<div class="callout callout-warning">\s*<div class="callout-title">Mind the <strong>gap<\/strong><\/div>\s*<p>Body text\.<\/p>\s*<\/div>/);
  assert.match(html, /<div class="callout callout-tip">\s*<div class="callout-title">Tip<\/div>\s*<p>Just a tip\.<\/p>/);
  assert.match(html, /<div class="callout callout-note">\s*<div class="callout-title">Odd type<\/div>/);
  assert.match(html, /<blockquote>\s*<p>A plain quote\.<\/p>/);
  assert.match(html, /<p>Visible {2}text\.<\/p>/);
  assert.match(html, /<code class="language-js">const x = &quot;%% kept in code %%&quot;;/);
  assert.match(html, /<input type="checkbox" disabled="" checked=""\/> done/);
  assert.match(html, /<td><a href="\/wiki">home<\/a><\/td><td><del>old<\/del><\/td>/);
  assert.ok(html.includes('<div class="youtube-embed"><iframe src="https://www.youtube-nocookie.com/embed/pXz01Be-9hE" title="YouTube video player" loading="lazy"'), html);
  assert.ok(html.includes('src="https://www.youtube-nocookie.com/embed/pXz01Be-9hE?start=90"'), html);
  assert.ok(html.includes('<p>Watch <a href="https://youtu.be/pXz01Be-9hE">https://youtu.be/pXz01Be-9hE</a> here.</p>'), 'a link in a sentence stays a link');
  assert.equal(html.match(/<iframe/g)?.length, 2);
  assert.deepEqual(youtubeVideo('https://youtube.com/watch?v=short'), null);
  assert.deepEqual(youtubeVideo('https://youtu.be/pXz01Be-9hE?t=42'), { id: 'pXz01Be-9hE', start: 42 });
});

test('headings get the ids the wiki index gives them', () => {
  const html = render('## Step 2.1: Generate a Test Map\n\n## Tips\n\n## Tips\n\n### Step 1: Install `belt`');
  for (const id of ['step-21-generate-a-test-map', 'tips', 'tips-1', 'step-1-install-belt']) assert.ok(html.includes(`id="${id}"`), `${id} in ${html}`);
});

test('previews and redirects: /wiki, /wiki/<slug>, /wiki/all, former titles and /wiki/home', () => {
  const route = (path: string) => matchRoute(new URL(`https://abucnasty.dev${path}`));
  assert.deepEqual(route('/wiki'), { kind: 'wiki', slug: '' });
  assert.deepEqual(route('/wiki/'), { kind: 'wiki', slug: '' });
  assert.deepEqual(route('/wiki/how-to-benchmark'), { kind: 'wiki', slug: 'how-to-benchmark' });
  assert.equal(route('/wiki/a/b'), null);
  const pages = index.pages;
  assert.deepEqual(wikiPreview(pages, ''), { title: 'Wiki', description: 'Welcome.', path: '/wiki' });
  assert.deepEqual(wikiPreview(pages, 'how-to-benchmark'), { title: 'How to Benchmark', description: 'How to.', path: '/wiki/how-to-benchmark' });
  assert.match(wikiPreview(pages, 'setting-up-arch')!.description, /Setting Up Arch, a page of the Factorio benchmarking/);
  assert.equal(wikiPreview(pages, 'all')!.path, '/wiki/all');
  for (const slug of ['nope', 'home', 'benchmarking-101']) assert.equal(wikiPreview(pages, slug), null, slug);
  assert.equal(wikiRedirect(pages, 'benchmarking-101'), '/wiki/how-to-benchmark');
  assert.equal(wikiRedirect(pages, 'home'), '/wiki');
  assert.equal(wikiRedirect(pages, 'how-to-benchmark'), null);
  assert.equal(wikiRedirect(pages, 'nope'), null);
});
