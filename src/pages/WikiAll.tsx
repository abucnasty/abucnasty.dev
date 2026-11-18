import { Box, Stack } from '@mui/material';
import { ListRow, RowGroup } from '../components/ListRow';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { WikiLoadFailed, WikiLoading } from '../components/WikiStates';
import { layout } from '../layout';
import { useWikiIndex, wikiFolders, wikiRoute } from '../wiki';

/** /wiki/all: every published page, grouped by its folder in the vault. */
export function WikiAll() {
  const state = useWikiIndex();
  const count = state.index?.pages.length ?? 0;
  return (
    <Stack spacing={layout.sectionGap}>
      <PageHeader overline="Wiki" title="All pages" meta={state.index ? `${count} ${count === 1 ? 'page' : 'pages'}` : undefined} />
      {state.status === 'loading' && <WikiLoading />}
      {state.status === 'failed' && <WikiLoadFailed onRetry={state.retry} />}
      {state.status === 'ready' &&
        wikiFolders(state.index).map(({ folder, pages }) => (
          <Box key={folder} data-wiki-folder={folder}>
            <SectionHeader label={folder ? folder.split('/').join(' / ') : 'Wiki'} summary={`${pages.length}`} />
            <RowGroup>
              {pages.map((p) => (
                <ListRow key={p.slug} to={wikiRoute(p.slug)} title={p.title} subtitle={p.excerpt || undefined} />
              ))}
            </RowGroup>
          </Box>
        ))}
    </Stack>
  );
}
