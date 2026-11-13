// Pure helpers over the catalog for the Blueprints page: the index tree, the
// filter, book nodes and the image a selection shows.
import { categoryName, folderName, isListed, type BookNode, type Catalog, type CatalogEntry, type NodeKind } from '../../catalog';

export interface IndexCategory {
  key: string;
  /** Empty for entries that sit directly in a top-level folder. */
  name: string;
  entries: CatalogEntry[];
}

export interface IndexGroup {
  key: string;
  name: string;
  categories: IndexCategory[];
}

const byText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/** Top-level folders ("Megabasing" first, then alphabetical), their categories and entries, alphabetical. */
export function buildIndex(entries: CatalogEntry[]): IndexGroup[] {
  const groups = new Map<string, Map<string, CatalogEntry[]>>();
  for (const e of entries) {
    const top = e.path.split('/')[0];
    const cat = e.path.split('/').slice(1, -1).join('/');
    const cats = groups.get(top) ?? new Map<string, CatalogEntry[]>();
    groups.set(top, cats);
    cats.set(cat, [...(cats.get(cat) ?? []), e]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'megabasing' ? -1 : b === 'megabasing' ? 1 : byText(a, b)))
    .map(([top, cats]) => ({
      key: top,
      name: folderName(top),
      categories: [...cats.entries()]
        .map(([cat, list]) => ({
          key: `${top}/${cat}`,
          name: cat ? categoryName(`${top}/${cat}/x`) : '',
          entries: [...list].sort((a, b) => byText(a.title, b.title) || byText(a.path, b.path)),
        }))
        .sort((a, b) => byText(a.name, b.name)),
    }));
}

/** Entries whose title, category name or authors contain every whitespace-separated term. */
export function filterEntries(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((e) => {
    const hay = [e.title, categoryName(e.path), ...e.authors].join('\n').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * What `/blueprints` shows on a wide screen before anything is picked: among listed builds that are
 * not deprecated and have a cover, the latest posted; ties go to the one with more entities.
 */
export function newestEntry(catalog: Catalog): CatalogEntry | undefined {
  const listed = catalog.blueprints.filter((e) => isListed(e) && !e.deprecated);
  const candidates = listed.filter((e) => e.cover);
  const pool = candidates.length ? candidates : listed;
  return [...pool].sort(
    (a, b) => (b.posted ?? '').localeCompare(a.posted ?? '') || b.blueprint.counts.entities - a.blueprint.counts.entities,
  )[0];
}

/** An entry by its path, or by a path it used to have. */
export function findEntry(catalog: Catalog, path: string): { entry: CatalogEntry; moved: boolean } | null {
  const exact = catalog.blueprints.find((e) => e.path === path);
  if (exact) return { entry: exact, moved: false };
  const moved = catalog.blueprints.find((e) => e.previous_paths?.includes(path));
  return moved ? { entry: moved, moved: true } : null;
}

export interface FlatNode {
  node: BookNode;
  depth: number;
}

/** Depth-first, in book order. */
export function flattenNodes(nodes: BookNode[] | undefined, depth = 0, out: FlatNode[] = []): FlatNode[] {
  for (const node of nodes ?? []) {
    out.push({ node, depth });
    flattenNodes(node.children, depth + 1, out);
  }
  return out;
}

/** A node by its slot path, with the books above it (outermost first). */
export function findNode(nodes: BookNode[] | undefined, path: string): { node: BookNode; ancestors: BookNode[] } | null {
  const walk = (list: BookNode[] | undefined, ancestors: BookNode[]): { node: BookNode; ancestors: BookNode[] } | null => {
    for (const n of list ?? []) {
      if (n.path === path) return { node: n, ancestors };
      if (path.startsWith(`${n.path}/`)) {
        const hit = walk(n.children, [...ancestors, n]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(nodes, []);
}

const KIND_NAMES: Record<NodeKind, string> = {
  blueprint: 'Blueprint',
  'blueprint-book': 'Book',
  'upgrade-planner': 'Upgrade planner',
  'deconstruction-planner': 'Deconstruction planner',
};

/** The node's label, or "Blueprint (slot 3)" when it has none. */
export function nodeLabel(node: BookNode): string {
  const label = node.label?.trim();
  return label || `${KIND_NAMES[node.kind] ?? 'Blueprint'} (slot ${node.slot})`;
}

function firstRender(nodes: BookNode[] | undefined): string | undefined {
  for (const n of nodes ?? []) {
    if (n.render) return n.render;
    const below = firstRender(n.children);
    if (below) return below;
  }
  return undefined;
}

export interface ShownImage {
  file: string;
  width?: number;
  height?: number;
}

/**
 * The render a selection shows: a node's own render, else (for a nested book) the first one found
 * beneath it; the whole entry shows its cover, else the first render in the book.
 */
export function shownImage(entry: CatalogEntry, node: BookNode | null): ShownImage | null {
  const file = node ? (node.render ?? (node.kind === 'blueprint-book' ? firstRender(node.children) : undefined)) : (entry.cover ?? firstRender(entry.nodes));
  if (!file) return null;
  const meta = entry.renders.find((r) => r.file === file);
  return { file, width: meta?.width, height: meta?.height };
}

/** True for an entry that is a book with a contents tree. */
export function isBook(entry: CatalogEntry): boolean {
  return entry.blueprint.kind === 'blueprint-book' && (entry.nodes?.length ?? 0) > 0;
}

/** "15, in 6 books", or "2" when the book holds no nested books. */
export function blueprintsFact(counts: CatalogEntry['blueprint']['counts']): string {
  const n = counts.blueprints.toLocaleString('en-US');
  if (!counts.books) return n;
  return `${n}, in ${counts.books.toLocaleString('en-US')} ${counts.books === 1 ? 'book' : 'books'}`;
}

/** The date part of an ISO date-time. */
export function datePart(iso: string): string {
  return iso.slice(0, 10);
}
