// A stand-in for the BUC_BOT binding (bucBot.ts), for the Worker's tests. Each call is recorded as
// { method: 'RPC', url: 'buc-bot/<method>', body: <argument> } in the test's own call list.
import type { AnnounceResult, BucBotApi, WikiEdit, WikiMemberAnswer } from './bucBot.ts';

export interface FakeBucBotOptions {
  /** Whether the user holds the Wiki Editor role now (default: yes). */
  editor?: () => boolean;
  displayName?: string;
  avatarUrl?: string;
  /** The bot's last full sync (default: now). null: never synced. */
  syncedAt?: () => number | null;
  /** Replaces wikiMember (to answer something else, or throw). */
  wikiMember?: () => Promise<WikiMemberAnswer>;
  announce?: (edit: WikiEdit) => AnnounceResult | Promise<AnnounceResult>;
}

export function fakeBucBot(o: FakeBucBotOptions, calls: Array<{ method: string; url: string; body?: any }>, now: () => number): BucBotApi {
  return {
    async wikiMember(userId) {
      calls.push({ method: 'RPC', url: 'buc-bot/wikiMember', body: userId });
      if (o.wikiMember) return o.wikiMember();
      const syncedAt = o.syncedAt ? o.syncedAt() : now();
      const editor = o.editor ? o.editor() : true;
      return {
        syncedAt,
        member: editor ? { editor: true, displayName: o.displayName ?? 'Buc the Editor', avatarUrl: o.avatarUrl ?? 'https://cdn.discordapp.com/embed/avatars/0.png' } : null,
      };
    },
    async announceWikiEdit(edit) {
      calls.push({ method: 'RPC', url: 'buc-bot/announceWikiEdit', body: edit });
      return o.announce ? o.announce(edit) : { ok: true };
    },
  };
}
