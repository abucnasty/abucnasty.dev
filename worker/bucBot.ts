// The site's side of buc-bot (repository abucnasty/discord-bots). The bot holds the Discord bot
// token; the site holds none. Through the BUC_BOT service binding (wrangler.jsonc; RPC to the bot
// Worker's SiteApi entrypoint, no public HTTP) the site:
// - asks who holds the "Wiki Editor" role: wikiMember(userId). The bot keeps that list in its
//   Durable Object, fully re-synced at least hourly and updated on every member change between.
//   An answer whose last full sync is older than STALE_AFTER_MS (or that never synced) is not
//   used: the site says it couldn't check, never yes and never a silent no.
// - announces wiki edits: announceWikiEdit(edit). The bot posts it to the edits channel (its own
//   setting) with no mentions allowed.
// These types mirror the bot's shared/wiki.ts; change both together.

/** What wikiMember answers. */
export interface WikiMemberAnswer {
  /** The bot's last full sync of the role (ms since the epoch), or null if it never synced. */
  syncedAt: number | null;
  /** The user's entry if they hold the role, else null. */
  member: { editor: true; displayName: string; avatarUrl: string } | null;
}

/** A wiki edit, for the announcement in the edits channel. */
export interface WikiEdit {
  title: string;
  url: string;
  summary: string;
  editor: string;
  created: boolean;
  /** The embed's title instead of the page's (a rename, deletion or restore says what happened). */
  heading?: string;
}

export type AnnounceResult = { ok: true } | { ok: false; reason: string };

/** The BUC_BOT binding's RPC methods (the bot Worker's SiteApi entrypoint). */
export interface BucBotApi {
  wikiMember(userId: string): Promise<WikiMemberAnswer>;
  announceWikiEdit(edit: WikiEdit): Promise<AnnounceResult>;
}

/** Older than this, the bot's list is not trusted (its hourly sync has missed twice). */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Someone's role, from the bot: editor or not, or null when the bot can't say (and why). */
export async function wikiRole(
  bot: BucBotApi | undefined,
  userId: string,
  now: number,
): Promise<{ ok: true; member: WikiMemberAnswer['member'] } | { ok: false; reason: string }> {
  if (!bot) return { ok: false, reason: 'the BUC_BOT binding is missing' };
  let a: WikiMemberAnswer;
  try {
    a = await bot.wikiMember(userId);
  } catch (err) {
    return { ok: false, reason: `buc-bot: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!a || typeof a !== 'object') return { ok: false, reason: 'buc-bot: not an answer' };
  if (typeof a.syncedAt !== 'number') return { ok: false, reason: 'buc-bot has never synced the role' };
  const age = now - a.syncedAt;
  if (age > STALE_AFTER_MS) return { ok: false, reason: `buc-bot last synced the role ${Math.round(age / 60000)} minutes ago` };
  const m = a.member;
  if (m === null) return { ok: true, member: null };
  if (m?.editor !== true || typeof m.displayName !== 'string' || typeof m.avatarUrl !== 'string' || !m.avatarUrl.startsWith('https://cdn.discordapp.com/')) {
    return { ok: false, reason: 'buc-bot: not an answer' };
  }
  return { ok: true, member: m };
}
