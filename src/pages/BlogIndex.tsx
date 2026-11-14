import {
  Box,
  Chip,
  Link as MuiLink,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { listedPosts, postRoute, useBlogIndex } from '../blog';
import { BlogLoadFailed, BlogLoading } from '../components/BlogStates';
import { DenseTable } from '../components/DenseTable';
import { PageHeader } from '../components/PageHeader';

const chipSx = { height: 20, fontSize: 12 };

export function BlogIndex() {
  const state = useBlogIndex();
  const posts = state.index ? listedPosts(state.index) : [];

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Blog"
        meta={state.index ? `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}` : undefined}
      />
      {state.status === 'loading' && <BlogLoading />}
      {state.status === 'failed' && <BlogLoadFailed onRetry={state.retry} />}
      {state.status === 'ready' && (
        <DenseTable aria-label="Blog posts">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Title</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Tags</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {posts.map((post) => (
              <TableRow key={post.slug} hover>
                <TableCell
                  sx={{
                    whiteSpace: 'nowrap',
                    color: 'text.secondary',
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                  }}
                >
                  {post.date}
                </TableCell>
                <TableCell>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', md: 'row' },
                      alignItems: { xs: 'flex-start', md: 'baseline' },
                      gap: { xs: 0, md: 1.5 },
                      minWidth: 0,
                    }}
                  >
                    <MuiLink
                      component={RouterLink}
                      to={postRoute(post.slug)}
                      underline="hover"
                      sx={{ fontWeight: 600, fontSize: 14, flexShrink: { xs: 1, md: 0 } }}
                    >
                      {post.title}
                    </MuiLink>
                    {post.status === 'deprecated' && <Chip label="Outdated" size="small" variant="outlined" sx={chipSx} />}
                    {post.description && (
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'text.secondary',
                          minWidth: 0,
                          flex: { md: 1 },
                          whiteSpace: { xs: 'normal', md: 'nowrap' },
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {post.description}
                      </Typography>
                    )}
                  </Box>
                  {post.tags.length > 0 && (
                    <Stack
                      direction="row"
                      flexWrap="wrap"
                      gap={0.5}
                      mt={0.5}
                      sx={{ display: { xs: 'flex', sm: 'none' } }}
                    >
                      {post.tags.map((tag) => (
                        <Chip key={tag} label={tag} size="small" sx={chipSx} />
                      ))}
                    </Stack>
                  )}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {post.tags.map((tag) => (
                      <Chip key={tag} label={tag} size="small" sx={chipSx} />
                    ))}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DenseTable>
      )}
    </Stack>
  );
}
