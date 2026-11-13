// GET /api/latest-video: the channel's newest upload, fetched server-side with the
// YOUTUBE_API_KEY secret so the key never reaches the browser.
//
// An answer is fresh for an hour. It is kept in this isolate's memory and in the Cache API (for a
// week), so when YouTube fails the last good answer is served instead of an error.
import { playlistItemsUrl, trimPlaylistItems, type LatestVideo } from './youtube.ts';

const FRESH_SECONDS = 60 * 60;
const KEEP_SECONDS = 7 * 24 * 60 * 60;
const CACHE_NAME = 'latest-video';

interface Stored {
  video: LatestVideo;
  /** Epoch milliseconds. */
  fetchedAt: number;
}

let memory: Stored | null = null;

export async function latestVideo(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new URL('/api/latest-video', request.url).toString();
  const stored = memory ?? (await readCache(cacheKey));
  const age = stored ? (Date.now() - stored.fetchedAt) / 1000 : Infinity;
  if (stored && age < FRESH_SECONDS) return answer(stored.video, FRESH_SECONDS - age);

  if (!env.YOUTUBE_API_KEY) {
    if (stored) return answer(stored.video, 60);
    return failure(503, 'not_configured', 'The YOUTUBE_API_KEY secret is not set on this Worker.');
  }

  try {
    // The Referer lets the key keep a website restriction in Google Cloud (see README).
    const res = await fetch(playlistItemsUrl(env.YOUTUBE_API_KEY), { headers: { Referer: `${env.SITE_URL}/` } });
    if (!res.ok) throw new Error(`YouTube answered HTTP ${res.status}.`);
    const video = trimPlaylistItems(await res.json());
    if (!video) throw new Error('YouTube returned no video.');
    memory = { video, fetchedAt: Date.now() };
    ctx.waitUntil(writeCache(cacheKey, memory));
    return answer(video, FRESH_SECONDS);
  } catch (err) {
    console.error('latest-video:', err);
    if (stored) return answer(stored.video, 60);
    return failure(502, 'upstream_error', err instanceof Error ? err.message : 'YouTube could not be reached.');
  }
}

function answer(video: LatestVideo, maxAge: number): Response {
  return Response.json(video, { headers: { 'Cache-Control': `public, max-age=${Math.max(0, Math.floor(maxAge))}` } });
}

function failure(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readCache(key: string): Promise<Stored | null> {
  try {
    const hit = await (await caches.open(CACHE_NAME)).match(key);
    if (!hit) return null;
    const data = (await hit.json()) as Partial<Stored>;
    if (!data.video || typeof data.fetchedAt !== 'number') return null;
    return (memory = { video: data.video, fetchedAt: data.fetchedAt });
  } catch {
    return null;
  }
}

async function writeCache(key: string, stored: Stored): Promise<void> {
  try {
    const body = Response.json(stored, { headers: { 'Cache-Control': `max-age=${KEEP_SECONDS}` } });
    await (await caches.open(CACHE_NAME)).put(key, body);
  } catch (err) {
    console.error('latest-video: cache write failed:', err);
  }
}
