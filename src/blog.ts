// The blog, fetched in the browser from the live vault: the index once per
// page load (shared by the blog pages, Home and search), and a post's
// markdown when its page opens. Types and URL helpers live in blogCore.ts
// and are re-exported here.
import { useCallback, useEffect, useState } from 'react';
import { BLOG_INDEX_URL, normaliseBlogIndex, postMarkdownUrl, type BlogIndex } from './blogCore';

export * from './blogCore';

let pending: Promise<BlogIndex> | null = null;
let loaded: BlogIndex | null = null;

/** One fetch per page load, shared by every caller; a failed fetch is forgotten so the next call retries. */
export function loadBlogIndex(): Promise<BlogIndex> {
  pending ??= fetch(BLOG_INDEX_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`blog/index.json: HTTP ${res.status}`);
      return res.json();
    })
    .then((json) => (loaded = normaliseBlogIndex(json)))
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export type BlogIndexState =
  | { status: 'loading'; index: null; retry: () => void }
  | { status: 'ready'; index: BlogIndex; retry: () => void }
  | { status: 'failed'; index: null; retry: () => void };

/** The blog index for a component: starts the shared fetch on mount. */
export function useBlogIndex(): BlogIndexState {
  const [index, setIndex] = useState<BlogIndex | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (index) return;
    let live = true;
    loadBlogIndex().then(
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

/** A post's markdown (no frontmatter). */
export async function loadPostMarkdown(slug: string): Promise<string> {
  const res = await fetch(postMarkdownUrl(slug));
  if (!res.ok) throw new Error(`${slug}/index.md: HTTP ${res.status}`);
  return res.text();
}
