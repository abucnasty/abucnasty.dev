// The YouTube request behind /api/latest-video and the trimming of its answer.
// Pure: no Worker globals, so it is unit-tested under Node (youtube.test.ts).

const CHANNEL_ID = 'UCSdiZ-R-EnnHqKvCrZdQMBQ';
// A channel's uploads playlist is its ID with `UC` replaced by `UU`. Its first item costs 1 quota
// unit, vs. 100 for the search endpoint.
const UPLOADS_PLAYLIST_ID = `UU${CHANNEL_ID.slice(2)}`;

/** What /api/latest-video returns, and all that src/components/LatestVideo.tsx reads. */
export interface LatestVideo {
  id: string;
  title: string;
  /** ISO date-time. */
  published?: string;
  url: string;
}

/** The newest upload of the channel: one playlistItems call. */
export function playlistItemsUrl(apiKey: string): string {
  const params = new URLSearchParams({ part: 'snippet', maxResults: '1', playlistId: UPLOADS_PLAYLIST_ID, key: apiKey });
  return `https://www.googleapis.com/youtube/v3/playlistItems?${params}`;
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: unknown;
      publishedAt?: unknown;
      resourceId?: { videoId?: unknown };
    };
  }>;
}

/** The fields the site needs from a playlistItems answer, or null when it holds no video. */
export function trimPlaylistItems(raw: unknown): LatestVideo | null {
  const items = (raw as PlaylistItemsResponse | null)?.items;
  const snippet = Array.isArray(items) ? items[0]?.snippet : undefined;
  const id = snippet?.resourceId?.videoId;
  if (!snippet || typeof id !== 'string' || !/^[\w-]+$/.test(id)) return null;
  return {
    id,
    title: typeof snippet.title === 'string' ? snippet.title : '',
    ...(typeof snippet.publishedAt === 'string' && { published: snippet.publishedAt }),
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}
