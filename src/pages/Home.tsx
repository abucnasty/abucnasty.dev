import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink } from 'react-router-dom';
import index from '../generated/index.json';
import type { ContentIndex } from '../content';
import { activeCount, useCatalog } from '../catalog';
import { blogPosts } from '../blog/registry';
import { formatBytes } from '../format';
import { layout } from '../layout';
import { SocialLinks } from '../components/SocialLinks';
import { LatestVideo } from '../components/LatestVideo';
import { BrandAvatar } from '../components/BrandAvatar';
import { SectionHeader } from '../components/SectionHeader';
import { ListRow, RowGroup } from '../components/ListRow';
import { useSearch } from '../components/SearchDialog';

const content = index as ContentIndex;

const LATEST_COUNT = 8;

interface FeedItem {
  key: string;
  to: string;
  date: string;
  title: string;
  /** Muted second line: the finding, question or summary; a post's description. */
  subtitle?: string;
  /** Chip text: the topic label for a benchmark with a topic, else its Factorio version; "Post" for a post. */
  tag?: string;
}

const topicLabels = new Map(content.topics.map((t) => [t.id, t.label]));

function benchmarkItem(b: ContentIndex['benchmarks'][number]): FeedItem {
  const topicLabel = b.topic ? topicLabels.get(b.topic) : undefined;
  return {
    key: `benchmark:${b.slug}`,
    to: `/benchmarks/${b.slug}`,
    date: b.date ?? '',
    title: b.title,
    subtitle: b.finding ?? b.question ?? b.summary,
    tag: topicLabel ?? b.factorioVersion,
  };
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <ListRow
      to={item.to}
      lead={
        <Box
          component="span"
          sx={{ fontSize: 13, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', width: 76 }}
        >
          {item.date || ' '}
        </Box>
      }
      title={item.title}
      subtitle={item.subtitle}
      trailing={
        item.tag ? (
          <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
            <Chip label={item.tag} size="small" variant="outlined" />
          </Box>
        ) : undefined
      }
    />
  );
}

const latest: FeedItem[] = [
  ...content.benchmarks.filter((b) => b.date).map(benchmarkItem),
  ...blogPosts.map(
    (p): FeedItem => ({
      key: `post:${p.slug}`,
      to: `/blog/${p.slug}`,
      date: p.date,
      title: p.title,
      subtitle: p.description,
      tag: 'Post',
    }),
  ),
]
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  .slice(0, LATEST_COUNT);

const latestKeys = new Set(latest.map((i) => i.key));
const featured = content.benchmarks
  .filter((b) => b.featured)
  .map(benchmarkItem)
  .filter((i) => !latestKeys.has(i.key));

/** The rows of "Also here"; the blueprint count comes from the live catalog once it has loaded. */
const alsoHere = (activeBlueprints: number | null): Array<{ title: string; subtitle: string; to: string }> => [
  {
    title: 'Blueprints',
    subtitle: activeBlueprints === null ? 'Megabase builds, straight from the vault' : `${activeBlueprints} active blueprints`,
    to: '/blueprints',
  },
  {
    title: 'Save files',
    subtitle: `${content.saveStats.count} saves, ${formatBytes(content.saveStats.bytes)}`,
    to: '/saves',
  },
  { title: 'Tools and mods', subtitle: 'Benchmarking tools, utilities and mods', to: '/tools' },
  {
    title: 'Blog',
    subtitle: `${blogPosts.length} ${blogPosts.length === 1 ? 'post' : 'posts'}`,
    to: '/blog',
  },
  { title: 'About', subtitle: 'Who runs this and how to get in touch', to: '/about' },
];

const fullSearchText = (activeBlueprints: number | null) =>
  `Search ${content.benchmarks.length} benchmarks, ${activeBlueprints === null ? '' : `${activeBlueprints} `}blueprints and ${content.saveStats.count} save files`;

export function Home() {
  const { open: openSearch } = useSearch();
  const catalog = useCatalog();
  const activeBlueprints = catalog.catalog ? activeCount(catalog.catalog) : null;
  const searchText = fullSearchText(activeBlueprints);
  return (
    <Stack spacing={layout.sectionGap}>
      <Box
        data-home-strip
        sx={{
          backgroundColor: 'background.paper',
          px: 2,
          py: { xs: 2, sm: 1.5 },
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <BrandAvatar sx={{ width: 44, height: 44 }} />
        <Box sx={{ flex: '1 1 280px', minWidth: 0, order: { xs: 2, sm: 0 } }}>
          <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
            Factorio benchmarks, blueprints, and tools.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            UPS research and side-projects from abucnasty. Everything here is open source.
          </Typography>
        </Box>
        {/* On phones the links sit beside the avatar so the strip stays short. */}
        <Box sx={{ order: { xs: 1, sm: 0 }, ml: { xs: 'auto', sm: 0 } }}>
          <SocialLinks />
        </Box>
      </Box>

      <ButtonBase
        data-home-search
        onClick={openSearch}
        aria-label={searchText}
        sx={{
          display: 'flex',
          justifyContent: 'flex-start',
          gap: 1.5,
          width: '100%',
          height: layout.touchTarget,
          px: 2,
          textAlign: 'left',
          backgroundColor: 'background.paper',
          color: 'text.secondary',
          fontSize: 14,
          '&:hover': { color: 'text.primary' },
        }}
      >
        <SearchIcon fontSize="small" />
        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' }, whiteSpace: 'nowrap' }}>
          Search the site
        </Box>
        <Box
          component="span"
          sx={{ display: { xs: 'none', sm: 'inline' }, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {searchText}
        </Box>
      </ButtonBase>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.75fr) minmax(0, 1fr)' },
          gap: { xs: layout.sectionGap, md: 4 },
          alignItems: 'start',
        }}
      >
        <Stack spacing={layout.sectionGap}>
          <Box>
            <SectionHeader label="Latest" summary="benchmarks and posts, newest first" />
            <RowGroup>
              {latest.map((item) => (
                <FeedRow key={item.key} item={item} />
              ))}
            </RowGroup>
            <Typography
              component={RouterLink}
              to="/benchmarks"
              variant="body2"
              sx={{
                display: 'flex',
                alignItems: 'center',
                minHeight: { xs: layout.touchTarget, md: 'auto' },
                py: 1,
                px: 1.25,
                color: 'primary.main',
              }}
            >
              All {content.benchmarks.length} benchmarks
            </Typography>
          </Box>
          {featured.length > 0 && (
            <Box>
              <SectionHeader label="Featured" />
              <RowGroup>
                {featured.map((item) => (
                  <FeedRow key={item.key} item={item} />
                ))}
              </RowGroup>
            </Box>
          )}
        </Stack>

        <Stack spacing={layout.sectionGap}>
          {content.topics.length > 0 && (
            <Box>
              <SectionHeader label="Topics" />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, pt: 1.25 }}>
                {content.topics.map((t) => (
                  <Chip
                    key={t.id}
                    component={RouterLink}
                    to={`/benchmarks?topic=${t.id}`}
                    clickable
                    size="small"
                    variant="outlined"
                    label={
                      <>
                        {t.label}{' '}
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          {t.count}
                        </Box>
                      </>
                    }
                    sx={{ height: { xs: 32, md: 24 } }}
                  />
                ))}
              </Box>
            </Box>
          )}
          <Box>
            <SectionHeader label="Also here" />
            <RowGroup>
              {alsoHere(activeBlueprints).map((r) => (
                <ListRow key={r.to} to={r.to} title={r.title} subtitle={r.subtitle} />
              ))}
            </RowGroup>
          </Box>
          <Box>
            <SectionHeader label="Latest video" />
            <LatestVideo compact />
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
}
