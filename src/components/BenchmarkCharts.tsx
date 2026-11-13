import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { TimeseriesPayload, TimeseriesGroup, ScenarioPayload } from './TimeseriesChart';

const TimeseriesChart = lazy(() =>
  import('./TimeseriesChart').then((m) => ({ default: m.TimeseriesChart })),
);

// Eagerly resolve the URL of every generated timeseries.json — Vite turns
// each into its own chunk we can dynamically `fetch()` at runtime by slug.
const timeseriesModules = import.meta.glob(
  '../generated/benchmarks/*/timeseries.json',
  { import: 'default' },
);

const PRIMARY_METRICS = ['wholeUpdate', 'entityUpdate'];

interface BenchmarkChartsProps {
  slug: string;
}

export function BenchmarkCharts({ slug }: BenchmarkChartsProps) {
  const [payload, setPayload] = useState<TimeseriesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);

  const loader = useMemo(() => {
    const key = Object.keys(timeseriesModules).find((p) =>
      p.endsWith(`/${slug}/timeseries.json`),
    );
    return key ? timeseriesModules[key] : null;
  }, [slug]);

  useEffect(() => {
    if (!loader) {
      setError('No timeseries data for this benchmark.');
      return;
    }
    let cancelled = false;
    setGroupIndex(0);
    loader()
      .then((mod) => {
        if (!cancelled) setPayload(mod as TimeseriesPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load chart data.');
      });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  if (error) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {error}
      </Typography>
    );
  }

  if (!payload) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Loading interactive metrics…
        </Typography>
      </Box>
    );
  }

  // Normalise to a single active group regardless of payload shape.
  let activeMetrics: string[];
  let activeScenarios: ScenarioPayload[];
  let groups: TimeseriesGroup[] | undefined;

  if (payload.groups?.length) {
    groups = payload.groups;
    const g = groups[groupIndex] ?? groups[0];
    activeMetrics = g.metrics;
    activeScenarios = g.scenarios;
  } else {
    activeMetrics = payload.metrics ?? [];
    activeScenarios = payload.scenarios ?? [];
  }

  const primary = PRIMARY_METRICS.filter((m) => activeMetrics.includes(m));
  const secondary = activeMetrics.filter((m) => !primary.includes(m));

  // Construct a normalised flat payload for TimeseriesChart (it only needs
  // window/unit/scenarios — metrics is not used internally).
  const flatPayload: TimeseriesPayload = {
    window: payload.window,
    unit: payload.unit,
    metrics: activeMetrics,
    scenarios: activeScenarios,
  };

  return (
    <Stack spacing={3}>
      {groups && groups.length > 1 && (
        <Tabs
          value={groupIndex}
          onChange={(_, v) => setGroupIndex(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            minHeight: 40,
            '& .MuiTab-root': { minHeight: 40, textTransform: 'none' },
          }}
        >
          {groups.map((g, i) => (
            <Tab key={g.name} value={i} label={g.name} />
          ))}
        </Tabs>
      )}
      <Suspense fallback={<ChartSkeleton />}>
        {primary.map((m) => (
          <ChartCard key={m}>
            <TimeseriesChart payload={flatPayload} metric={m} />
          </ChartCard>
        ))}
        {secondary.length > 0 && (
          <Accordion
            disableGutters
            sx={{
              backgroundColor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: 'primary.main' }} />}
              sx={{ minHeight: 48 }}
            >
              <Typography
                variant="overline"
                sx={{ color: 'primary.main', letterSpacing: 1.5 }}
              >
                Additional metrics ({secondary.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack spacing={3}>
                {secondary.map((m) => (
                  <ChartCard key={m}>
                    <TimeseriesChart payload={flatPayload} metric={m} />
                  </ChartCard>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
      </Suspense>
    </Stack>
  );
}

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        p: { xs: 1.5, sm: 2 },
      }}
    >
      {children}
    </Box>
  );
}

function ChartSkeleton() {
  return (
    <Box
      sx={{
        height: 280,
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <CircularProgress size={20} />
    </Box>
  );
}


