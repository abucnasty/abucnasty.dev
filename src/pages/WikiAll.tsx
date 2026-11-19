import { Suspense, lazy } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, Stack } from '@mui/material';
import { ListRow, RowGroup } from '../components/ListRow';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { DraftChip, WikiFooter, WikiSignInNotice } from '../components/WikiAccess';
import { WikiLoadFailed, WikiLoading } from '../components/WikiStates';
import { layout } from '../layout';
import { WIKI_DELETED_ROUTE, useWikiIndex, wikiFolders, wikiRoute } from '../wiki';
import { isEditor, useWikiSession } from '../wikiAuth';
import { useSavedPages, wasDeleted } from '../wikiSaved';

// The "New page" dialog, for editors only: its own small chunk.
const NewPageDialog = lazy(() => import('../components/WikiNewPage'));
/** `?new=<title>` opens the dialog (from "Create this page" on a missing page or link). */
const NEW_PARAM = 'new';

/** /wiki/all: every published page (and, for an editor, every draft), grouped by its folder in the vault. */
export function WikiAll() {
  const loaded = useWikiIndex();
  useSavedPages();
  // Pages deleted in this visit are gone already, though the index still lists them for a minute.
  const state = loaded.index ? { ...loaded, index: { ...loaded.index, pages: loaded.index.pages.filter((p) => !wasDeleted(p.slug)) } } : loaded;
  const session = useWikiSession();
  const [params, setParams] = useSearchParams();
  const editor = isEditor(session);
  const newTitle = params.get(NEW_PARAM);
  const canCreate = editor && session.status === 'signed-in' && (session.me.editing ?? 'on') === 'on';
  const closeNew = () => {
    params.delete(NEW_PARAM);
    setParams(params, { replace: true });
  };
  const count = state.index?.pages.filter((p) => !p.draft).length ?? 0;
  const drafts = state.index ? state.index.pages.length - count : 0;
  const meta = `${count} ${count === 1 ? 'page' : 'pages'}${drafts ? ` · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : ''}`;
  return (
    <Stack spacing={layout.sectionGap}>
      <WikiSignInNotice />
      <PageHeader
        overline="Wiki"
        title="All pages"
        meta={state.index ? meta : undefined}
        actions={
          editor ? (
            <Stack direction="row" spacing={1}>
              <Button component={RouterLink} to={WIKI_DELETED_ROUTE} size="small" variant="text" data-wiki-deleted-link>
                Recently deleted
              </Button>
              {canCreate && (
                <Button size="small" variant="outlined" onClick={() => setParams({ [NEW_PARAM]: '' })} data-wiki-new>
                  New page
                </Button>
              )}
            </Stack>
          ) : undefined
        }
      />
      {canCreate && state.index && newTitle !== null && (
        <Suspense fallback={null}>
          <NewPageDialog index={state.index} initialTitle={newTitle} onClose={closeNew} />
        </Suspense>
      )}
      {state.status === 'loading' && <WikiLoading />}
      {state.status === 'failed' && <WikiLoadFailed onRetry={state.retry} />}
      {state.status === 'ready' &&
        wikiFolders(state.index).map(({ folder, pages }) => (
          <Box key={folder} data-wiki-folder={folder}>
            <SectionHeader label={folder ? folder.split('/').join(' / ') : 'Wiki'} summary={`${pages.length}`} />
            <RowGroup>
              {pages.map((p) => (
                <ListRow key={p.slug} to={wikiRoute(p.slug)} title={p.title} subtitle={p.excerpt || undefined} trailing={p.draft ? <DraftChip /> : undefined} />
              ))}
            </RowGroup>
          </Box>
        ))}
      <WikiFooter />
    </Stack>
  );
}
