// Pages an editor saved, restored, renamed or deleted in this visit, shown that way until the vault
// publishes the change (about a minute) and the next page load fetches the new index. Kept in
// memory only.
import { useSyncExternalStore } from 'react';
import type { WikiFile, WikiPageMeta } from './wikiCore';

export interface SavedPage {
  /** The page as the index would list it (a new page is not in the index yet). */
  meta: WikiPageMeta;
  /** The saved markdown without frontmatter. */
  body: string;
  /** Images added with the save, served by the site's Worker from the LFS bucket until the vault publishes them. */
  files: WikiFile[];
  draft: boolean;
  created: boolean;
  at: number;
}

const saved = new Map<string, SavedPage>();
/** Pages renamed in this visit: old slug → new slug. */
const moved = new Map<string, string>();
/** Pages deleted in this visit, by slug. */
const deleted = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function rememberSaved(page: SavedPage): void {
  saved.set(page.meta.slug, page);
  deleted.delete(page.meta.slug);
  moved.delete(page.meta.slug);
  bump();
}

export function savedPage(slug: string): SavedPage | undefined {
  return deleted.has(slug) ? undefined : saved.get(slug);
}

function bump() {
  version++;
  for (const l of listeners) l();
}

/** A page was renamed: its old address goes to the new one for the rest of the visit. */
export function rememberMoved(from: string, page: SavedPage): void {
  deleted.delete(page.meta.slug);
  saved.set(page.meta.slug, page);
  if (from !== page.meta.slug) {
    moved.set(from, page.meta.slug);
    saved.delete(from);
  }
  bump();
}

/** Where a page renamed in this visit went, if it was. */
export function movedTo(slug: string): string | undefined {
  return moved.get(slug);
}

/** A page was deleted: it shows as deleted for the rest of the visit. */
export function rememberDeleted(slug: string): void {
  deleted.add(slug);
  saved.delete(slug);
  bump();
}

/** Whether the page was deleted in this visit. */
export function wasDeleted(slug: string): boolean {
  return deleted.has(slug);
}

/** Re-renders when a page is saved. */
export function useSavedPages(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
  );
}
