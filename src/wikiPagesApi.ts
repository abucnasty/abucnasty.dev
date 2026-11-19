// A page's history (anyone, for a published page), and the editor's calls that change pages
// other than by saving them: restore a version, rename, delete, and restore a deleted page
// (worker/wikiApi.ts, wikiHistory.ts and wikiPages.ts). Refusals are SaveErrors, as for saving.
import { SaveError } from './wikiEditor/api';

export { SaveError };

export interface HistoryEntry {
  sha: string;
  date: string;
  author: string;
  summary: string;
  /** The page's path after this commit: where its version is read from. */
  path: string;
  kind?: 'renamed' | 'deleted' | 'restored';
  from?: string;
  site: boolean;
}

export interface PageHistory {
  path: string;
  entries: HistoryEntry[];
  truncated: boolean;
}

export interface DeletedPage {
  path: string;
  title: string;
  folder: string;
  commit: string;
  date: string;
  author: string;
  site: boolean;
  /** The page that has its title (or address) now, if any. */
  titleTaken: string | null;
}

/** What a change answers: the page as it is now (for a delete, only its path, slug and title). */
export interface ChangeResult {
  ok: true;
  unchanged?: boolean;
  commit?: string;
  path: string;
  slug: string;
  title: string;
  folder?: string;
  blob?: string;
  frontmatter?: string;
  draft: boolean;
  /** The page's markdown after a restore. */
  body?: string;
}

const NETWORK = "Couldn't reach the site. Check your connection and try again.";

async function call<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new SaveError(0, 'network', NETWORK);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new SaveError(res.status, body?.error ?? 'error', body?.message ?? fallback);
  }
  return (init.method === 'POST' || !res.headers.get('Content-Type')?.includes('markdown') ? res.json() : res.text()) as Promise<T>;
}

export const loadHistory = (path: string) => call<PageHistory>(`/api/wiki/history?path=${encodeURIComponent(path)}`, {}, "The history couldn't be loaded.");

/** A page's file at a commit; '' when it was not there. */
export async function loadVersion(path: string, ref: string): Promise<string> {
  try {
    return await call<string>(`/api/wiki/version?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`, {}, "That version couldn't be loaded.");
  } catch (err) {
    if (err instanceof SaveError && err.status === 404) return '';
    throw err;
  }
}

export const loadDeleted = () => call<{ since: string; partial: boolean; pages: DeletedPage[] }>('/api/wiki/deleted', {}, "The deleted pages couldn't be loaded.");

const post = (what: string, body: object) =>
  call<ChangeResult>(`/api/wiki/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'That didn\'t work. Nothing was changed; try again.');

export const restoreVersion = (b: { path: string; base: string; commit: string; from: string }) => post('restore', b);
export const renamePage = (b: { path: string; base: string; title: string; folder: string }) => post('rename', b);
export const deletePage = (b: { path: string; base: string; summary?: string }) => post('delete', b);
export const undeletePage = (b: { path: string; commit: string; title?: string }) => post('undelete', b);
