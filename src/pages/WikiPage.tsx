import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { Box, Button, Stack } from '@mui/material';
import { PageHeader } from '../components/PageHeader';
import { DraftBanner, DraftChip, WikiFooter, WikiSignInNotice } from '../components/WikiAccess';
import { WikiMarkdown } from '../components/WikiMarkdown';
import { WikiLoadFailed, WikiLoading, WikiPageNotFound } from '../components/WikiStates';
import { layout } from '../layout';
import {
  WIKI_ALL_ROUTE,
  WIKI_HOME,
  findWikiAlias,
  findWikiPage,
  loadWikiMarkdown,
  useWikiIndex,
  wikiRoute,
  type WikiPageMeta,
} from '../wiki';

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
  const { search, hash } = useLocation();
  const slug = param ?? WIKI_HOME;
  const state = useWikiIndex();
  const page = state.index ? findWikiPage(state.index, slug) : undefined;
  const { body, retry } = usePageBody(page);
  const context = useMemo(() => (state.index && page ? { index: state.index, page } : null), [state.index, page]);
  useScrollToHash(body.status === 'ready', hash);

  if (param === WIKI_HOME) return <Navigate to={`/wiki${search}${hash}`} replace />;
  if (state.status === 'loading') return <WikiLoading label="Loading the page" />;
  if (state.status === 'failed') return <WikiLoadFailed what="The wiki" onRetry={state.retry} />;
  if (!page || !context) {
    const moved = findWikiAlias(state.index, slug);
    if (moved) return <Navigate to={`${wikiRoute(moved.slug)}${search}${hash}`} replace />;
    // It may be a draft: wait until it is known whether this visitor gets them.
    if (state.draftsPending) return <WikiLoading label="Loading the page" />;
    return (
      <Stack spacing={2}>
        <WikiSignInNotice />
        <WikiPageNotFound slug={slug} />
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
        actions={allPagesButton}
      />
      {page.draft && <DraftBanner />}
      <Box
        sx={{
          // Headings scrolled to (from a link's #anchor) stay clear of the sticky top bar.
          '& h1, & h2, & h3, & h4, & h5, & h6': { scrollMarginTop: layout.topBarHeight + 16 },
        }}
      >
        {body.status === 'loading' && <WikiLoading label="Loading the page" />}
        {body.status === 'failed' && <WikiLoadFailed what="The page" onRetry={retry} />}
        {body.status === 'ready' && <WikiMarkdown source={body.markdown} context={context} />}
      </Box>
      <WikiFooter />
    </Stack>
  );
}
