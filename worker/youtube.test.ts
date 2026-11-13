import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playlistItemsUrl, trimPlaylistItems } from './youtube.ts';

test('the request asks for one item of the uploads playlist', () => {
  const url = new URL(playlistItemsUrl('k&y'));
  assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/playlistItems');
  assert.equal(url.searchParams.get('part'), 'snippet');
  assert.equal(url.searchParams.get('maxResults'), '1');
  assert.equal(url.searchParams.get('playlistId'), 'UUSdiZ-R-EnnHqKvCrZdQMBQ');
  assert.equal(url.searchParams.get('key'), 'k&y');
});

test('keeps only id, title, published and url', () => {
  const raw = {
    kind: 'youtube#playlistItemListResponse',
    etag: 'x',
    items: [
      {
        snippet: {
          title: 'Megabase tour',
          publishedAt: '2026-11-01T12:00:00Z',
          description: 'long text',
          thumbnails: { high: { url: 'https://i.ytimg.com/x.jpg' } },
          resourceId: { kind: 'youtube#video', videoId: 'abc_DEF-123' },
        },
      },
    ],
  };
  assert.deepEqual(trimPlaylistItems(raw), {
    id: 'abc_DEF-123',
    title: 'Megabase tour',
    published: '2026-11-01T12:00:00Z',
    url: 'https://www.youtube.com/watch?v=abc_DEF-123',
  });
});

test('a missing title or date does not drop the video', () => {
  assert.deepEqual(trimPlaylistItems({ items: [{ snippet: { resourceId: { videoId: 'v1' } } }] }), {
    id: 'v1',
    title: '',
    url: 'https://www.youtube.com/watch?v=v1',
  });
});

test('no video, or a malformed answer, gives null', () => {
  for (const raw of [null, {}, { items: [] }, { items: [{}] }, { items: [{ snippet: { resourceId: {} } }] }, { items: [{ snippet: { resourceId: { videoId: 'a"b' } } }] }, { items: 'x' }]) {
    assert.equal(trimPlaylistItems(raw), null, JSON.stringify(raw));
  }
});
