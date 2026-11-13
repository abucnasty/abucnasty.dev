import type { SxProps, Theme } from '@mui/material';
import { Box, Link, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

interface MarkdownRendererProps {
  source: string;
  /** Merged after the root styles, so a caller can override font size and margins. */
  sx?: SxProps<Theme>;
}

const isExternal = (href: string | undefined) =>
  !!href && /^https?:\/\//i.test(href);

export function MarkdownRenderer({ source, sx }: MarkdownRendererProps) {
  return (
    <Box
      sx={[
        {
          // Long URLs and inline code would otherwise push the page sideways on phones.
          overflowWrap: 'anywhere',
          '& pre, & table': { overflowWrap: 'normal' },
          '& h1, & h2, & h3, & h4': { color: 'text.primary', mt: 4, mb: 2 },
          '& h1': { fontSize: '2rem', borderBottom: '2px solid', borderColor: 'primary.main', pb: 1 },
          '& h2': { fontSize: '1.5rem' },
          '& h3': { fontSize: '1.25rem' },
          '& p': { lineHeight: 1.7, my: 2 },
          '& code': {
            backgroundColor: 'background.paper',
            px: 0.75,
            py: 0.25,
            fontSize: '0.9em',
            fontFamily: 'monospace',
        },
        '& pre': {
          backgroundColor: 'background.paper',
          p: 2,
          overflowX: 'auto',
        },
        '& blockquote': {
          borderLeft: '4px solid',
          borderColor: 'primary.main',
          pl: 2,
          color: 'text.secondary',
          my: 2,
        },
        '& img': {
          maxWidth: '100%',
          height: 'auto',
          display: 'block',
          my: 2,
        },
        '& hr': { borderColor: 'divider', my: 4 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]]}
        components={{
          a({ href, children }) {
            const external = isExternal(href);
            return (
              <Link
                href={href}
                color="primary"
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {children}
              </Link>
            );
          },
          table({ children }) {
            return (
              <TableContainer component={Box} sx={{ my: 3, backgroundColor: 'background.paper' }}>
                <Table size="small">{children}</Table>
              </TableContainer>
            );
          },
          thead({ children }) {
            return <TableHead>{children}</TableHead>;
          },
          tbody({ children }) {
            return <TableBody>{children}</TableBody>;
          },
          tr({ children }) {
            return <TableRow>{children}</TableRow>;
          },
          th({ children, style }) {
            return (
              <TableCell sx={{ fontWeight: 700, color: 'primary.main', textAlign: style?.textAlign }}>
                {children}
              </TableCell>
            );
          },
          td({ children, style }) {
            return <TableCell sx={{ textAlign: style?.textAlign }}>{children}</TableCell>;
          },
          p({ children }) {
            return <Typography component="p" variant="body1" sx={{ my: 2 }}>{children}</Typography>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </Box>
  );
}
