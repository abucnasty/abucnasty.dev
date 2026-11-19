// Saving over someone else's edit (wikiSave.ts): when the page on main is no longer the blob the
// editor started from, the editor's body is merged with main's, three ways, line by line:
//   base   = the page the editor opened (its blob),
//   theirs = the page on main now (another site save, an Obsidian push, a restore ...),
//   mine   = the editor's text.
// Changes to different lines (not touching each other) are combined; a stretch both changed
// differently is a conflict, which the editor resolves side by side (src/wikiEditor/Combine.tsx).
// Frontmatter is never merged: it is taken from main (see wikiSave.ts).
//
// Also here: who made the other edits (the commits on the page since the editor opened it), and
// where a page went when it is not at its path any more (renamed, or deleted).
//
// The merge is node-diff3 (MIT, a port of GNU diff3's algorithm, no dependencies); pure, so it
// runs in the Worker and is unit-tested under Node (wikiMerge.test.ts).
import { diff3Merge } from 'node-diff3';
import type { CommitFile, ListedCommit } from './github.ts';
import { TRAILER, trailer } from './wikiHistory.ts';
import { isPagePath } from '../src/wikiSource.ts';

export interface TextMerge {
  /** No overlapping changes: `text` is the merged text. */
  clean: boolean;
  /** The merged text; where both sides changed the same lines differently, the editor's lines. */
  text: string;
  /** How many stretches overlap. */
  conflicts: number;
}

const lines = (s: string) => s.split('\n');

/** Merge `mine` and `theirs`, both edits of `base`, line by line. */
export function mergeText(base: string, theirs: string, mine: string): TextMerge {
  if (theirs === base || theirs === mine) return { clean: true, text: mine, conflicts: 0 };
  if (mine === base) return { clean: true, text: theirs, conflicts: 0 };
  const out: string[] = [];
  let conflicts = 0;
  // a = mine, o = base, b = theirs; identical changes on both sides are no conflict.
  for (const region of diff3Merge(lines(mine), lines(base), lines(theirs), { excludeFalseConflicts: true })) {
    if (region.ok) out.push(...region.ok);
    else if (region.conflict) {
      conflicts++;
      out.push(...region.conflict.a);
    }
  }
  return { clean: conflicts === 0, text: out.join('\n'), conflicts };
}

/** Another edit to the page, as the editor is told of it. Never an email. */
export interface OtherEdit {
  author: string;
  /** ISO 8601. */
  date: string;
  summary: string;
}

export interface MergeGitHub {
  commits(q: { sha: string; path?: string; perPage: number }): Promise<ListedCommit[]>;
  commitFiles(sha: string): Promise<CommitFile[]>;
}

/** Commits listed per path to name the other edits. */
const EDITS_LISTED = 30;

/**
 * The edits made to the page between the head the editor opened it at (`baseHead`, where it was
 * `basePath`) and main's `head` (where it is `path`), newest first: the commits on the page now
 * that were not on it then. Best effort: [] when it can't be told (no head from the editor, or
 * GitHub did not answer); a save never fails over it.
 */
export async function otherEdits(gh: MergeGitHub, q: { path: string; head: string; basePath: string; baseHead: string | null }, log: (m: string) => void): Promise<OtherEdit[]> {
  if (!q.baseHead || q.baseHead === q.head) return [];
  try {
    const [now, then] = await Promise.all([
      gh.commits({ sha: q.head, path: q.path, perPage: EDITS_LISTED }),
      gh.commits({ sha: q.baseHead, path: q.basePath, perPage: EDITS_LISTED }),
    ]);
    const seen = new Set(then.map((c) => c.sha));
    return now.filter((c) => !seen.has(c.sha)).map((c) => ({ author: c.author || 'Someone', date: c.date, summary: c.message.split('\n', 1)[0].trim() }));
  } catch (err) {
    log(`wiki merge: other edits: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Where a page that is not at its path any more went. */
export type Whereabouts = { kind: 'moved'; path: string; by: OtherEdit } | { kind: 'deleted'; by: OtherEdit | null };

/** Renames followed at most (renamed again while being edited). */
const MAX_MOVES = 3;

const editOf = (c: ListedCommit): OtherEdit => ({ author: c.author || 'Someone', date: c.date, summary: c.message.split('\n', 1)[0].trim() });

/**
 * Where the page at `path` went by `head` (`exists` says what is on main now): the last commit on
 * the path removed it; if that commit moved it (GitHub's rename detection names the file it became,
 * or a site rename's `Wiki-Renamed-From` trailer names this path and the commit added one page),
 * that is where it is, followed up to MAX_MOVES times. Otherwise it was deleted.
 */
export async function whereabouts(gh: MergeGitHub, path: string, head: string, exists: (path: string) => boolean): Promise<Whereabouts> {
  let at = path;
  let by: OtherEdit | null = null;
  for (let hop = 0; hop < MAX_MOVES; hop++) {
    const [last] = await gh.commits({ sha: head, path: at, perPage: 1 });
    if (!last) return { kind: 'deleted', by };
    by = editOf(last);
    const files = await gh.commitFiles(last.sha);
    let next = files.find((f) => f.status === 'renamed' && f.previous_filename === at && isPagePath(f.filename))?.filename;
    if (!next && trailer(last.message, TRAILER.renamedFrom) === at) {
      const added = files.filter((f) => f.status === 'added' && isPagePath(f.filename));
      if (added.length === 1) next = added[0].filename;
    }
    if (!next) return { kind: 'deleted', by };
    if (exists(next)) return { kind: 'moved', path: next, by };
    at = next;
  }
  return { kind: 'deleted', by };
}
