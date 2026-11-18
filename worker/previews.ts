// Link-preview data per route: which page a URL is, and the title, description, URL and image its
// tags should carry. Pure (no Worker globals), so it is unit-tested under Node (previews.test.ts).
import { categoryName, folderName, imageUrl, type Catalog, type NodeKind } from '../src/catalogCore.ts';
import { findEntry, findNode, nodeLabel, shownImage } from '../src/pages/blueprints/model.ts';
import { wikiSlug } from '../src/wikiCore.ts';

const WIKI_HOME = 'home';
const WIKI_ALL = 'all';

export interface Preview {
  title: string;
  description: string;
  /** Site path (with query, if any) for canonical and og:url. */
  path: string;
  /** Absolute image URL; when missing, the page keeps index.html's image. */
  image?: string;
}

export type PreviewRoute =
  | { kind: 'blueprint'; path: string; entry: string | null }
  | { kind: 'benchmark'; slug: string }
  | { kind: 'blog'; slug: string }
  /** `slug` is "" for /wiki (the front page, "home") and "all" for the list of pages. */
  | { kind: 'wiki'; slug: string };

/** The fields of a benchmark (src/generated/index.json) a preview uses. */
export interface BenchmarkInfo {
  slug: string;
  title: string;
  summary?: string;
  question?: string;
  finding?: string;
}

/** The fields of a blog post (the vault's blog/index.json, see src/blogCore.ts) a preview uses. */
export interface PostInfo {
  slug: string;
  title: string;
  description?: string;
}

/** The fields of a wiki page (the vault's wiki/index.json, see src/wikiCore.ts) a preview uses. */
export interface WikiPageInfo {
  slug: string;
  title: string;
  excerpt?: string;
  aliases?: string[];
}

const DESCRIPTION_MAX = 200;

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '');

/** The page a URL shows, for the routes that get their own tags; null for every other URL. */
export function matchRoute(url: URL): PreviewRoute | null {
  const { pathname } = url;
  const bp = /^\/blueprints\/(.+)$/.exec(pathname);
  if (bp) {
    const path = decode(trimSlashes(bp[1]));
    if (!path) return null;
    const entry = trimSlashes(url.searchParams.get('entry') ?? '') || null;
    return { kind: 'blueprint', path, entry };
  }
  if (/^\/wiki\/?$/.test(pathname)) return { kind: 'wiki', slug: '' };
  const wiki = /^\/wiki\/([^/]+)\/?$/.exec(pathname);
  if (wiki) {
    const slug = decode(wiki[1]);
    return slug ? { kind: 'wiki', slug } : null;
  }
  const one = /^\/(benchmarks|blog)\/([^/]+)\/?$/.exec(pathname);
  if (one) {
    const slug = decode(one[2]);
    if (!slug) return null;
    return one[1] === 'blog' ? { kind: 'blog', slug } : { kind: 'benchmark', slug };
  }
  return null;
}

/** At most `max` characters, cut at a word, with an ellipsis when cut. */
export function clip(text: string, max = DESCRIPTION_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

const KIND_TEXT: Record<NodeKind, string> = {
  blueprint: 'Factorio blueprint',
  'blueprint-book': 'Factorio blueprint book',
  'upgrade-planner': 'Factorio upgrade planner',
  'deconstruction-planner': 'Factorio deconstruction planner',
};

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * A catalog entry by its path (or a former path), and optionally one slot of its book. An unknown
 * slot falls back to the whole entry; an unknown path gives null. Unlisted entries get previews.
 */
export function blueprintPreview(catalog: Catalog, path: string, nodePath: string | null): Preview | null {
  const found = findEntry(catalog, path);
  if (!found) return null;
  const { entry } = found;
  const node = nodePath ? (findNode(entry.nodes, nodePath)?.node ?? null) : null;

  const top = folderName(entry.path.split('/')[0]);
  const where = [top, categoryName(entry.path)].filter(Boolean).join(' / ');
  const by = entry.authors.length ? ` by ${entry.authors.join(', ')}` : '';
  const kind = KIND_TEXT[node?.kind ?? entry.blueprint.kind] ?? KIND_TEXT.blueprint;
  const own = node ? '' : entry.blueprint.description?.trim();
  const description = own || `${kind}${by}${node ? `, in ${entry.title}` : ''}. ${where}.`;

  const shown = shownImage(entry, node);
  // Slot paths are digits and slashes; written as the site's own links write them.
  const query = node ? `?entry=${encodePath(node.path)}` : '';
  return {
    title: node ? `${nodeLabel(node)}, in ${entry.title}` : entry.title,
    description: clip(description),
    path: `/blueprints/${encodePath(entry.path)}${query}`,
    // Percent-encoded (folder names may hold `%` or spaces); the site's <img> uses the raw path.
    ...(shown && { image: imageUrl(encodePath(entry.path), encodePath(shown.file)) }),
  };
}

export function benchmarkPreview(benchmarks: readonly BenchmarkInfo[], slug: string): Preview | null {
  const b = benchmarks.find((x) => x.slug === slug);
  if (!b) return null;
  const description = b.summary || b.question || b.finding || `A Factorio UPS benchmark: ${b.title}.`;
  return { title: b.title, description: clip(description), path: `/benchmarks/${encodeURIComponent(b.slug)}` };
}

/** A post by its slug; unlisted posts get previews too (they open by their address). */
export function blogPreview(posts: readonly PostInfo[], slug: string): Preview | null {
  const p = posts.find((x) => x.slug === slug);
  if (!p) return null;
  return { title: p.title, description: clip(p.description || p.title), path: `/blog/${encodeURIComponent(p.slug)}` };
}

/**
 * A wiki page by its slug ("" for /wiki, the front page "home"), or the list of every page; null
 * for any other slug, /wiki/home and former titles included (see wikiRedirect).
 */
export function wikiPreview(pages: readonly WikiPageInfo[], slug: string): Preview | null {
  if (slug === WIKI_ALL) {
    return { title: 'All wiki pages', description: `Every page of the Factorio benchmarking and UPS research wiki (${pages.length}).`, path: '/wiki/all' };
  }
  const p = pages.find((x) => x.slug === (slug === '' ? WIKI_HOME : slug));
  if (!p || slug === WIKI_HOME) return null;
  const home = p.slug === WIKI_HOME;
  return {
    title: home ? 'Wiki' : p.title,
    description: clip(p.excerpt || `${p.title}, a page of the Factorio benchmarking and UPS research wiki.`),
    path: home ? '/wiki' : `/wiki/${encodeURIComponent(p.slug)}`,
  };
}

/**
 * Where an address that is not a page goes: /wiki/home to /wiki, a former title (an alias) to its
 * page. Null when it is neither.
 */
export function wikiRedirect(pages: readonly WikiPageInfo[], slug: string): string | null {
  if (slug === WIKI_HOME) return pages.some((p) => p.slug === WIKI_HOME) ? '/wiki' : null;
  if (pages.some((p) => p.slug === slug)) return null;
  const to = pages.find((p) => (p.aliases ?? []).some((a) => wikiSlug(a) === slug));
  if (!to) return null;
  return to.slug === WIKI_HOME ? '/wiki' : `/wiki/${encodeURIComponent(to.slug)}`;
}

/** `path` on the site at `siteUrl` (a trailing slash on `siteUrl` is ignored). */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, '')}${path}`;
}
