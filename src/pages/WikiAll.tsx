import { Box, Stack } from '@mui/material';
import { ListRow, RowGroup } from '../components/ListRow';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { DraftChip, WikiFooter, WikiSignInNotice } from '../components/WikiAccess';
import { WikiLoadFailed, WikiLoading } from '../components/WikiStates';
import { layout } from '../layout';
import { useWikiIndex, wikiFolders, wikiRoute } from '../wiki';

/** /wiki/all: every published page (and, for an editor, every draft), grouped by its folder in the vault. */
export function WikiAll() {
  const state = useWikiIndex();
  const count = state.index?.pages.filter((p) => !p.draft).length ?? 0;
  const drafts = state.index ? state.index.pages.length - count : 0;
  const meta = `${count} ${count === 1 ? 'page' : 'pages'}${drafts ? ` · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : ''}`;
  return (
    <Stack spacing={layout.sectionGap}>
      <WikiSignInNotice />
      <PageHeader overline="Wiki" title="All pages" meta={state.index ? meta : undefined} />
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
