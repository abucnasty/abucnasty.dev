import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { WIKI_ALL_ROUTE } from '../wikiCore';

// The wiki's loading, failure and unknown-address states, as the blog has them: a spinner while
// the vault answers, "Try again" when it did not, and a way on for an unknown page.

export function WikiLoading({ label = 'Loading the wiki' }: { label?: string }) {
  return (
    <Box role="status" aria-label={label} data-wiki-state="loading" sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress aria-hidden />
    </Box>
  );
}

export function WikiLoadFailed({ what = 'The wiki', onRetry }: { what?: string; onRetry: () => void }) {
  return (
    <Alert
      severity="error"
      data-wiki-state="failed"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {what} didn't load. Check your connection, then try again.
    </Alert>
  );
}

/** A title for a page at `slug`: its words, the first capitalised. */
const titleFor = (slug: string) => {
  const t = slug.replace(/-+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function WikiPageNotFound({ slug, editor = false }: { slug: string; editor?: boolean }) {
  return (
    <Stack spacing={2} data-wiki-state="unknown" sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h3">Not found</Typography>
      <Typography>No wiki page at "{slug}". It may have been renamed or not be written yet.</Typography>
      <Stack direction="row" spacing={1}>
        <Button component={RouterLink} to="/wiki" variant="contained">
          Wiki home
        </Button>
        <Button component={RouterLink} to={WIKI_ALL_ROUTE} variant="outlined">
          All pages
        </Button>
        {editor && (
          <Button component={RouterLink} to={`${WIKI_ALL_ROUTE}?new=${encodeURIComponent(titleFor(slug))}`} variant="outlined" data-wiki-create-missing>
            Create this page
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
