import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

// The blog's loading, failure and unknown-address states, as the blueprint pages have them:
// a spinner while the vault answers, "Try again" when it did not, and a way back for an unknown post.

export function BlogLoading({ label = 'Loading the blog' }: { label?: string }) {
  return (
    <Box role="status" aria-label={label} data-blog-state="loading" sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress aria-hidden />
    </Box>
  );
}

export function BlogLoadFailed({ what = 'The blog', onRetry }: { what?: string; onRetry: () => void }) {
  return (
    <Alert
      severity="error"
      data-blog-state="failed"
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

export function PostNotFound({ slug }: { slug: string }) {
  return (
    <Stack spacing={2} data-blog-state="unknown" sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h3">Not found</Typography>
      <Typography>No blog post with slug "{slug}".</Typography>
      <Button component={RouterLink} to="/blog" variant="contained">
        Back to blog
      </Button>
    </Stack>
  );
}
