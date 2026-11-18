// The save rate limit's Durable Object (see rateLimit.ts): one per Discord user id, keeping the
// times of that editor's saves in the window. SQLite-backed (the migration in wrangler.jsonc), so
// `wrangler deploy` creates it; the key-value storage API is used, nothing else.
import { DurableObject } from 'cloudflare:workers';
import { takeSlot, type Slot } from './rateLimit.ts';

export class WikiRateLimiter extends DurableObject {
  /** Take a save slot now (RPC). */
  async take(): Promise<Slot> {
    const stamps = (await this.ctx.storage.get<number[]>('stamps')) ?? [];
    const { stamps: next, slot } = takeSlot(stamps, Date.now());
    await this.ctx.storage.put('stamps', next);
    return slot;
  }
}

/** Take a save slot for a user. Throws when the object cannot answer. */
export function takeSaveSlot(ns: DurableObjectNamespace<WikiRateLimiter>, userId: string): Promise<Slot> {
  return ns.get(ns.idFromName(`wiki-save:${userId}`)).take();
}
