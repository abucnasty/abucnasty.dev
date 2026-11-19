// A wiki page's history and the recently deleted pages, read from the vault's commits on GitHub
// (github.ts). Pure apart from the GitHub calls passed in, so it is unit-tested under Node
// (wikiHistory.test.ts); wikiApi.ts caches what this builds (see there for the cost per view).
//
// History follows renames. GitHub's commits list for a path does not, so the oldest commit on a
// path is looked at: if it made the file by moving another page there, the history goes on with
// that page's commits from before the move.
//   - Site renames say so in a trailer: `Wiki-Renamed-From: wiki/Old.md` (and a deleted page
//     restored under another title: `Wiki-Restored-From: wiki/Old.md`). No extra call.
//   - Anything else (the owner's Obsidian renames, pushed with git) is checked with the commit's
//     file list: a file GitHub reports as "renamed" (git's rename detection: the moved file is at
//     least half the same) names its `previous_filename`. A rename git sees as a delete and an add
//     (the page was also rewritten in the same commit) is not followed: the history starts there.
//
// Recently deleted pages: the commits that touched wiki/ in the last RECENT_DAYS days.
//   - Site deletions carry `Wiki-Deleted: wiki/Page.md`: no extra call.
//   - Every other commit (not made by the site) is checked with its file list for removed pages
//     ("removed"; a rename is "renamed", not a deletion).
// A page is listed once (its latest deletion), and only while nothing is at its path again.
import type { CommitFile, ListedCommit } from './github.ts';
import { isSiteCommit } from './wikiSave.ts';
import { isPagePath, pageFolder, pageTitle } from '../src/wikiSource.ts';

/** The trailers site commits write (see wikiPages.ts). */
export const TRAILER = {
  renamedFrom: 'Wiki-Renamed-From',
  deleted: 'Wiki-Deleted',
  restoredFrom: 'Wiki-Restored-From',
  restoredVersion: 'Wiki-Restored-Version',
} as const;

/** The value of a trailer in a commit message (the last one, as git reads them), or null. */
export function trailer(message: string, key: string): string | null {
  const re = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'gm');
  let value: string | null = null;
  for (const m of message.matchAll(re)) value = m[1];
  return value;
}

/** Commits listed per call; a page with more on one path shows the newest PER_PAGE there. */
export const PER_PAGE = 100;
/** Renames followed at most. */
export const MAX_RENAMES = 10;
export const RECENT_DAYS = 90;
/** Pages of commits (PER_PAGE each) read for recently deleted pages. */
export const MAX_COMMIT_PAGES = 5;

export interface HistoryGitHub {
  commits(q: { sha: string; path?: string; since?: string; perPage: number; page?: number }): Promise<ListedCommit[]>;
  commitFiles(sha: string): Promise<CommitFile[]>;
}

export interface HistoryEntry {
  sha: string;
  /** The author date (ISO 8601). */
  date: string;
  /** The commit author's name: the editor's display name for a site edit, the git author's otherwise. Never an email. */
  author: string;
  /** The commit's subject line. */
  summary: string;
  /** Where the page was after this commit (the path its version at this commit is read from). */
  path: string;
  kind?: 'renamed' | 'deleted' | 'restored';
  /** A rename's (or a restore under another title's) path before. */
  from?: string;
  /** Made on the site. */
  site: boolean;
}

export interface PageHistory {
  path: string;
  /** Newest first. */
  entries: HistoryEntry[];
  /** Older edits exist than these (see the vault on GitHub). */
  truncated: boolean;
}

const subject = (message: string) => message.split('\n', 1)[0].trim();

function entryOf(c: ListedCommit, path: string): HistoryEntry {
  const e: HistoryEntry = { sha: c.sha, date: c.date, author: c.author, summary: subject(c.message), path, site: isSiteCommit(c.message) };
  const renamed = trailer(c.message, TRAILER.renamedFrom);
  const restored = trailer(c.message, TRAILER.restoredFrom);
  if (renamed) Object.assign(e, { kind: 'renamed', from: renamed });
  else if (trailer(c.message, TRAILER.deleted)) e.kind = 'deleted';
  else if (restored || trailer(c.message, TRAILER.restoredVersion)) Object.assign(e, { kind: 'restored', ...(restored && restored !== path ? { from: restored } : {}) });
  return e;
}

/** Where the page at `path` was before commit `c` made it, if `c` moved it there; else null. */
async function movedFrom(gh: HistoryGitHub, c: ListedCommit, path: string): Promise<string | null> {
  const told = trailer(c.message, TRAILER.renamedFrom) ?? trailer(c.message, TRAILER.restoredFrom);
  if (told !== null) return told !== path && isPagePath(told) ? told : null;
  // A site commit that names no rename made the page here (or edited it): nothing to look up.
  if (isSiteCommit(c.message)) return null;
  const f = (await gh.commitFiles(c.sha)).find((x) => x.filename === path);
  return f?.status === 'renamed' && f.previous_filename && isPagePath(f.previous_filename) ? f.previous_filename : null;
}

/** The history of the page at `path` on `branch`, newest first, across its renames. */
export async function pageHistory(gh: HistoryGitHub, path: string, branch: string): Promise<PageHistory> {
  const entries: HistoryEntry[] = [];
  const seen = new Set<string>();
  const paths = new Set<string>([path]);
  let current = path;
  let from = branch;
  for (let hop = 0; hop <= MAX_RENAMES; hop++) {
    const listed = await gh.commits({ sha: from, path: current, perPage: PER_PAGE });
    const fresh = listed.filter((c) => !seen.has(c.sha));
    for (const c of fresh) {
      seen.add(c.sha);
      entries.push(entryOf(c, current));
    }
    if (listed.length >= PER_PAGE) return { path, entries, truncated: true };
    const oldest = fresh[fresh.length - 1];
    if (!oldest) break;
    const before = await movedFrom(gh, oldest, current);
    if (before === null || paths.has(before)) break;
    const e = entries[entries.length - 1];
    if (e.kind !== 'restored') Object.assign(e, { kind: 'renamed' });
    e.from = before;
    paths.add(before);
    current = before;
    // The commits on the old path up to the move (the move itself is listed there too: seen).
    from = oldest.sha;
  }
  return { path, entries, truncated: false };
}

export interface DeletedPage {
  path: string;
  title: string;
  folder: string;
  /** The commit that deleted it; its first parent has the last version. */
  commit: string;
  date: string;
  author: string;
  site: boolean;
}

export interface DeletedPages {
  pages: DeletedPage[];
  /** Not every commit could be checked this time (too many): the list may miss some. */
  partial: boolean;
}

/**
 * Pages deleted on `branch` since `since` (ISO), newest first, that are not back at their path
 * (`live`: every path under wiki/ now). `mayFetch` says whether another commit's file list may be
 * fetched now (a budget per view); commits past it are skipped and the answer is partial.
 */
export async function recentlyDeleted(
  gh: HistoryGitHub,
  branch: string,
  since: string,
  live: ReadonlySet<string>,
  mayFetch: () => boolean,
): Promise<DeletedPages> {
  const found = new Map<string, DeletedPage>();
  let partial = false;
  const record = (path: string, c: ListedCommit) => {
    if (found.has(path) || !isPagePath(path)) return;
    found.set(path, { path, title: pageTitle(path), folder: pageFolder(path), commit: c.sha, date: c.date, author: c.author, site: isSiteCommit(c.message) });
  };
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const commits = await gh.commits({ sha: branch, path: 'wiki', since, perPage: PER_PAGE, page });
    for (const c of commits) {
      if (isSiteCommit(c.message)) {
        const p = trailer(c.message, TRAILER.deleted);
        if (p) record(p, c);
        continue;
      }
      if (!mayFetch()) {
        partial = true;
        continue;
      }
      for (const f of await gh.commitFiles(c.sha)) if (f.status === 'removed') record(f.filename, c);
    }
    if (commits.length < PER_PAGE) break;
    if (page === MAX_COMMIT_PAGES) partial = true;
  }
  const pages = [...found.values()].filter((p) => !live.has(p.path));
  return { pages, partial };
}
