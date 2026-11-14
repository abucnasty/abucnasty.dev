import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { findPost, loadPostMarkdown, resolvePostUrl, useBlogIndex, type BlogPostMeta } from '../blog';
import { BlogLoadFailed, BlogLoading, PostNotFound } from '../components/BlogStates';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

type Body = { status: 'loading' } | { status: 'ready'; markdown: string } | { status: 'failed' };

/** The post's markdown from the vault, fetched when the post is known. */
function usePostBody(post: BlogPostMeta | undefined): { body: Body; retry: () => void } {
  const [body, setBody] = useState<Body>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const slug = post?.slug;
  useEffect(() => {
    if (!slug) return;
    let live = true;
    setBody({ status: 'loading' });
    loadPostMarkdown(slug).then(
      (markdown) => live && setBody({ status: 'ready', markdown }),
      () => live && setBody({ status: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [slug, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { body, retry };
}

export function BlogPost() {
  const { slug = '' } = useParams();
  const state = useBlogIndex();
  const post = state.index ? findPost(state.index, slug) : undefined;
  const { body, retry } = usePostBody(post);
  const resolveUrl = useCallback((url: string) => (post ? resolvePostUrl(url, post) : url), [post]);

  if (state.status === 'loading') return <BlogLoading label="Loading the post" />;
  if (state.status === 'failed') return <BlogLoadFailed what="The post" onRetry={state.retry} />;
  if (!post) return <PostNotFound slug={slug} />;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: 2, display: 'block' }}>
          {post.date}
        </Typography>
        <Typography variant="h3" sx={{ mt: 0.5, lineHeight: 1.15 }}>
          {post.title}
        </Typography>
        {post.tags.length > 0 && (
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

      {post.status === 'deprecated' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This post is outdated; it is kept for reference.
        </Alert>
      )}
      {body.status === 'loading' && <BlogLoading label="Loading the post" />}
      {body.status === 'failed' && <BlogLoadFailed what="The post" onRetry={retry} />}
      {body.status === 'ready' && <MarkdownRenderer source={body.markdown} resolveUrl={resolveUrl} />}
    </Box>
  );
}
