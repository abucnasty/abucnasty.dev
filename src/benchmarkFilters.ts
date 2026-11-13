import type { BenchmarkEntry, ContentIndex } from './content';

export interface BenchmarkFilters {
  /** Free text. Whitespace-separated terms; all must match. */
  q: string;
  /** Topic id, or '' for all. */
  topic: string;
  /** Factorio major.minor such as '2.1', or '' for all. */
  version: string;
  /** Only benchmarks with interactive metrics. */
  charts: boolean;
  /** Only benchmarks with save files. */
  saves: boolean;
}

export const NO_FILTERS: BenchmarkFilters = { q: '', topic: '', version: '', charts: false, saves: false };

const majorMinor = (v: string) => v.split('.').slice(0, 2).join('.');

/** Versions present in the data as 'major.minor', newest first. */
export function versionOptions(benchmarks: BenchmarkEntry[]): string[] {
  const set = new Set<string>();
  for (const b of benchmarks) if (b.factorioVersion) set.add(majorMinor(b.factorioVersion));
  const num = (s: string) => s.split('.').map(Number);
  return [...set].sort((a, b) => {
    const [a1, a2] = num(a);
    const [b1, b2] = num(b);
    return b1 - a1 || b2 - a2;
  });
}

/** Read filters from a query string. Unknown topic ids and versions become ''. */
export function readFilters(params: URLSearchParams, index: ContentIndex): BenchmarkFilters {
  const topic = params.get('topic') ?? '';
  const version = params.get('v') ?? '';
  return {
    q: params.get('q') ?? '',
    topic: index.topics.some((t) => t.id === topic) ? topic : '',
    version: versionOptions(index.benchmarks).includes(version) ? version : '',
    charts: params.get('charts') === '1',
    saves: params.get('saves') === '1',
  };
}

/** Write filters back, omitting defaults, and leaving unrelated params alone. */
export function writeFilters(params: URLSearchParams, filters: BenchmarkFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
  set('q', filters.q.trim() ? filters.q : '');
  set('topic', filters.topic);
  set('v', filters.version);
  set('charts', filters.charts ? '1' : '');
  set('saves', filters.saves ? '1' : '');
  return next;
}

export function isFiltered(filters: BenchmarkFilters): boolean {
  return Boolean(
    filters.q.trim() || filters.topic || filters.version || filters.charts || filters.saves,
  );
}

/** Lower-cased text the free-text filter and the site search both match a benchmark against. */
export function benchmarkMatchText(b: BenchmarkEntry, topicLabel: string | undefined): string {
  return [b.title, b.question, b.finding, b.summary, topicLabel, b.factorioVersion, b.platform, b.cpu]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function matches(
  b: BenchmarkEntry,
  filters: BenchmarkFilters,
  topicLabel: (id: string) => string,
): boolean {
  if (filters.topic && b.topic !== filters.topic) return false;
  if (filters.version) {
    const v = b.factorioVersion;
    if (!v || !(v === filters.version || v.startsWith(`${filters.version}.`))) return false;
  }
  if (filters.charts && !b.timeseries) return false;
  if (filters.saves && b.saves.length === 0) return false;
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = benchmarkMatchText(b, b.topic ? topicLabel(b.topic) : undefined);
  return terms.every((t) => haystack.includes(t));
}
