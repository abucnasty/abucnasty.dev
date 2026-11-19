import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Stack, Tooltip } from '@mui/material';
import { PageHeader } from '../components/PageHeader';
import { DraftBanner, DraftChip, WikiFooter, WikiSignInNotice } from '../components/WikiAccess';
import { WikiMarkdown } from '../components/WikiMarkdown';
import { WikiLoadFailed, WikiLoading, WikiPageNotFound } from '../components/WikiStates';
import { editingOff, isEditor, useWikiSession, type WikiSession } from '../wikiAuth';
import { movedTo, savedPage, useSavedPages, wasDeleted } from '../wikiSaved';
import { layout } from '../layout';
import {
  WIKI_ALL_ROUTE,
  WIKI_DELETED_ROUTE,
  WIKI_HOME,
  findWikiAlias,
  findWikiPage,
  loadWikiMarkdown,
  useWikiIndex,
  wikiHistoryRoute,
  wikiRoute,
  type WikiIndex,
  type WikiPageMeta,
} from '../wiki';

// The editor (Milkdown, CodeMirror and the save flow) is its own chunk, fetched only when an
// editor presses Edit or creates a page.
const WikiEditor = lazy(() => import('../wikiEditor/WikiEditor'));
// Rename and Delete, for editors: their own small chunk.
const WikiPageActions = lazy(() => import('../components/WikiPageActions'));

/** A new page asked for from the "New page" dialog (router state, so it survives a reload). */
interface CreateState {
  create?: { title: string; folder: string };
  /** What a rename tells the editor on the page's new address. */
  notice?: string;
}

/** Edit, for wiki editors: disabled (with the reason) while saving is off. */
function EditButton({ session, onClick }: { session: WikiSession; onClick: () => void }) {
  if (!isEditor(session) || session.status !== 'signed-in') return null;
  const off = editingOff(session);
  const button = (
    <Button size="small" variant="outlined" onClick={onClick} disabled={!!off} data-wiki-edit>
      Edit
    </Button>
  );
  return off ? (
    <Tooltip title={off}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
}

/** The index with a page saved in this visit (and its new images) in it. */
function withSaved(index: WikiIndex, page: WikiPageMeta, files: WikiIndex['files']): WikiIndex {
  return {
    ...index,
    pages: [...index.pages.filter((p) => p.slug !== page.slug), page],
    files: [...files, ...index.files.filter((f) => !files.some((n) => n.path === f.path))],
  };
}

type Body = { status: 'loading' } | { status: 'ready'; markdown: string } | { status: 'failed' };

/** The page's markdown from the vault, fetched when the page is known. */
function usePageBody(page: WikiPageMeta | undefined): { body: Body; retry: () => void } {
  const [body, setBody] = useState<Body>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const slug = page?.slug;
  const blob = page?.blob;
  const draft = page?.draft === true;
  useEffect(() => {
    if (!slug) return;
    let live = true;
    setBody({ status: 'loading' });
    loadWikiMarkdown(slug, draft).then(
      (markdown) => live && setBody({ status: 'ready', markdown }),
      () => live && setBody({ status: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [slug, blob, draft, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { body, retry };
}

/** Once the page is rendered, scroll to the heading the address names (`#id`), as a full load would. */
function useScrollToHash(ready: boolean, hash: string) {
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep it */
    }
    document.getElementById(id)?.scrollIntoView();
  }, [ready, hash]);
}

const allPagesButton = (
  <Button component={RouterLink} to={WIKI_ALL_ROUTE} size="small" variant="text">
    All pages
  </Button>
);

/**
 * /wiki (the front page, wiki/Home.md) and /wiki/<slug>; a former title's address redirects. A
 * draft shows only to a signed-in wiki editor; for anyone else it is a page that does not exist.
 */
export function WikiPage() {
  const { slug: param } = useParams();
  const { pathname, search, hash, state: routeState } = useLocation();
  const navigate = useNavigate();
  const slug = param ?? WIKI_HOME;
  const state = useWikiIndex();
  const session = useWikiSession();
  useSavedPages();
  const saved = savedPage(slug);
  const published = state.index ? findWikiPage(state.index, slug) : undefined;
  const page = saved?.meta ?? published;
  const { body, retry } = usePageBody(published);
  const index = useMemo(() => (state.index && saved ? withSaved(state.index, saved.meta, saved.files) : state.index), [state.index, saved]);
  const context = useMemo(() => (index && page ? { index, page } : null), [index, page]);
  const create = (routeState as CreateState | null)?.create;
  const routeNotice = (routeState as CreateState | null)?.notice;
  const [editing, setEditing] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  useEffect(() => {
    setEditing(false);
    setSavedNotice(null);
  }, [slug]);
  const shown: Body = saved ? { status: 'ready', markdown: saved.body } : body;
  useScrollToHash(shown.status === 'ready' && !editing, hash);

  const onSaved = (result: { slug: string; draft: boolean; unchanged?: boolean; created?: boolean }) => {
    setEditing(false);
    setSavedNotice(
      result.unchanged
        ? 'Nothing had changed, so nothing was saved.'
        : result.draft
          ? 'Saved as a draft. Wiki editors will see it on the site in about a minute.'
          : 'Saved. The site updates in about a minute; this is the saved version.',
    );
    // A new page is a page now: drop the "create" request so a reload does not open the editor again.
    if (create) navigate(`${wikiRoute(result.slug)}${search}`, { replace: true, state: null });
    window.scrollTo({ top: 0 });
  };
  const editor = (target: { slug: string } | { create: { title: string; folder: string } }) => (
    <Suspense fallback={<WikiLoading label="Opening the editor" />}>
      <WikiEditor index={index!} target={target} onClose={() => setEditing(false)} onSaved={onSaved} />
    </Suspense>
  );

  if (param === WIKI_HOME) return <Navigate to={`/wiki${search}${hash}`} replace />;
  const renamed = movedTo(slug);
  if (renamed) return <Navigate to={`${wikiRoute(renamed)}${search}${hash}`} replace />;
  if (wasDeleted(slug)) {
    return (
      <Stack spacing={2}>
        <Alert severity="success" data-wiki-deleted-notice>
          Deleted. The site updates in about a minute. Wiki editors can restore it from Recently deleted for 90 days.
        </Alert>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} to={WIKI_DELETED_ROUTE} variant="outlined">
            Recently deleted
          </Button>
          {allPagesButton}
        </Stack>
        <WikiFooter />
      </Stack>
    );
  }
  if (state.status === 'loading') return <WikiLoading label="Loading the page" />;
  if (state.status === 'failed') return <WikiLoadFailed what="The wiki" onRetry={state.retry} />;
  if (!page || !context) {
    const moved = findWikiAlias(state.index, slug);
    if (moved) return <Navigate to={`${wikiRoute(moved.slug)}${search}${hash}`} replace />;
    // It may be a draft: wait until it is known whether this visitor gets them.
    if (state.draftsPending) return <WikiLoading label="Loading the page" />;
    // A new page an editor asked for: the editor, on a page that does not exist yet.
    if (create && isEditor(session)) {
      return (
        <Stack spacing={2}>
          <PageHeader overline={['Wiki', ...(create.folder ? create.folder.split('/') : []), 'New page'].join(' / ')} title={create.title} actions={allPagesButton} />
          {editor({ create })}
          <WikiFooter />
        </Stack>
      );
    }
    return (
      <Stack spacing={2}>
        <WikiSignInNotice />
        <WikiPageNotFound slug={slug} editor={isEditor(session)} />
        <WikiFooter />
      </Stack>
    );
  }

  const home = page.slug === WIKI_HOME;
  const pages = state.index.pages.filter((p) => !p.draft).length;
  return (
    <Stack spacing={2}>
      <WikiSignInNotice />
      <PageHeader
        overline={home ? undefined : ['Wiki', ...(page.folder ? page.folder.split('/') : [])].join(' / ')}
        title={home ? 'Wiki' : page.title}
        meta={home ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : page.draft ? <DraftChip /> : undefined}
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {!editing && <EditButton session={session} onClick={() => (setSavedNotice(null), setEditing(true))} />}
            {!editing && isEditor(session) && (
              <Suspense fallback={null}>
                <WikiPageActions index={index!} page={page} markdown={shown.status === 'ready' ? shown.markdown : null} off={editingOff(session)} />
              </Suspense>
            )}
            {!editing && (
              <Button component={RouterLink} to={wikiHistoryRoute(page.slug)} size="small" variant="text" data-wiki-history-link>
                History
              </Button>
            )}
            {allPagesButton}
          </Stack>
        }
      />
      {page.draft && <DraftBanner />}
      {routeNotice && !savedNotice && !editing && (
        <Alert severity="success" onClose={() => navigate(`${pathname}${search}${hash}`, { replace: true, state: null })} data-wiki-saved>
          {routeNotice}
        </Alert>
      )}
      {savedNotice && !editing && (
        <Alert severity="success" onClose={() => setSavedNotice(null)} data-wiki-saved>
          {savedNotice}
        </Alert>
      )}
      <Box
        sx={{
          // Headings scrolled to (from a link's #anchor) stay clear of the sticky top bar.
          '& h1, & h2, & h3, & h4, & h5, & h6': { scrollMarginTop: layout.topBarHeight + 16 },
        }}
      >
        {editing && editor({ slug: page.slug })}
        {!editing && shown.status === 'loading' && <WikiLoading label="Loading the page" />}
        {!editing && shown.status === 'failed' && <WikiLoadFailed what="The page" onRetry={retry} />}
        {!editing && shown.status === 'ready' && <WikiMarkdown source={shown.markdown} context={context} editor={isEditor(session)} />}
      </Box>
      <WikiFooter />
    </Stack>
  );
}
