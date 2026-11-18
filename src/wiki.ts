// The wiki, fetched in the browser from the live vault: the index once per page load (shared by
// the wiki pages and search), and a page's markdown when it opens. For a signed-in wiki editor the
// drafts index (from the site's Worker) is merged in, with each draft marked. Types and URL
// helpers live in wikiCore.ts and are re-exported here; the renderer is wikiMarkdown.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isEditor, useWikiSession } from './wikiAuth';
import {
  WIKI_DRAFTS_INDEX_URL,
  WIKI_INDEX_URL,
  mergeWikiDrafts,
  normaliseWikiIndex,
  wikiDraftMarkdownUrl,
  wikiMarkdownUrl,
  type WikiIndex,
} from './wikiCore';

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

/** The drafts index for editors: one fetch per sign-in, forgotten on failure or sign-out. */
let draftsPending: Promise<WikiIndex> | null = null;

function loadWikiDrafts(): Promise<WikiIndex> {
  draftsPending ??= fetch(WIKI_DRAFTS_INDEX_URL, { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`drafts: HTTP ${res.status}`);
      return res.json();
    })
    .then(normaliseWikiIndex)
    .catch((err) => {
      draftsPending = null;
      throw err;
    });
  return draftsPending;
}

/** The drafts while the visitor is an editor; null otherwise (and while they load, or if they fail). */
function useDrafts(editor: boolean): { drafts: WikiIndex | null; pending: boolean } {
  const [drafts, setDrafts] = useState<WikiIndex | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!editor) {
      draftsPending = null;
      setDrafts(null);
      setDone(false);
      return;
    }
    let live = true;
    loadWikiDrafts().then(
      (d) => live && (setDrafts(d), setDone(true)),
      () => live && setDone(true), // the published pages still show
    );
    return () => {
      live = false;
    };
  }, [editor]);
  return { drafts: editor ? drafts : null, pending: editor && !done };
}

export type WikiIndexState = (
  | { status: 'loading'; index: null }
  | { status: 'ready'; index: WikiIndex }
  | { status: 'failed'; index: null }
) & {
  retry: () => void;
  /** True until it is known whether drafts belong in the index (the session, then the drafts, loading). */
  draftsPending: boolean;
};

/** The wiki index for a component, with drafts for an editor: starts the shared fetches on mount. */
export function useWikiIndex(): WikiIndexState {
  const session = useWikiSession();
  const { drafts, pending } = useDrafts(isEditor(session));
  const draftsPending = session.status === 'loading' || pending;
  const base = usePublishedIndex();
  const merged = useMemo(() => (base.index && drafts ? mergeWikiDrafts(base.index, drafts) : base.index), [base.index, drafts]);
  if (base.status === 'ready' && merged) return { status: 'ready', index: merged, retry: base.retry, draftsPending };
  if (base.status === 'failed') return { status: 'failed', index: null, retry: base.retry, draftsPending };
  return { status: 'loading', index: null, retry: base.retry, draftsPending };
}

type PublishedState =
  | { status: 'loading'; index: null; retry: () => void }
  | { status: 'ready'; index: WikiIndex; retry: () => void }
  | { status: 'failed'; index: null; retry: () => void };

/** The published index: starts the shared fetch on mount. */
function usePublishedIndex(): PublishedState {
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

/** A page's markdown (no frontmatter or comments); a draft's comes from the site's Worker. */
export async function loadWikiMarkdown(slug: string, draft = false): Promise<string> {
  const res = draft ? await fetch(wikiDraftMarkdownUrl(slug), { credentials: 'same-origin', cache: 'no-store' }) : await fetch(wikiMarkdownUrl(slug));
  if (!res.ok) throw new Error(`wiki/${slug}.md: HTTP ${res.status}`);
  return res.text();
}
