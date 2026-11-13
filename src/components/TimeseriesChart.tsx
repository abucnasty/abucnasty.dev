import { useMemo, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import { Box, Button, Stack, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { metricLabel, scenarioColor } from './chartTheme';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin,
);

export interface TimeseriesPoint {
  x: number;
  y: number;
}

export interface ScenarioPayload {
  name: string;
  metrics: Record<string, TimeseriesPoint[]>;
}

export interface TimeseriesGroup {
  name: string;
  metrics: string[];
  scenarios: ScenarioPayload[];
}

export interface TimeseriesPayload {
  window: number;
  unit: string;
  /** Present in flat (ungrouped) mode */
  metrics?: string[];
  /** Present in flat (ungrouped) mode */
  scenarios?: ScenarioPayload[];
  /** Present in grouped mode */
  groups?: TimeseriesGroup[];
}

export interface TimeseriesChartProps {
  payload: TimeseriesPayload;
  metric: string;
  height?: number;
}

const GRID = 'rgba(255,255,255,0.08)';
const TICK = 'rgba(255,255,255,0.6)';
const LEGEND = 'rgba(255,255,255,0.85)';

export function TimeseriesChart({
  payload,
  metric,
  height = 280,
}: TimeseriesChartProps) {
  const chartRef = useRef<ChartJS<'line'> | null>(null);
  const data = useMemo(() => {
    const datasets = (payload.scenarios ?? [])
      .map((scenario, i) => {
        const points = scenario.metrics[metric];
        if (!points) return null;
        const color = scenarioColor(i);
        return {
          label: scenario.name,
          data: points,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          parsing: false as const,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    return { datasets };
  }, [payload, metric]);

  const xRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const scenario of payload.scenarios ?? []) {
      const points = scenario.metrics[metric];
      if (!points || points.length === 0) continue;
      const first = points[0].x;
      const last = points[points.length - 1].x;
      if (first < min) min = first;
      if (last > max) max = last;
    }
    return Number.isFinite(min) && Number.isFinite(max)
      ? { min, max }
      : undefined;
  }, [payload, metric]);

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: {
            color: LEGEND,
            boxHeight: 8,
            boxWidth: 14,
            padding: 12,
            font: { size: 12 },
            usePointStyle: false,
          },
        },
        tooltip: {
          backgroundColor: '#000',
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 10,
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed?.x;
              return x != null ? `Tick ${x.toLocaleString()}` : '';
            },
            label: (item) => {
              const y = item.parsed?.y;
              const v = y != null ? y.toFixed(2) : '—';
              return `${item.dataset.label}: ${v} ${payload.unit}`;
            },
          },
        },
        title: {
          display: true,
          text: `${metricLabel(metric)} (${payload.unit}, ${payload.window}-tick window)`,
          color: LEGEND,
          font: { size: 13, weight: 'normal' },
          padding: { top: 0, bottom: 12 },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy',
            modifierKey: 'shift',
          },
          zoom: {
            wheel: { enabled: true, modifierKey: 'ctrl' },
            pinch: { enabled: true },
            drag: {
              enabled: true,
              backgroundColor: 'rgba(252,163,0,0.15)',
              borderColor: 'rgba(252,163,0,0.6)',
              borderWidth: 1,
            },
            mode: 'x',
          },
          limits: {
            x: xRange
              ? { min: xRange.min, max: xRange.max }
              : { min: 'original', max: 'original' },
            y: { min: 'original', max: 'original' },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: xRange?.min,
          max: xRange?.max,
          bounds: 'data',
          ticks: {
            color: TICK,
            callback: (value) => Number(value).toLocaleString(),
            maxTicksLimit: 8,
          },
          grid: { color: GRID, drawTicks: false },
          border: { color: GRID },
          title: {
            display: true,
            text: 'Tick',
            color: TICK,
            font: { size: 11 },
          },
        },
        y: {
          type: 'linear',
          ticks: { color: TICK },
          grid: { color: GRID, drawTicks: false },
          border: { color: GRID },
          title: {
            display: true,
            text: payload.unit,
            color: TICK,
            font: { size: 11 },
          },
        },
      },
    }),
    [metric, payload.unit, payload.window, xRange],
  );

  return (
    <Box sx={{ width: '100%' }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1, gap: 2, flexWrap: 'wrap' }}
      >
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Drag to zoom · Ctrl+wheel · Shift+drag to pan · pinch on touch
        </Typography>
        <Button
          size="small"
          variant="text"
          startIcon={<RestartAltIcon fontSize="small" />}
          onClick={() => chartRef.current?.resetZoom()}
          sx={{ color: 'primary.main', minWidth: 0 }}
        >
          Reset zoom
        </Button>
      </Stack>
      <Box sx={{ height, width: '100%', position: 'relative' }}>
        <Line ref={chartRef} data={data} options={options} />
      </Box>
    </Box>
  );
}
