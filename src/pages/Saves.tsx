import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Link,
  OutlinedInput,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import GitHubIcon from '@mui/icons-material/GitHub';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import index from '../generated/index.json';
import type { ContentIndex, SaveFolderMeta } from '../content';
import { formatBytes, formatPlatform, formatSaveCount } from '../format';
import {
  collapseChain,
  findFolder,
  loadSaveTree,
  loadedSaveTree,
  saveFolderRoute,
  searchSaves,
  type SaveFile,
  type SaveFolder,
  type SaveTree,
} from '../saves';
import { CopyButton, SaveFileRow, SaveFolderRow, monoFont } from '../components/SaveRows';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { RowGroup } from '../components/ListRow';

const { sourceRepo } = index as ContentIndex;
const repoUrl = `https://github.com/${sourceRepo.owner}/${sourceRepo.repo}`;

const MAX_SEARCH_ROWS = 100;

type SortKey = 'date' | 'name' | 'size';
const LANDING_SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'date', label: 'Newest' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
];
// Dates only exist on top-level folders, so everywhere else is name or size.
const FOLDER_SORTS = LANDING_SORTS.slice(1);

const collator = new Intl.Collator(undefined, { numeric: true });

function sortFiles(files: SaveFile[], sort: SortKey): SaveFile[] {
  return [...files].sort(
    sort === 'size' ? (a, b) => b.bytes - a.bytes : (a, b) => collator.compare(a.path, b.path),
  );
}

function sortFolders(
  folders: SaveFolder[],
  sort: SortKey,
  meta?: Record<string, SaveFolderMeta>,
): SaveFolder[] {
  const label = (f: SaveFolder) => meta?.[f.path]?.title ?? f.name;
  const date = (f: SaveFolder) => meta?.[f.path]?.benchmark_date ?? '';
  return [...folders].sort((a, b) => {
    if (sort === 'size') return b.bytes - a.bytes;
    // Newest first; folders without a date sort after every dated one.
    if (sort === 'date' && date(a) !== date(b)) return date(a) < date(b) ? 1 : -1;
    return collator.compare(label(a), label(b));
  });
}

export function Saves() {
  const { tree, failed } = useSaveTree();
  // Folder lives in the URL path, search + sort in the query string, so every
  // view can be linked to. (`?path=` is taken by the 404.html deep-link shim.)
  const path = (useParams()['*'] ?? '').replace(/^\/+|\/+$/g, '');
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const searching = query.trim() !== '';
  const isLanding = !searching && path === '';

  const sorts = isLanding ? LANDING_SORTS : FOLDER_SORTS;
  const sort = sorts.find((s) => s.key === params.get('sort'))?.key ?? sorts[0].key;

  const setParam = (key: 'q' | 'sort', value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  // Opening a folder should start at its top, but Back/Forward should land
  // wherever the browser remembers. Keyed on the folder only: typing in the
  // search box or re-sorting must not move the page.
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [path]);

  const wide = useMediaQuery(useTheme().breakpoints.up('sm'));
  const folder = tree && !searching ? findFolder(tree, path) : null;
  const notFound = Boolean(tree) && !searching && !folder;

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Save files"
        meta={
          <>
            {tree ? tree.root.count : '…'} Factorio saves from the{' '}
            <Link href={repoUrl} target="_blank" rel="noopener noreferrer">
              {sourceRepo.repo}
            </Link>{' '}
            repo, {tree ? formatBytes(tree.root.bytes) : '…'} in total. Every download is served from
            Cloudflare.
          </>
        }
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <OutlinedInput
          value={query}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={
            tree && wide
              ? `Search ${tree.root.count} saves by file, folder or benchmark name`
              : 'Search saves'
          }
          inputProps={{ 'aria-label': 'Search saves' }}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          }
          endAdornment={
            query ? (
              <InputAdornment position="end">
                <IconButton aria-label="Clear search" edge="end" onClick={() => setParam('q', null)}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null
          }
          sx={{ flex: '1 1 300px', height: { xs: 44, md: 36 }, fontSize: 15, backgroundColor: 'background.paper' }}
        />
        {!notFound && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13 }}>
              Sort
            </Typography>
            {sorts.map((s) => {
              const active = s.key === sort;
              return (
                <Button
                  key={s.key}
                  variant="outlined"
                  color={active ? 'primary' : 'inherit'}
                  aria-pressed={active}
                  onClick={() => setParam('sort', s.key === sorts[0].key ? null : s.key)}
                  sx={{ height: { xs: 44, md: 36 }, fontSize: 13, borderColor: active ? 'primary.main' : 'rgba(255, 255, 255, 0.23)' }}
                >
                  {s.label}
                </Button>
              );
            })}
          </Stack>
        )}
      </Box>

      {failed && (
        <Alert
          severity="error"
          action={
            // A reload, not an in-place retry: browsers may remember a failed
            // module import for the life of the page.
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          The save index could not be loaded.
        </Alert>
      )}
      {!tree && !failed && (
        <Typography variant="body2" sx={{ backgroundColor: 'background.paper', color: 'text.secondary', px: 1.5, py: 3 }}>
          Loading the save index…
        </Typography>
      )}
      {tree &&
        (searching ? (
          <SearchResults tree={tree} query={query} sort={sort} />
        ) : !folder ? (
          <FolderNotFound tree={tree} path={path} />
        ) : folder === tree.root ? (
          <Landing tree={tree} sort={sort} />
        ) : (
          <FolderView tree={tree} folder={folder} sort={sort} />
        ))}
    </Stack>
  );
}

/** Loads the save index on first use; later visits get it synchronously. */
function useSaveTree() {
  const [tree, setTree] = useState<SaveTree | null>(loadedSaveTree);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSaveTree().then(
      (t) => !cancelled && setTree(t),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { tree, failed };
}

/** `/saves`: one section per top-level directory, listing its folders. */
function Landing({ tree, sort }: { tree: SaveTree; sort: SortKey }) {
  const sections = sortFolders(tree.root.folders, 'name');
  return (
    <Stack spacing={4}>
      {sections.map((section) => (
        <Box key={section.path} component="section">
          <SectionHeader
            label={section.name}
            summary={
              <>
                {section.folders.length} {section.folders.length === 1 ? 'folder' : 'folders'} ·{' '}
                {formatSaveCount(section.count)} · {formatBytes(section.bytes)}
              </>
            }
          />
          <RowGroup>
            {sortFolders(section.folders, sort, tree.meta).map((f) => {
              const meta = tree.meta[f.path];
              return (
                <SaveFolderRow
                  key={f.path}
                  path={collapseChain(f).folder.path}
                  label={meta?.title ?? f.name}
                  titled={Boolean(meta?.title)}
                  count={f.count}
                  bytes={f.bytes}
                  details={{ date: meta?.benchmark_date, version: meta?.factorio_version }}
                />
              );
            })}
            {sortFiles(section.files, sort).map((f) => (
              <SaveFileRow key={f.path} file={f} />
            ))}
          </RowGroup>
        </Box>
      ))}
      {tree.root.files.length > 0 && (
        <RowGroup>
          {sortFiles(tree.root.files, sort).map((f) => (
            <SaveFileRow key={f.path} file={f} />
          ))}
        </RowGroup>
      )}
    </Stack>
  );
}

/** `/saves/<repo path>`: breadcrumbs, benchmark header, sub-folders then files. */
function FolderView({ tree, folder, sort }: { tree: SaveTree; folder: SaveFolder; sort: SortKey }) {
  const segments = folder.path.split('/');
  const bulkCommand = `git lfs pull --include="${folder.path}/**"`;

  return (
    <>
      <Breadcrumbs aria-label="Folder path" separator="/" sx={{ fontFamily: monoFont, fontSize: 13.5 }}>
        <Link component={RouterLink} to="/saves" underline="hover">
          All saves
        </Link>
        {segments.slice(0, -1).map((segment, i) => (
          // The top-level directories are the sections of the landing page,
          // so that is where their crumb leads.
          <Link
            key={i}
            component={RouterLink}
            to={i === 0 ? '/saves' : saveFolderRoute(segments.slice(0, i + 1).join('/'))}
            underline="hover"
          >
            {segment}
          </Link>
        ))}
        <Typography
          component="span"
          aria-current="page"
          sx={{ font: 'inherit', fontWeight: 500, color: 'text.primary', overflowWrap: 'anywhere' }}
        >
          {segments[segments.length - 1]}
        </Typography>
      </Breadcrumbs>

      {segments.length >= 2 && <FolderHeader tree={tree} folder={folder} />}

      <RowGroup>
        {sortFolders(folder.folders, sort).map((f) => {
          const end = collapseChain(f);
          return (
            <SaveFolderRow key={f.path} path={end.folder.path} label={end.label} count={f.count} bytes={f.bytes} />
          );
        })}
        {sortFiles(folder.files, sort).map((f) => (
          <SaveFileRow key={f.path} file={f} />
        ))}
      </RowGroup>

      <Stack spacing={1} component="section">
        <Typography variant="overline" component="h2" sx={{ color: 'text.secondary', letterSpacing: 1, fontSize: 12 }}>
          Get the whole folder
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {formatSaveCount(folder.count)} ({formatBytes(folder.bytes)}) here. In a clone of {sourceRepo.repo}, this
          pulls all of them at once:
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, backgroundColor: 'background.paper', pl: 2, pr: 0.5, py: 0.5 }}>
          <Box component="code" sx={{ flex: 1, minWidth: 0, py: 1, fontFamily: monoFont, fontSize: 13, overflowWrap: 'anywhere' }}>
            {bulkCommand}
          </Box>
          <CopyButton text={bulkCommand} label="Copy command" tooltip="Copy command" />
        </Box>
      </Stack>
    </>
  );
}

/** Card describing the top-level folder (benchmark / competition) you are inside. */
function FolderHeader({ tree, folder }: { tree: SaveTree; folder: SaveFolder }) {
  const segments = folder.path.split('/');
  const topPath = segments.slice(0, 2).join('/');
  const top = findFolder(tree, topPath) ?? folder;
  const meta = tree.meta[topPath] ?? {};

  return (
    <Box
      component="section"
      sx={{
        backgroundColor: 'background.paper',
        p: 2,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 4,
        rowGap: 2,
      }}
    >
      <Box sx={{ flex: '1 1 300px', minWidth: 0 }}>
        <Typography variant="overline" sx={{ display: 'block', color: 'primary.main', letterSpacing: 1 }}>
          {meta.benchmark_date ?? (segments[0] === 'competitions' ? 'Competition' : 'Benchmark')}
        </Typography>
        <Typography variant="h5" component="h2" sx={{ overflowWrap: 'anywhere' }}>
          {meta.title ?? segments[1]}
        </Typography>
        <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {meta.factorio_version && (
            <Chip label={`Factorio ${meta.factorio_version}`} size="small" variant="outlined" />
          )}
          {meta.benchmark_machine_platform && (
            <Chip label={formatPlatform(meta.benchmark_machine_platform)} size="small" variant="outlined" />
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13 }}>
            {formatSaveCount(top.count)} · {formatBytes(top.bytes)}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        {meta.benchmark_slug && (
          <Button
            component={RouterLink}
            to={`/benchmarks/${meta.benchmark_slug}`}
            variant="contained"
            sx={{ minHeight: 44 }}
          >
            Read the writeup
          </Button>
        )}
        <Button
          component="a"
          href={`${repoUrl}/tree/${sourceRepo.branch}/${folder.path.split('/').map(encodeURIComponent).join('/')}`}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          startIcon={<GitHubIcon />}
          sx={{ minHeight: 44 }}
        >
          View on GitHub
        </Button>
      </Box>
    </Box>
  );
}

/** `?q=`: flat matches across every save, wherever you were browsing. */
function SearchResults({ tree, query, sort }: { tree: SaveTree; query: string; sort: SortKey }) {
  const hits = sortFiles(searchSaves(tree, query), sort);
  const bytes = hits.reduce((sum, f) => sum + f.bytes, 0);
  const shown = hits.slice(0, MAX_SEARCH_ROWS);
  const quoted = `“${query.trim()}”`;

  return (
    <>
      <Typography sx={{ color: 'text.secondary', fontSize: 15 }} role="status">
        {hits.length === 0
          ? `Nothing matches ${quoted}`
          : `${formatSaveCount(hits.length)} ${hits.length === 1 ? 'matches' : 'match'} ${quoted} · ${formatBytes(bytes)}` +
            (hits.length > shown.length ? ` · showing the first ${shown.length}` : '')}
      </Typography>
      {hits.length === 0 ? (
        <Typography variant="body2" sx={{ backgroundColor: 'background.paper', color: 'text.secondary', px: 1.5, py: 4 }}>
          No saves match that search. Try part of a file name, a folder or a benchmark title.
        </Typography>
      ) : (
        <RowGroup>
          {shown.map((f) => (
            <SaveFileRow key={f.path} file={f} showFolder />
          ))}
        </RowGroup>
      )}
    </>
  );
}

/** A `/saves/...` URL that matches no folder in the index (renamed, mistyped, stale link). */
function FolderNotFound({ tree, path }: { tree: SaveTree; path: string }) {
  // Deepest part of the path that does still exist, if any. Stops short of the
  // top-level directories: "Browse all saves" already covers those.
  const segments = path.split('/');
  let ancestor: SaveFolder | null = null;
  for (let i = segments.length - 1; i > 1 && !ancestor; i -= 1) {
    ancestor = findFolder(tree, segments.slice(0, i).join('/'));
  }

  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start', backgroundColor: 'background.paper', p: 3 }}>
      <Typography variant="overline" sx={{ color: 'primary.main', letterSpacing: 1 }}>
        Folder not found
      </Typography>
      <Typography sx={{ overflowWrap: 'anywhere' }}>
        There are no saves at{' '}
        <Box component="code" sx={{ fontFamily: monoFont, fontSize: '0.875em' }}>
          {path}
        </Box>
        . The folder may have been renamed or removed.
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <Button component={RouterLink} to="/saves" variant="contained">
          Browse all saves
        </Button>
        {ancestor && (
          <Button
            component={RouterLink}
            to={saveFolderRoute(ancestor.path)}
            variant="outlined"
            sx={{ textTransform: 'none', fontFamily: monoFont, overflowWrap: 'anywhere' }}
          >
            {ancestor.path}
          </Button>
        )}
      </Box>
    </Stack>
  );
}
