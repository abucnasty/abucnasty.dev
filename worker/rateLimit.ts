// How often one wiki editor may save: at most SAVE_LIMIT saves in any SAVE_WINDOW_MS. The count
// lives in a Durable Object (WikiRateLimiter, SQLite storage), one per Discord user id, which
// `wrangler deploy` creates from the migration in wrangler.jsonc: no resource to make by hand, and
// one object per user sees every save in order, so two saves at once cannot both take the last
// slot. The object keeps the times of the saves in the window, nothing else.
//
// The counting (takeSlot) is here, pure, so it is unit-tested under Node; the Durable Object that
// keeps the stamps is rateLimitObject.ts.

export const SAVE_LIMIT = 20;
export const SAVE_WINDOW_MS = 10 * 60 * 1000;

export interface Slot {
  ok: boolean;
  /** Seconds until a slot frees up, when refused. */
  retryAfter: number;
}

/** Take a slot from `stamps` (save times, ms) at `now`: the stamps to keep and the answer. */
export function takeSlot(stamps: readonly number[], now: number, limit = SAVE_LIMIT, windowMs = SAVE_WINDOW_MS): { stamps: number[]; slot: Slot } {
  const live = stamps.filter((t) => t > now - windowMs && t <= now + 60_000).sort((a, b) => a - b);
  if (live.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((live[live.length - limit] + windowMs - now) / 1000));
    return { stamps: live, slot: { ok: false, retryAfter } };
  }
  return { stamps: [...live, now], slot: { ok: true, retryAfter: 0 } };
}
