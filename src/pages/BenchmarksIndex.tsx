import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Link as MuiLink,
  OutlinedInput,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import ClearIcon from '@mui/icons-material/Clear';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import index from '../generated/index.json';
import type { BenchmarkEntry, ContentIndex } from '../content';
import { DenseTable } from '../components/DenseTable';
import { PageHeader } from '../components/PageHeader';
import { layout } from '../layout';
import { saveFolderRoute } from '../saves';
import {
  NO_FILTERS,
  isFiltered,
  matches,
  readFilters,
  versionOptions,
  writeFilters,
  type BenchmarkFilters,
} from '../benchmarkFilters';

const content = index as ContentIndex;

const chipSx = { height: 20, fontSize: 12 };
const topicChipSx = { height: { xs: 32, md: 24 } };
const controlHeight = { xs: layout.touchTarget, md: 36 };
// Same unselected outline as the sort buttons on the Saves page.
const buttonBorder = 'rgba(255, 255, 255, 0.23)';

const versions = versionOptions(content.benchmarks);
const topicLabels = new Map(content.topics.map((t) => [t.id, t.label]));
const topicLabel = (id: string) => topicLabels.get(id) ?? '';
const sorted = [...content.benchmarks].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
const chartsTotal = content.benchmarks.filter((b) => b.timeseries).length;
const savesTotal = content.benchmarks.filter((b) => b.saves.length > 0).length;

function ChartMarker() {
  return (
    <Tooltip title="Interactive metrics">
      <Box
        component="span"
        role="img"
        aria-label="Interactive metrics"
        sx={{ display: 'inline-flex', color: 'primary.main' }}
      >
        <BarChartIcon sx={{ fontSize: 16 }} />
      </Box>
    </Tooltip>
  );
}

function SaveMarker({ b }: { b: BenchmarkEntry }) {
  return (
    <MuiLink
      component={RouterLink}
      to={saveFolderRoute(b.source)}
      underline="none"
      aria-label={`${b.saves.length} save files for ${b.title}`}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        // 24 px tap target on phones. The negative vertical margin keeps the row no taller than
        // it was: the 20 px chips beside the link set the line height, as before.
        minHeight: { xs: 24 },
        minWidth: { xs: 24 },
        my: { xs: -0.5 },
        color: 'text.secondary',
        fontSize: 13,
        '&:hover': { color: 'primary.main' },
      }}
    >
      <DownloadIcon sx={{ fontSize: 16 }} />
      {b.saves.length}
    </MuiLink>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
  shortLabel,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  /** Shown instead of `label` on `xs`; `label` stays the accessible name. */
  shortLabel?: string;
  count?: number;
}) {
  return (
    <Button
      variant="outlined"
      color={active ? 'primary' : 'inherit'}
      aria-pressed={active}
      aria-label={count === undefined ? undefined : `${label} ${count}`}
      onClick={onClick}
      startIcon={icon}
      sx={{ height: controlHeight, fontSize: 13, borderColor: active ? 'primary.main' : buttonBorder }}
    >
      {shortLabel ? (
        <>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {label}
          </Box>
          <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
            {shortLabel}
          </Box>
        </>
      ) : (
        label
      )}
      {count !== undefined ? (
        <Box component="span" sx={{ ml: 0.75, color: 'text.secondary' }}>
          {count}
        </Box>
      ) : null}
    </Button>
  );
}

export function BenchmarksIndex() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params, content), [params]);
  const filtered = isFiltered(filters);

  // The input keeps its own value so typing never waits on the URL round trip; the URL
  // only feeds it back when it changes from elsewhere (Clear filters, Back).
  const [text, setText] = useState(filters.q);
  useEffect(() => {
    setText((current) => (current === filters.q ? current : filters.q));
  }, [filters.q]);

  const update = (patch: Partial<BenchmarkFilters>) => {
    setParams((prev) => writeFilters(prev, { ...readFilters(prev, content), ...patch }), {
      replace: true,
    });
  };
  const setQuery = (q: string) => {
    setText(q);
    update({ q });
  };
  const clear = () => {
    setText('');
    setParams((prev) => writeFilters(prev, NO_FILTERS), { replace: true });
  };

  // A topic chosen in the URL may sit off-screen in the scrolling chip row on phones: bring it
  // into view inside the row only (scrollIntoView would move the page too).
  const topicRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = topicRow.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && chip) row.scrollLeft = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
  }, []);

  const rows = sorted.filter((b) => matches(b, filters, topicLabel));
  const hasTopics = content.topics.length > 0;

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Benchmarks"
        meta={
          <>
            {content.benchmarks.length} curated benchmarks from the{' '}
            <MuiLink
              href={`https://github.com/${content.sourceRepo.owner}/${content.sourceRepo.repo}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              factorio-benchmarks
            </MuiLink>{' '}
            repo.
          </>
        }
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <OutlinedInput
          value={text}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, question or topic"
          inputProps={{ 'aria-label': 'Filter benchmarks' }}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          }
          endAdornment={
            text ? (
              <InputAdornment position="end">
                <IconButton aria-label="Clear filter text" edge="end" onClick={() => setQuery('')}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null
          }
          sx={{
            flex: '1 1 260px',
            height: controlHeight,
            fontSize: 14,
            backgroundColor: 'background.paper',
          }}
        />
        {versions.length > 0 ? (
          <>
            <ToggleButton
              active={filters.version === ''}
              onClick={() => update({ version: '' })}
              label="All versions"
            />
            {versions.map((v) => (
              <ToggleButton
                key={v}
                active={filters.version === v}
                onClick={() => update({ version: v })}
                label={v}
              />
            ))}
          </>
        ) : null}
        <ToggleButton
          active={filters.charts}
          onClick={() => update({ charts: !filters.charts })}
          icon={<BarChartIcon />}
          label="Interactive metrics"
          shortLabel="Metrics"
          count={chartsTotal}
        />
        <ToggleButton
          active={filters.saves}
          onClick={() => update({ saves: !filters.saves })}
          icon={<DownloadIcon />}
          label="Save files"
          count={savesTotal}
        />
      </Box>

      {hasTopics ? (
        <Box
          ref={topicRow}
          sx={{
            display: 'flex',
            position: 'relative',
            flexWrap: { xs: 'nowrap', sm: 'wrap' },
            overflowX: { xs: 'auto', sm: 'visible' },
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
            '& > *': { flexShrink: 0 },
            gap: 0.75,
          }}
        >
          <Chip
            label="All"
            size="small"
            variant="outlined"
            clickable
            color={filters.topic === '' ? 'primary' : 'default'}
            aria-pressed={filters.topic === ''}
            onClick={() => update({ topic: '' })}
            sx={topicChipSx}
          />
          {content.topics.map((t) => {
            const selected = filters.topic === t.id;
            return (
              <Chip
                key={t.id}
                size="small"
                variant="outlined"
                clickable
                color={selected ? 'primary' : 'default'}
                aria-pressed={selected}
                onClick={() => update({ topic: selected ? '' : t.id })}
                label={
                  <>
                    {t.label}{' '}
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {t.count}
                    </Box>
                  </>
                }
                sx={topicChipSx}
              />
            );
          })}
        </Box>
      ) : null}

      {filtered ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {rows.length} of {content.benchmarks.length} benchmarks
          </Typography>
          <Button size="small" onClick={clear} sx={{ minHeight: { xs: 32, md: 24 } }}>
            Clear filters
          </Button>
        </Box>
      ) : null}

      {rows.length === 0 ? (
        <Box sx={{ bgcolor: 'background.paper', p: 3 }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            No benchmarks match these filters.
          </Typography>
          <Button
            variant="outlined"
            color="inherit"
            onClick={clear}
            sx={{ height: controlHeight, fontSize: 13, borderColor: buttonBorder }}
          >
            Clear filters
          </Button>
        </Box>
      ) : (
        <DenseTable aria-label="Benchmarks">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Benchmark</TableCell>
              {hasTopics ? (
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Topic</TableCell>
              ) : null}
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Factorio</TableCell>
              <TableCell
                aria-label="Charts and saves"
                align="right"
                sx={{ display: { xs: 'none', sm: 'table-cell' } }}
              />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((b) => {
              const question = b.question ?? b.summary;
              return (
                <TableRow key={b.slug} hover sx={{ height: { xs: layout.touchTarget } }}>
                  <TableCell
                    sx={{
                      whiteSpace: 'nowrap',
                      color: 'text.secondary',
                      fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    }}
                  >
                    {b.date ?? '—'}
                  </TableCell>
                  {/* width + maxWidth 0: the cell takes the space the other columns leave and the
                      question truncates inside it instead of pushing them off the table. */}
                  <TableCell sx={{ width: '100%', maxWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, minWidth: 0 }}>
                      <MuiLink
                        component={RouterLink}
                        to={`/benchmarks/${b.slug}`}
                        underline="hover"
                        sx={{
                          fontWeight: 600,
                          fontSize: 14,
                          flexShrink: { xs: 1, md: 0 },
                        }}
                      >
                        {b.title}
                      </MuiLink>
                      {question ? (
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{
                            display: { xs: 'none', md: 'block' },
                            flex: 1,
                            minWidth: 0,
                            color: 'text.secondary',
                          }}
                        >
                          {question}
                        </Typography>
                      ) : null}
                    </Box>
                    {question ? (
                      <Typography
                        noWrap
                        sx={{
                          display: { xs: 'block', sm: 'none' },
                          fontSize: 12.5,
                          color: 'text.secondary',
                          mt: 0.25,
                        }}
                      >
                        {question}
                      </Typography>
                    ) : null}
                    <Box
                      sx={{
                        display: { xs: 'flex', sm: 'none' },
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 0.75,
                        mt: 0.75,
                      }}
                    >
                      {b.factorioVersion ? (
                        <Chip label={b.factorioVersion} size="small" variant="outlined" sx={chipSx} />
                      ) : null}
                      {b.timeseries ? <ChartMarker /> : null}
                      {b.saves.length > 0 ? <SaveMarker b={b} /> : null}
                    </Box>
                  </TableCell>
                  {hasTopics ? (
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, whiteSpace: 'nowrap' }}>
                      {b.topic ? (
                        <Chip
                          label={topicLabel(b.topic)}
                          size="small"
                          variant="outlined"
                          clickable
                          onClick={() => update({ topic: b.topic })}
                          sx={chipSx}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, whiteSpace: 'nowrap' }}>
                    {b.factorioVersion ? (
                      <Chip label={b.factorioVersion} size="small" variant="outlined" sx={chipSx} />
                    ) : (
                      <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ display: { xs: 'none', sm: 'table-cell' }, whiteSpace: 'nowrap' }}
                  >
                    {b.timeseries || b.saves.length > 0 ? (
                      <Stack
                        direction="row"
                        spacing={1.25}
                        sx={{ justifyContent: 'flex-end', alignItems: 'center' }}
                      >
                        {b.timeseries ? <ChartMarker /> : null}
                        {b.saves.length > 0 ? <SaveMarker b={b} /> : null}
                      </Stack>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </DenseTable>
      )}
    </Stack>
  );
}
