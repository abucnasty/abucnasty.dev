// The wiki, fetched in the browser from the live vault: the index once per page load (shared by
// the wiki pages and search), and a page's markdown when it opens. Types and URL helpers live in
// wikiCore.ts and are re-exported here; the renderer is wikiMarkdown.ts.
import { useCallback, useEffect, useState } from 'react';
import { WIKI_INDEX_URL, normaliseWikiIndex, wikiMarkdownUrl, type WikiIndex } from './wikiCore';

export * from './wikiCore';

let pending: Promise<WikiIndex> | null = null;
let loaded: WikiIndex | null = null;

/** One fetch per page load, shared by every caller; a failed fetch is forgotten so the next call retries. */
export function loadWikiIndex(): Promise<WikiIndex> {
  pending ??= fetch(WIKI_INDEX_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`wiki/index.json: HTTP ${res.status}`);
      return res.json();
    })
    .then((json) => (loaded = normaliseWikiIndex(json)))
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export type WikiIndexState =
  | { status: 'loading'; index: null; retry: () => void }
  | { status: 'ready'; index: WikiIndex; retry: () => void }
  | { status: 'failed'; index: null; retry: () => void };

/** The wiki index for a component: starts the shared fetch on mount. */
export function useWikiIndex(): WikiIndexState {
  const [index, setIndex] = useState<WikiIndex | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (index) return;
    let live = true;
    loadWikiIndex().then(
      (i) => live && setIndex(i),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [index, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  if (index) return { status: 'ready', index, retry };
  return { status: failed ? 'failed' : 'loading', index: null, retry };
}

/** A page's markdown (no frontmatter or comments). */
export async function loadWikiMarkdown(slug: string): Promise<string> {
  const res = await fetch(wikiMarkdownUrl(slug));
  if (!res.ok) throw new Error(`wiki/${slug}.md: HTTP ${res.status}`);
  return res.text();
}
