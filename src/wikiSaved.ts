// Pages an editor saved in this visit, shown as saved until the vault publishes them (about a
// minute) and the next page load fetches the new index. Kept in memory only.
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
const listeners = new Set<() => void>();
let version = 0;

export function rememberSaved(page: SavedPage): void {
  saved.set(page.meta.slug, page);
  version++;
  for (const l of listeners) l();
}

export function savedPage(slug: string): SavedPage | undefined {
  return saved.get(slug);
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
