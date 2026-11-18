import { useMemo } from 'react';
import { Box, Link } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link as RouterLink } from 'react-router-dom';
import { CALLOUT_KINDS, prepareWikiSource, wikiMarkdownOptions, type WikiContext } from '../wikiMarkdown';
import { markdownComponents, markdownSx } from './MarkdownRenderer';
import { DraftChip } from './WikiAccess';

// A wiki page's markdown, rendered with wikiMarkdown.ts's plugins (no raw HTML) in the site's
// markdown style, plus the wiki's own pieces: callout boxes, missing-page links and YouTube players.

/** Accent colour of each callout kind, from the theme where it has one. */
const calloutColor: Record<string, (t: Theme) => string> = {
  note: (t) => t.palette.info.main,
  abstract: (t) => t.palette.info.light,
  info: (t) => t.palette.info.main,
  todo: (t) => t.palette.info.main,
  tip: (t) => t.palette.secondary.main,
  success: (t) => t.palette.success.main,
  question: (t) => t.palette.primary.light,
  warning: (t) => t.palette.primary.main,
  failure: (t) => t.palette.error.main,
  danger: (t) => t.palette.error.main,
  bug: (t) => t.palette.error.main,
  example: (t) => t.palette.secondary.light,
  quote: (t) => t.palette.text.secondary,
};

const wikiSx = (theme: Theme) => ({
  '& .callout': {
    my: 2,
    px: 2,
    py: 1,
    borderLeft: '4px solid',
    color: 'text.primary',
    '& > :last-child': { mb: 0.5 },
  },
  ...Object.fromEntries(
    CALLOUT_KINDS.map((kind) => {
      const c = (calloutColor[kind] ?? calloutColor.note)(theme);
      return [`& .callout-${kind}`, { borderColor: c, backgroundColor: alpha(c, 0.08), '& > .callout-title': { color: c } }];
    }),
  ),
  '& .callout-title': { fontWeight: 700, mt: 0.5, mb: 1 },
  '& .callout-title + p, & .callout > p:first-of-type': { mt: 0 },
  '& .wiki-missing': {
    fontStyle: 'normal',
    color: 'text.secondary',
    textDecoration: 'underline dotted',
    textUnderlineOffset: '3px',
    cursor: 'help',
  },
  '& .youtube-embed': {
    position: 'relative',
    width: '100%',
    maxWidth: 800,
    aspectRatio: '16 / 9',
    my: 2,
    backgroundColor: 'background.paper',
    '& iframe': { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 },
  },
  '& .sr-only': {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  },
  '& li.task-list-item': { listStyle: 'none', '& input': { mr: 1 } },
});

/** The draft a site link points at, if it is one (only an editor's index has drafts). */
function draftAt(ctx: WikiContext, href: string): boolean {
  const m = /^\/wiki\/([^/?#]+)/.exec(href);
  if (!m) return false;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    return false;
  }
  return ctx.index.pages.some((p) => p.slug === slug && p.draft);
}

const makeComponents = (ctx: WikiContext): Components => ({
  ...markdownComponents,
  // Links within the site stay in the app; everything else opens as the blog's links do. A link to
  // a draft (which only editors can follow) carries a "Draft" mark.
  a({ href, children }) {
    if (href && href.startsWith('/') && !href.startsWith('//')) {
      const link = (
        <Link component={RouterLink} to={href} color="primary">
          {children}
        </Link>
      );
      if (!draftAt(ctx, href)) return link;
      return (
        <span className="wiki-draft-link">
          {link}{' '}
          <DraftChip />
        </span>
      );
    }
    const external = !!href && /^https?:\/\//i.test(href);
    return (
      <Link href={href} color="primary" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </Link>
    );
  },
});

export function WikiMarkdown({ source, context }: { source: string; context: WikiContext }) {
  const options = useMemo(() => wikiMarkdownOptions(context), [context]);
  const components = useMemo(() => makeComponents(context), [context]);
  const markdown = useMemo(() => prepareWikiSource(source), [source]);
  return (
    <Box sx={[markdownSx, wikiSx]}>
      <ReactMarkdown {...options} components={components}>
        {markdown}
      </ReactMarkdown>
    </Box>
  );
}
