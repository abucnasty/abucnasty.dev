import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOG_INDEX_URL, listedPosts, normaliseBlogIndex, postMarkdownUrl, resolvePostUrl } from '../src/blogCore.ts';

const BLOB = 'e'.repeat(40);

test('normaliseBlogIndex: keeps usable posts, newest first, and fills defaults', () => {
  const index = normaliseBlogIndex({
    schema: 1,
    generatedAt: '2026-11-14T00:00:00Z',
    commit: 'abc',
    futureField: true,
    posts: [
      { slug: 'older', title: 'Older', date: '2026-05-11', description: 'd', tags: ['ups-wars'], status: 'public', files: [] },
      { slug: 'hidden', title: 'Hidden', date: '2026-06-01', status: 'unlisted' },
      { slug: 'newer', title: 'Newer', date: '2026-05-13', tags: ['fps', 3], status: 'whatever', files: [{ path: 'a.jpg', size: 1, blob: BLOB }] },
      { slug: 'broken' },
      null,
    ],
  });
  assert.deepEqual(index.posts.map((p) => p.slug), ['hidden', 'newer', 'older']);
  assert.deepEqual(index.posts[1], {
    slug: 'newer',
    title: 'Newer',
    date: '2026-05-13',
    description: '',
    tags: ['fps'],
    status: 'public',
    files: [{ path: 'a.jpg', size: 1, blob: BLOB }],
  });
  assert.deepEqual(listedPosts(index).map((p) => p.slug), ['newer', 'older'], 'unlisted posts are left out of lists');
  assert.throws(() => normaliseBlogIndex({ schema: 1 }), /no posts list/);
});

test('blog URLs: the index and a post on the vault host', () => {
  assert.equal(BLOG_INDEX_URL, 'https://vault.abucnasty.dev/blog/index.json');
  assert.equal(postMarkdownUrl('fps-limit-impact-on-factorio-ups'), 'https://vault.abucnasty.dev/blog/fps-limit-impact-on-factorio-ups/index.md');
});

test('resolvePostUrl: relative URLs resolve against the post folder in the vault', () => {
  const post = { slug: 'fps', files: [{ path: 'screenshots/a b.jpg', size: 1, blob: BLOB }, { path: 'data.csv', size: 1, blob: 'f'.repeat(40) }] };
  assert.equal(resolvePostUrl('./screenshots/a%20b.jpg', post), `https://vault.abucnasty.dev/blog/fps/screenshots/a%20b.jpg?v=${BLOB}`);
  assert.equal(resolvePostUrl('screenshots/a%20b.jpg', post), `https://vault.abucnasty.dev/blog/fps/screenshots/a%20b.jpg?v=${BLOB}`);
  assert.equal(resolvePostUrl('./not-listed.png', post), 'https://vault.abucnasty.dev/blog/fps/not-listed.png');
  assert.equal(resolvePostUrl('data.csv#top', post), `https://vault.abucnasty.dev/blog/fps/data.csv?v=${'f'.repeat(40)}#top`);
  // A link to another post's note or folder opens it on the site.
  assert.equal(resolvePostUrl('../other-post/README.md', post), '/blog/other-post');
  assert.equal(resolvePostUrl('../other-post/', post), '/blog/other-post');
  // Absolute URLs, site paths and anchors are left alone.
  for (const url of ['https://github.com/x', '//cdn.example/x.png', '/benchmarks/miners', '#answer', 'mailto:a@b.c', '']) {
    assert.equal(resolvePostUrl(url, post), url);
  }
  // Leaving the blog folder is just a vault URL.
  assert.equal(resolvePostUrl('../../index.json', post), 'https://vault.abucnasty.dev/index.json');
});
