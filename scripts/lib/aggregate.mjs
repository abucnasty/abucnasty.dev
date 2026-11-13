/**
 * Per-benchmark CSV aggregator. Reads a `*_verbose_metrics.csv` file produced
 * by belt-charts (columns: tick,run,<metric>,<metric>,...; values in
 * nanoseconds), aggregates across runs per tick, applies a time-weighted
 * window, and returns metric → [{x: tickStart, y: µs}] series.
 *
 * Pure ESM, no deps. Reimplements the relevant bits of
 * belt-charts/src/utils.ts (`timeWeightedAverageByChunks`) and
 * belt-charts/src/data/BenchmarkTickResult.ts (per-tick mean across runs).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * @typedef {Object} AggregateOptions
 * @property {string[]} [metrics]            Metric column names to keep. Defaults to all numeric columns except tick/run.
 * @property {number}   [removeFirstTicks]   Drop ticks <= this value. Default 30.
 * @property {number}   [maxTicks]           Drop ticks > this value. Default Infinity.
 * @property {number}   [window]             Window size for time-weighted averaging. Default 60.
 */

/**
 * @typedef {Object} ScenarioAggregation
 * @property {string[]} availableMetrics
 * @property {Record<string, Array<{x: number, y: number}>>} metrics
 */

/**
 * Default metric allowlist when the manifest entry doesn't specify one.
 * Mirrors the metrics belt-charts has explicit styling for, ordered roughly
 * by importance for UPS analysis.
 */
export const DEFAULT_METRICS = [
  'wholeUpdate',
  'entityUpdate',
  'transportLinesUpdate',
  'electricHeatFluidCircuitUpdate',
  'controlBehaviorUpdate',
  'fluidFlowUpdate',
  'electricNetworkUpdate',
  'heatNetworkUpdate',
  'spacePlatforms',
  'trains',
  'particleUpdate',
];

/**
 * @param {string} filePath
 * @param {AggregateOptions} [opts]
 * @returns {Promise<ScenarioAggregation>}
 */
export async function aggregateScenarioCsv(filePath, opts = {}) {
  const removeFirstTicks = opts.removeFirstTicks ?? 30;
  const maxTicks = opts.maxTicks ?? Infinity;
  const window = opts.window ?? 60;
  const allowed = new Set(opts.metrics ?? DEFAULT_METRICS);

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  /** @type {string[] | null} */
  let header = null;
  /** @type {number} */
  let tickCol = -1;
  /** @type {number[]} */
  let metricCols = [];
  /** @type {string[]} */
  let metricNames = [];

  // perTick[metricIdx] = Map<tick, [sum, count]>
  /** @type {Map<number, [number, number]>[]} */
  let perTick = [];

  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      header = line.split(',').map((s) => s.trim());
      tickCol = header.indexOf('tick');
      if (tickCol < 0) throw new Error(`No "tick" column in ${filePath}`);
      header.forEach((name, i) => {
        if (!name || name === 'tick' || name === 'run') return;
        if (!allowed.has(name)) return;
        metricCols.push(i);
        metricNames.push(name);
      });
      perTick = metricCols.map(() => new Map());
      continue;
    }
    const cols = line.split(',');
    const tick = +cols[tickCol];
    if (!Number.isFinite(tick)) continue;
    if (tick <= removeFirstTicks || tick > maxTicks) continue;
    for (let i = 0; i < metricCols.length; i++) {
      const v = +cols[metricCols[i]];
      if (!Number.isFinite(v)) continue;
      const m = perTick[i];
      const cur = m.get(tick);
      if (cur) {
        cur[0] += v;
        cur[1] += 1;
      } else {
        m.set(tick, [v, 1]);
      }
    }
  }

  // Per-tick mean across runs (ns), then time-weighted window aggregation, then ns→µs.
  /** @type {Record<string, Array<{x: number, y: number}>>} */
  const out = {};
  for (let i = 0; i < metricNames.length; i++) {
    const series = [];
    for (const [tick, [sum, count]] of perTick[i]) {
      series.push({ tick, value: sum / count });
    }
    series.sort((a, b) => a.tick - b.tick);
    const windowed = timeWeightedAverageByChunks(series, window);
    out[metricNames[i]] = windowed.map(({ tick, value }) => ({
      x: tick,
      y: Math.round((value / 1000) * 100) / 100, // ns → µs, 2 decimals
    }));
  }

  return { availableMetrics: metricNames, metrics: out };
}

/**
 * Time-weighted average grouped into fixed-size chunks of `window` ticks.
 * Ported from belt-charts/src/utils.ts.
 *
 * @param {Array<{tick: number, value: number}>} data
 * @param {number} window
 * @returns {Array<{tick: number, tickEnd: number, value: number}>}
 */
function timeWeightedAverageByChunks(data, window) {
  if (data.length === 0) return [];
  const sorted = data; // assumed pre-sorted
  const results = [];
  const minTick = sorted[0].tick;
  const maxTick = sorted[sorted.length - 1].tick;
  const firstWindowStart = Math.floor(minTick / window) * window;

  for (let wStart = firstWindowStart; wStart <= maxTick; wStart += window) {
    const wEnd = wStart + window;
    let weightedSum = 0;
    let totalDuration = 0;

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const next = i + 1 < sorted.length ? sorted[i + 1] : null;
      const segStart = Math.max(wStart, current.tick);
      const segEnd = Math.min(wEnd, next ? next.tick : wEnd);
      if (segEnd <= wStart) continue;
      if (segStart >= wEnd) break;
      const duration = segEnd - segStart;
      if (duration > 0) {
        weightedSum += current.value * duration;
        totalDuration += duration;
      }
    }

    results.push({
      tick: wStart,
      tickEnd: wEnd,
      value: totalDuration > 0 ? weightedSum / totalDuration : 0,
    });
  }
  return results;
}
