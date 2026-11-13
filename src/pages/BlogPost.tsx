import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { blogPosts } from '../blog/registry';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

// Vite resolves these globs at build time.
// Supports both flat files (posts/<slug>.md) and nested (posts/<slug>/index.md).
const markdownModules = import.meta.glob('../blog/posts/**/*.md', {
  query: '?raw',
  import: 'default',
});

const tsxModules = import.meta.glob('../blog/posts/**/*.tsx');

/**
 * Transform relative image paths in markdown to absolute blog post URLs.
 * Converts patterns like `![alt](./screenshots/image.jpg)` to `![alt](/blog/posts/<slug>/screenshots/image.jpg)`
 */
function transformMarkdownImagePaths(markdown: string, slug: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(\.\/([^)]+)\)/g,
    `![$1](/blog/posts/${slug}/$2)`
  );
}

export function BlogPost() {
  const { slug = '' } = useParams();
  const post = blogPosts.find((p) => p.slug === slug);

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [CustomComponent, setCustomComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMarkdown(null);
    setCustomComponent(null);
    setError(null);
    setLoading(true);

    if (!post) {
      setLoading(false);
      return;
    }

    if (post.type === 'markdown') {
      const loader = (
        markdownModules[`../blog/posts/${post.slug}.md`] ??
        markdownModules[`../blog/posts/${post.slug}/index.md`]
      ) as (() => Promise<string>) | undefined;
      if (!loader) {
        setError('Markdown file not found for this post.');
        setLoading(false);
        return;
      }
      loader()
        .then((md) => {
          const transformed = transformMarkdownImagePaths(md as string, post.slug);
          setMarkdown(transformed);
          setLoading(false);
        })
        .catch((e) => {
          setError(String(e));
          setLoading(false);
        });
    } else {
      const loader = (
        tsxModules[`../blog/posts/${post.slug}.tsx`] ??
        tsxModules[`../blog/posts/${post.slug}/index.tsx`]
      ) as (() => Promise<unknown>) | undefined;
      if (!loader) {
        setError('TSX component not found for this post.');
        setLoading(false);
        return;
      }
      loader()
        .then((mod) => {
          setCustomComponent(() => (mod as { default: React.ComponentType }).default);
          setLoading(false);
        })
        .catch((e) => {
          setError(String(e));
          setLoading(false);
        });
    }
  }, [post?.slug]);

  if (!post) {
    return (
      <Stack spacing={2}>
        <Typography variant="h3">Not found</Typography>
        <Typography>No blog post with slug "{slug}".</Typography>
        <Button component={RouterLink} to="/blog" variant="contained">
          Back to blog
        </Button>
      </Stack>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          sx={{ color: 'primary.main', letterSpacing: 2, display: 'block' }}
        >
          {post.date}
        </Typography>
        <Typography variant="h3" sx={{ mt: 0.5, lineHeight: 1.15 }}>
          {post.title}
        </Typography>
        {post.tags && post.tags.length > 0 && (
          <Stack direction="row" flexWrap="wrap" gap={0.5} mt={1}>
            {post.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" />
            ))}
          </Stack>
        )}
        <Box sx={{ mt: 2 }}>
          <Button component={RouterLink} to="/blog" size="small" variant="text">
            ← All posts
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && !error && post.type === 'markdown' && markdown && (
        <MarkdownRenderer source={markdown} />
      )}

      {!loading && !error && post.type === 'tsx' && CustomComponent && (
        <CustomComponent />
      )}
    </Box>
  );
}
