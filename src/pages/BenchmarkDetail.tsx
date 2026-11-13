import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Link,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import DownloadIcon from '@mui/icons-material/Download';
import index from '../generated/index.json';
import type { BenchmarkEntry, ContentIndex } from '../content';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { BenchmarkCharts } from '../components/BenchmarkCharts';
import { TableOfContents } from '../components/TableOfContents';
import { PageHeader } from '../components/PageHeader';
import { layout } from '../layout';
import { formatPlatform } from '../format';
import { saveFolderRoute } from '../saves';

const content = index as ContentIndex;

/** Most other benchmarks of the topic listed in the sidebar. */
const MORE_IN_TOPIC = 5;

/** Height in px of the sidebar without its contents list, when both link blocks are at full length. */
const SIDEBAR_FIXED_HEIGHT = 520;

// Dated benchmarks by date, oldest first; the same date keeps manifest order (Array.sort is stable).
const byDate = content.benchmarks
  .filter((b) => b.date)
  .sort((a, b) => (a.date as string).localeCompare(b.date as string));

/**
 * Up to MORE_IN_TOPIC other benchmarks of the same topic: dated ones newest first, then undated
 * ones in manifest order. `total` is how many others there are.
 */
function moreInTopic(current: BenchmarkEntry): { shown: BenchmarkEntry[]; total: number } {
  const others = content.benchmarks.filter((b) => b.topic === current.topic && b.slug !== current.slug);
  const dated = others
    .filter((b) => b.date)
    .sort((a, b) => (b.date as string).localeCompare(a.date as string));
  const undated = others.filter((b) => !b.date);
  return { shown: [...dated, ...undated].slice(0, MORE_IN_TOPIC), total: others.length };
}

const sidebarHeading = {
  color: 'primary.main',
  letterSpacing: 2,
  display: 'block',
  mb: 0.5,
  fontSize: '0.7rem',
} as const;

const sidebarLink = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 24,
  fontSize: 13,
  lineHeight: 1.35,
  color: 'text.secondary',
  '&:hover': { color: 'primary.main' },
} as const;

const sidebarLinkOneLine = {
  ...sidebarLink,
  display: 'block',
  lineHeight: '24px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/** The sidebar's link blocks sit under a thin gap from whatever is above them. */
function SidebarBlock({ heading, children }: { heading: string; children: ReactNode }) {
  const id = `sidebar-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <Box component="div" role="group" aria-labelledby={id} sx={{ mt: 1.5 }}>
      <Typography id={id} variant="overline" sx={sidebarHeading}>
        {heading}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Box>
  );
}

// Eagerly map slugs → raw markdown loaders. Vite resolves these at build time.
const readmeModules = import.meta.glob('../generated/benchmarks/*/README.md', {
  query: '?raw',
  import: 'default',
});

// The question and answer lifted out of the README by the sync. A missing key means no such file.
const questionModules = import.meta.glob('../generated/benchmarks/*/question.md', {
  query: '?raw',
  import: 'default',
});
const answerModules = import.meta.glob('../generated/benchmarks/*/answer.md', {
  query: '?raw',
  import: 'default',
});

type Loader = () => Promise<string>;

function loaderFor(
  modules: Record<string, () => Promise<unknown>>,
  slug: string,
  file: string,
): Loader | undefined {
  return modules[`../generated/benchmarks/${slug}/${file}`] as Loader | undefined;
}

interface Loaded {
  slug: string;
  readme: string;
  question: string | null;
  answer: string | null;
}

// Paragraphs and lists in the lead sit flush at the top and bottom and 1em apart.
// A question written as a list item shows without a bullet or indent.
const upper = { textTransform: 'uppercase' } as const;

const leadBlocks = {
  '& p, & ul, & ol': { my: 0 },
  '&& > * + *': { mt: '1em' },
  '& li + li': { mt: '0.25em' },
} as const;

export function BenchmarkDetail() {
  const { slug = '' } = useParams();
  const benchmark = content.benchmarks.find((b) => b.slug === slug);
  // Tagged with its slug so a page never shows the previous benchmark's text while the next loads.
  const [loadedState, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = loadedState && loadedState.slug === slug ? loadedState : null;
  const markdown = loaded?.readme ?? null;
  const topic = content.topics.find((t) => t.id === benchmark?.topic);
  const hasCharts = Boolean(benchmark?.timeseries);
  const hasSaves = (benchmark?.saves.length ?? 0) > 0;
  const hasTabs = hasCharts || hasSaves;
  const [tab, setTab] = useState<'readme' | 'charts' | 'saves'>('readme');

  useEffect(() => {
    setTab('readme');
  }, [hasTabs, slug]);

  useEffect(() => {
    setLoaded(null);
    setError(null);
    if (!benchmark) return;
    const readme = loaderFor(readmeModules, benchmark.slug, 'README.md');
    if (!readme) {
      setError('README content not found for this benchmark.');
      return;
    }
    const question = benchmark.question
      ? loaderFor(questionModules, benchmark.slug, 'question.md')
      : undefined;
    const answer = question ? loaderFor(answerModules, benchmark.slug, 'answer.md') : undefined;
    let cancelled = false;
    // Everything arrives together, so the page does not jump.
    Promise.all([readme(), question?.() ?? null, answer?.() ?? null])
      .then(([md, q, a]) => {
        if (cancelled) return;
        setLoaded({
          slug: benchmark.slug,
          readme: md.replace(/^\s*#\s+.*\r?\n+/, ''),
          question: q,
          answer: a,
        });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [benchmark]);

  if (!benchmark) {
    return (
      <Stack spacing={2}>
        <Typography variant="h3">Not found</Typography>
        <Typography>No benchmark with slug "{slug}".</Typography>
        <Button component={RouterLink} to="/benchmarks" variant="contained">
          Back to benchmarks
        </Button>
      </Stack>
    );
  }

  const showToc = markdown && (tab === 'readme' || !hasTabs);

  // The contents list gives way to the two link blocks on a short window, down to 160 px. The
  // constant is the sidebar's other content at its fullest: padding, button, rules and both blocks.
  const tocMaxHeight = `clamp(160px, calc(100vh - ${SIDEBAR_FIXED_HEIGHT}px), 360px)`;

  const goesWith = [
    ...(hasSaves
      ? [{ key: 'saves', to: saveFolderRoute(benchmark.source), label: `${benchmark.saves.length} save files` }]
      : []),
  ];
  const more = topic ? moreInTopic(benchmark) : { shown: [], total: 0 };

  const dateIndex = byDate.findIndex((b) => b.slug === benchmark.slug);
  const older = dateIndex > 0 ? byDate[dateIndex - 1] : undefined;
  const newer = dateIndex >= 0 && dateIndex < byDate.length - 1 ? byDate[dateIndex + 1] : undefined;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 260px' },
        alignItems: 'flex-start',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ mb: hasTabs ? 2 : 3 }}>
          <Box
            component="nav"
            aria-label="Breadcrumb"
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 1,
              fontSize: 13,
              mb: 0.5,
              '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 24 },
            }}
          >
            <Link component={RouterLink} to="/benchmarks" underline="hover" color="primary.main">
              Benchmarks
            </Link>
            {topic && (
              <>
                <Box component="span" aria-hidden sx={{ color: 'text.secondary' }}>
                  /
                </Box>
                <Link
                  component={RouterLink}
                  to={`/benchmarks?topic=${encodeURIComponent(topic.id)}`}
                  underline="hover"
                  color="primary.main"
                >
                  {topic.label}
                </Link>
              </>
            )}
          </Box>
          <PageHeader title={benchmark.title} />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
            {benchmark.date && (
              <Typography component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>
                {benchmark.date}
              </Typography>
            )}
            {benchmark.factorioVersion && (
              <Chip size="small" variant="outlined" label={`Factorio ${benchmark.factorioVersion}`} />
            )}
            {benchmark.platform && (
              <Chip size="small" variant="outlined" label={formatPlatform(benchmark.platform)} />
            )}
            {benchmark.cpu && <Chip size="small" variant="outlined" label={benchmark.cpu} />}
            {hasSaves && (
              <Chip
                size="small"
                variant="outlined"
                component={RouterLink}
                to={saveFolderRoute(benchmark.source)}
                clickable
                label={`${benchmark.saves.length} save files`}
              />
            )}
            {hasCharts && (
              <Chip
                size="small"
                variant="outlined"
                clickable
                onClick={() => setTab('charts')}
                label="Interactive metrics"
              />
            )}
            {benchmark.tags?.map((t) => (
              <Chip key={t} label={t} size="small" variant="outlined" />
            ))}
          </Box>
          {loaded?.question && (
            <Box
              component="section"
              aria-label="Question and answer"
              sx={{
                backgroundColor: 'background.paper',
                p: 2,
                mt: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <MarkdownRenderer
                source={loaded.question}
                sx={{
                  fontSize: { xs: 18, md: 20 },
                  lineHeight: 1.4,
                  color: 'text.primary',
                  ...leadBlocks,
                  // Typography gives paragraphs their own size; the question sets it for the whole block.
                  '& p': { fontSize: 'inherit', lineHeight: 'inherit' },
                  '& > ul, & > ol': { p: 0, listStyle: 'none' },
                  // Some questions are written in lower case in the source README.
                  '& > p:first-child::first-letter': upper,
                  '& > ul:first-child > li::first-letter': upper,
                  '& > ul:first-child > li > p:first-child::first-letter': upper,
                }}
              />
              {loaded.answer && <MarkdownRenderer source={loaded.answer} sx={leadBlocks} />}
            </Box>
          )}
        </Box>
        {hasTabs ? (
          <>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              sx={{
                mb: 3,
                borderBottom: 1,
                borderColor: 'divider',
                minHeight: 40,
                '& .MuiTab-root': { minHeight: 40, textTransform: 'none' },
              }}
            >
              <Tab value="readme" label="README" />
              {hasCharts && <Tab value="charts" label="Interactive metrics" />}
              {hasSaves && <Tab value="saves" label="Save files" />}
            </Tabs>
            {hasCharts && (
              <Box hidden={tab !== 'charts'}>
                {tab === 'charts' && <BenchmarkCharts slug={benchmark.slug} />}
              </Box>
            )}
            {hasSaves && (
              <Box hidden={tab !== 'saves'}>
                {tab === 'saves' && (
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                      File sizes, sub-folders and copyable links are in the{' '}
                      <Link component={RouterLink} to={saveFolderRoute(benchmark.source)}>
                        save browser
                      </Link>
                      .
                    </Typography>
                    {benchmark.saves.map((s) => (
                      <Link
                        key={s.path}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 14, wordBreak: 'break-all' }}
                      >
                        <DownloadIcon fontSize="small" />
                        {s.name}
                      </Link>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
            <Box hidden={tab !== 'readme'}>
              {tab === 'readme' && (
                <>
                  {!markdown && !error && <CircularProgress />}
                  {markdown && <MarkdownRenderer source={markdown} />}
                </>
              )}
            </Box>
          </>
        ) : (
          <>
            {!markdown && !error && <CircularProgress />}
            {markdown && <MarkdownRenderer source={markdown} />}
          </>
        )}
        {(older || newer) && (
          <Box
            role="group"
            aria-label="Older and newer benchmarks"
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              columnGap: 3,
              mt: 4,
              fontSize: 14,
            }}
          >
            {older ? (
              <Link
                component={RouterLink}
                to={`/benchmarks/${older.slug}`}
                underline="hover"
                color="text.secondary"
                sx={{ display: 'flex', alignItems: 'center', minHeight: layout.touchTarget, '&:hover': { color: 'primary.main' } }}
              >
                Older: {older.title}
              </Link>
            ) : (
              <span />
            )}
            {newer && (
              <Link
                component={RouterLink}
                to={`/benchmarks/${newer.slug}`}
                underline="hover"
                color="text.secondary"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: layout.touchTarget,
                  textAlign: { sm: 'right' },
                  '&:hover': { color: 'primary.main' },
                }}
              >
                Newer: {newer.title}
              </Link>
            )}
          </Box>
        )}
      </Box>

      <Box
        sx={{
          position: { md: 'sticky' },
          top: { md: layout.topBarHeight + 24 },
          // Never taller than the window; whatever does not fit scrolls inside.
          maxHeight: { md: `calc(100vh - ${layout.topBarHeight + 24 + 16}px)` },
          overflowY: { md: 'auto' },
          backgroundColor: 'background.paper',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        <Button
          component="a"
          href={benchmark.readmeGithubUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          size="small"
          fullWidth
          startIcon={<GitHubIcon />}
          sx={{ mb: 1 }}
        >
          View on GitHub
        </Button>

        {showToc && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <TableOfContents markdown={markdown} maxHeight={tocMaxHeight} />
          </>
        )}

        {goesWith.length > 0 && (
          <SidebarBlock heading="Goes with this">
            {goesWith.map((l) => (
              <Link key={l.key} component={RouterLink} to={l.to} underline="none" sx={sidebarLink}>
                {l.label}
              </Link>
            ))}
          </SidebarBlock>
        )}

        {topic && more.shown.length > 0 && (
          <SidebarBlock heading={`More in ${topic.label}`}>
            {more.shown.map((b) => (
              <Link
                key={b.slug}
                component={RouterLink}
                to={`/benchmarks/${b.slug}`}
                underline="none"
                title={b.title}
                sx={sidebarLinkOneLine}
              >
                {b.title}
              </Link>
            ))}
            {more.total > more.shown.length && (
              <Link
                component={RouterLink}
                to={`/benchmarks?topic=${encodeURIComponent(topic.id)}`}
                underline="none"
                sx={sidebarLinkOneLine}
              >
                All {topic.count}
              </Link>
            )}
          </SidebarBlock>
        )}
      </Box>
    </Box>
  );
}
