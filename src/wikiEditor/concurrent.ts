// What the editor says about edits made by someone else while it was open (worker/wikiMerge.ts):
// who and when, in words. Pure, so it is unit-tested under Node (worker/wikiMerge.test.ts).

/** Another edit to the page, as the Worker names it (worker/wikiMerge.ts). */
export interface OtherEdit {
  author: string;
  /** ISO 8601. */
  date: string;
  summary: string;
}

/** What savedNotice reads of a save's answer (api.ts SaveResult). */
interface Saved {
  title: string;
  unchanged?: boolean;
  merged?: { edits: OtherEdit[] };
  renamedFrom?: string;
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago", or the date. */
export function timeAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'a while ago';
  const s = Math.max(0, Math.round((now - then) / 1000));
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return unit(Math.round(s / 60), 'minute');
  if (s < 86400) return unit(Math.round(s / 3600), 'hour');
  if (s < 30 * 86400) return unit(Math.round(s / 86400), 'day');
  return `on ${new Date(then).toISOString().slice(0, 10)}`;
}

/** "Ana's edit from 5 minutes ago", "3 other edits", or "another edit" (nobody known). */
export function otherEditsPhrase(edits: OtherEdit[], now: number): string {
  if (edits.length === 0) return 'another edit';
  if (edits.length > 1) return `${edits.length} other edits`;
  const when = timeAgo(edits[0].date, now);
  return `${edits[0].author}'s edit from ${when}`;
}

/** Who made the other edits, for "... changed the same part": a name, "N other edits" or "Someone else". */
export function otherEditors(edits: OtherEdit[], now: number): string {
  if (edits.length === 0) return 'Someone else';
  if (edits.length > 1) return `${edits.length} other edits`;
  return `${edits[0].author} (${timeAgo(edits[0].date, now)})`;
}

/** The page view's words about a save that was combined with other edits or moved, or undefined. */
export function savedNotice(result: Saved, now: number): string | undefined {
  const parts: string[] = [];
  if (result.renamedFrom) parts.push(`This page was renamed to ${result.title} while you were editing; your edit was saved there.`);
  if (result.merged) {
    const phrase = otherEditsPhrase(result.merged.edits, now);
    if (result.unchanged) parts.push(`The same changes were already made by ${phrase}.`);
    else parts.push(`Your edit was combined with ${phrase}.`);
  }
  return parts.length ? parts.join(' ') : undefined;
}
