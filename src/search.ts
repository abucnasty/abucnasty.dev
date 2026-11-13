// Site search: the entries and the matching, with no React. The save index is
// NOT imported here (it is its own chunk) and blueprints come from the live
// catalog; the dialog loads both on demand and hands them to `saveEntries` and
// `blueprintEntries`.
import index from './generated/index.json';
import type { ContentIndex } from './content';
import { blueprintRoute, categoryName, folderName, isListed, type Catalog } from './catalog';
import { blogPosts } from './blog/registry';
import { toolSections, tutorials } from './data/tools';
import { benchmarkMatchText } from './benchmarkFilters';
import { saveFolderRoute, searchSaves, type SaveTree } from './saves';

export type SearchKind = 'benchmark' | 'blueprint' | 'tool' | 'post' | 'save';

export interface SearchEntry {
  kind: SearchKind;
  title: string;
  /** Muted second line. */
  detail?: string;
  /** A site route, or an absolute URL when `external` is set. */
  to: string;
  external?: boolean;
  /** Lower-cased text the query is matched against. */
  haystack: string;
}

/** Group order and the heading each group is shown under. */
export const SEARCH_GROUPS: Array<{ kind: SearchKind; label: string }> = [
  { kind: 'benchmark', label: 'Benchmarks' },
  { kind: 'blueprint', label: 'Blueprints' },
  { kind: 'tool', label: 'Tools' },
  { kind: 'post', label: 'Blog posts' },
  { kind: 'save', label: 'Save files' },
];

const content = index as ContentIndex;

const hay = (...parts: Array<string | undefined>) =>
  parts
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

/** Everything except save files and blueprints, built once from data already in the main bundle. */
export function staticEntries(): SearchEntry[] {
  const topicLabels = new Map(content.topics.map((t) => [t.id, t.label]));
  const entries: SearchEntry[] = [];

  // Newest first; undated benchmarks last, in index order.
  const benchmarks = content.benchmarks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (y.b.date ?? '').localeCompare(x.b.date ?? '') || x.i - y.i)
    .map(({ b }) => b);
  for (const b of benchmarks) {
    entries.push({
      kind: 'benchmark',
      title: b.title,
      detail: b.question ?? b.finding ?? b.summary,
      to: `/benchmarks/${b.slug}`,
      haystack: benchmarkMatchText(b, b.topic ? topicLabels.get(b.topic) : undefined),
    });
  }

  for (const section of toolSections) {
    for (const t of section.entries) {
      entries.push({
        kind: 'tool',
        title: t.name,
        detail: t.description,
        to: '/tools',
        haystack: hay(t.name, t.description, t.author),
      });
    }
  }
  for (const t of tutorials) {
    entries.push({ kind: 'tool', title: t.label, to: '/tools', haystack: hay(t.label) });
  }

  for (const p of blogPosts) {
    entries.push({
      kind: 'post',
      title: p.title,
      detail: p.description,
      to: `/blog/${p.slug}`,
      haystack: hay(p.title, p.description, ...(p.tags ?? [])),
    });
  }
  return entries;
}

/** Listed blueprints that are not deprecated, from the live catalog. */
export function blueprintEntries(catalog: Catalog): SearchEntry[] {
  return catalog.blueprints
    .filter((e) => isListed(e) && !e.deprecated)
    .map((e) => {
      const category = categoryName(e.path);
      const group = folderName(e.path.split('/')[0]);
      return {
        kind: 'blueprint' as const,
        title: e.title,
        detail: category || group,
        to: blueprintRoute(e.path),
        haystack: hay(e.title, category, group, ...e.authors),
      };
    });
}

/** Save files matching the query, from the lazily loaded save tree. */
export function saveEntries(tree: SaveTree, query: string): SearchEntry[] {
  return searchSaves(tree, query).map((f) => ({
    kind: 'save',
    title: f.name,
    detail: f.dir,
    to: saveFolderRoute(f.dir),
    haystack: f.haystack,
  }));
}

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Entries matching every whitespace-separated term, best first. */
export function search(entries: SearchEntry[], query: string): SearchEntry[] {
  const ts = terms(query);
  if (ts.length === 0) return [];
  const ranked: Array<{ e: SearchEntry; rank: number; i: number }> = [];
  entries.forEach((e, i) => {
    if (!ts.every((t) => e.haystack.includes(t))) return;
    const title = e.title.toLowerCase();
    const rank = title.startsWith(ts[0]) ? 0 : ts.every((t) => title.includes(t)) ? 1 : 2;
    ranked.push({ e, rank, i });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.e);
}
