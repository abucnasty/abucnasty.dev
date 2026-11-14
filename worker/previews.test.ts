import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG_URL, imageUrl, normaliseCatalog, stringUrl, versionUrl } from '../src/catalogCore.ts';
import { absoluteUrl, benchmarkPreview, blogPreview, blueprintPreview, clip, matchRoute } from './previews.ts';

const catalog = normaliseCatalog({
  schema: 1,
  generatedAt: '2026-11-01T00:00:00Z',
  commit: 'abc',
  blueprints: [
    {
      path: 'megabasing/common-quality-science/production-science-book',
      title: 'Production Science Book',
      authors: ['abucnasty', 'friend'],
      deprecated: false,
      blueprint: { kind: 'blueprint-book', counts: { blueprints: 3, books: 1, entities: 100, tiles: 0 } },
      history: [],
      renders: [{ file: '0.jpg', oid: 'o', size: 1 }, { file: '1.jpg', oid: 'o', size: 1 }, { file: '2/0.jpg', oid: 'o', size: 1 }],
      cover: '0.jpg',
      nodes: [
        { slot: 0, path: '0', kind: 'blueprint', label: 'Red science', render: '1.jpg' },
        { slot: 1, path: '1', kind: 'blueprint', label: '' },
        {
          slot: 2,
          path: '2',
          kind: 'blueprint-book',
          label: 'Smelting',
          children: [{ slot: 0, path: '2/0', kind: 'blueprint', label: 'Iron <plates> & "steel"', render: '2/0.jpg' }],
        },
      ],
    },
    {
      path: 'space/hidden-one',
      title: 'Hidden',
      authors: [],
      deprecated: false,
      status: 'unlisted',
      previous_paths: ['space/old-name'],
      blueprint: { kind: 'blueprint', counts: { blueprints: 1, books: 0, entities: 5, tiles: 0 }, description: 'Its own   description.' },
      history: [],
      renders: [],
    },
  ],
});

const url = (s: string) => new URL(s, 'https://example.test');

test('matchRoute: blueprint paths and the entry query', () => {
  assert.deepEqual(matchRoute(url('/blueprints/a/b/c')), { kind: 'blueprint', path: 'a/b/c', entry: null });
  assert.deepEqual(matchRoute(url('/blueprints/a/b/?entry=/3/1/')), { kind: 'blueprint', path: 'a/b', entry: '3/1' });
  assert.deepEqual(matchRoute(url('/blueprints/100%25-belts')), { kind: 'blueprint', path: '100%-belts', entry: null });
  assert.equal(matchRoute(url('/blueprints/%E0%A4%A')), null);
  assert.equal(matchRoute(url('/blueprints')), null);
  assert.equal(matchRoute(url('/blueprints/')), null);
});

test('matchRoute: one-segment benchmark and blog slugs only', () => {
  assert.deepEqual(matchRoute(url('/benchmarks/miners')), { kind: 'benchmark', slug: 'miners' });
  assert.deepEqual(matchRoute(url('/benchmarks/miners/')), { kind: 'benchmark', slug: 'miners' });
  assert.deepEqual(matchRoute(url('/blog/a-post')), { kind: 'blog', slug: 'a-post' });
  assert.equal(matchRoute(url('/benchmarks/miners/images/x.png')), null);
  assert.equal(matchRoute(url('/blog/posts/a/x.png')), null);
  assert.equal(matchRoute(url('/benchmarks')), null);
  assert.equal(matchRoute(url('/')), null);
  assert.equal(matchRoute(url('/about')), null);
});

test('blueprintPreview: whole entry uses title, authors, category and cover', () => {
  assert.deepEqual(blueprintPreview(catalog, 'megabasing/common-quality-science/production-science-book', null), {
    title: 'Production Science Book',
    description: 'Factorio blueprint book by abucnasty, friend. Megabasing / Common Quality Science.',
    path: '/blueprints/megabasing/common-quality-science/production-science-book',
    image: 'https://vault.abucnasty.dev/blueprints/megabasing/common-quality-science/production-science-book/renders/0.jpg',
  });
});

test('blueprintPreview: a slot gets its label and its own render', () => {
  const p = blueprintPreview(catalog, 'megabasing/common-quality-science/production-science-book', '2/0');
  assert.equal(p?.title, 'Iron <plates> & "steel", in Production Science Book');
  assert.equal(p?.path, '/blueprints/megabasing/common-quality-science/production-science-book?entry=2/0');
  assert.equal(p?.image, 'https://vault.abucnasty.dev/blueprints/megabasing/common-quality-science/production-science-book/renders/2/0.jpg');
  assert.match(p?.description ?? '', /^Factorio blueprint by abucnasty, friend, in Production Science Book\./);
});

test('blueprintPreview: a nested book shows the first render beneath it; an unlabelled slot gets a name', () => {
  assert.equal(blueprintPreview(catalog, 'megabasing/common-quality-science/production-science-book', '2')?.image?.endsWith('/renders/2/0.jpg'), true);
  const unlabelled = blueprintPreview(catalog, 'megabasing/common-quality-science/production-science-book', '1');
  assert.equal(unlabelled?.title, 'Blueprint (slot 1), in Production Science Book');
  assert.equal(unlabelled?.image, undefined);
});

test('blueprintPreview: unknown slot falls back to the entry; unknown path gives null', () => {
  const p = blueprintPreview(catalog, 'megabasing/common-quality-science/production-science-book', '9/9');
  assert.equal(p?.title, 'Production Science Book');
  assert.equal(p?.path, '/blueprints/megabasing/common-quality-science/production-science-book');
  assert.equal(blueprintPreview(catalog, 'nope/nothing', null), null);
});

test('blueprintPreview: unlisted entries and former paths resolve, with the current path', () => {
  const p = blueprintPreview(catalog, 'space/old-name', null);
  assert.deepEqual(p, { title: 'Hidden', description: 'Its own description.', path: '/blueprints/space/hidden-one' });
});

test('blueprintPreview: paths are percent-encoded in URLs', () => {
  const odd = normaliseCatalog({
    blueprints: [{ path: 'a/100% belts', title: 'T', authors: [], blueprint: { kind: 'blueprint' }, renders: [], cover: '0.jpg' }],
  });
  const p = blueprintPreview(odd, 'a/100% belts', null);
  assert.equal(p?.path, '/blueprints/a/100%25%20belts');
  assert.equal(p?.image, 'https://vault.abucnasty.dev/blueprints/a/100%25%20belts/renders/0.jpg');
});

test('benchmark and blog previews', () => {
  const benchmarks = [
    { slug: 'miners', title: 'Miners', summary: 'Drills compared.' },
    { slug: 'q', title: 'Q', question: 'Does it?', finding: 'Yes.' },
    { slug: 'bare', title: 'Bare' },
  ];
  assert.deepEqual(benchmarkPreview(benchmarks, 'miners'), { title: 'Miners', description: 'Drills compared.', path: '/benchmarks/miners' });
  assert.equal(benchmarkPreview(benchmarks, 'q')?.description, 'Does it?');
  assert.equal(benchmarkPreview(benchmarks, 'bare')?.description, 'A Factorio UPS benchmark: Bare.');
  assert.equal(benchmarkPreview(benchmarks, 'missing'), null);

  const posts = [{ slug: 'p', title: 'Post', description: 'About it' }, { slug: 'n', title: 'No description' }];
  assert.deepEqual(blogPreview(posts, 'p'), { title: 'Post', description: 'About it', path: '/blog/p' });
  assert.equal(blogPreview(posts, 'n')?.description, 'No description');
  assert.equal(blogPreview(posts, 'x'), null);
});

test('clip and absoluteUrl', () => {
  assert.equal(clip('short'), 'short');
  const long = clip('word '.repeat(100), 40);
  assert.ok(long.length <= 40 && long.endsWith('word…'), long);
  assert.equal(absoluteUrl('https://abucnasty.dev/', '/blog/p'), 'https://abucnasty.dev/blog/p');
  assert.equal(absoluteUrl('https://abucnasty.dev', '/x?entry=1'), 'https://abucnasty.dev/x?entry=1');
});

test('vault links: the index at the root, strings and images under /blueprints/, versions by label only', () => {
  assert.equal(CATALOG_URL, 'https://vault.abucnasty.dev/index.json');
  assert.equal(stringUrl('grids/substation/trains-substation-grid'), 'https://vault.abucnasty.dev/blueprints/grids/substation/trains-substation-grid.txt');
  assert.equal(stringUrl('a/b', '3/1'), 'https://vault.abucnasty.dev/blueprints/a/b/3/1.txt');
  assert.equal(imageUrl('a/b', '0.jpg'), 'https://vault.abucnasty.dev/blueprints/a/b/renders/0.jpg');
  assert.equal(versionUrl('a/b', { label: 'MK 2', subject: 'MK 2' }), 'https://vault.abucnasty.dev/blueprints/a/b@MK%202.txt');
});
