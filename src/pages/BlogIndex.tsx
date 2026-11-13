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
import { blogPosts } from '../blog/registry';
import { DenseTable } from '../components/DenseTable';
import { PageHeader } from '../components/PageHeader';

const chipSx = { height: 20, fontSize: 12 };

export function BlogIndex() {
  const sorted = [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Blog"
        meta={`${blogPosts.length} ${blogPosts.length === 1 ? 'post' : 'posts'}`}
      />
      <DenseTable aria-label="Blog posts">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Title</TableCell>
            <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Tags</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((post) => (
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
                    to={`/blog/${post.slug}`}
                    underline="hover"
                    sx={{ fontWeight: 600, fontSize: 14, flexShrink: { xs: 1, md: 0 } }}
                  >
                    {post.title}
                  </MuiLink>
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
                {post.tags && post.tags.length > 0 && (
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
                  {post.tags?.map((tag) => (
                    <Chip key={tag} label={tag} size="small" sx={chipSx} />
                  ))}
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DenseTable>
    </Stack>
  );
}
