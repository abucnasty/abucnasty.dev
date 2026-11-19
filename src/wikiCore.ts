// The wiki index's types and pure helpers. Pages live in the vault (abucnasty/factorio-vault,
// wiki/**/<Title>.md); its CI publishes the published ones to the vault host: /wiki/index.json
// lists them with their headings, excerpt and files, each page's markdown (frontmatter and
// comments removed) is /wiki/<slug>.md and its images are under /wiki/files/.
// No React and no fetching, so the Worker imports this too (worker/previews.ts); the browser-side
// loading lives in wiki.ts, the rendering in wikiMarkdown.ts.
//
// The addressing and resolution rules repeat the vault's (_tools/plugin/src/core/wiki.ts there):
// keep the two in step.
import { VAULT_ORIGIN } from './catalogCore.ts';

/** The live wiki index. */
export const WIKI_INDEX_URL = `${VAULT_ORIGIN}/wiki/index.json`;
const WIKI_BASE = `${VAULT_ORIGIN}/wiki`;
/** The front page's slug (wiki/Home.md), shown at /wiki. */
export const WIKI_HOME = 'home';
/** The site's list of every page; no page may have this slug. */
export const WIKI_ALL_ROUTE = '/wiki/all';
/** Pages deleted in the last 90 days, for editors. */
export const WIKI_DELETED_ROUTE = '/wiki/deleted';

export interface WikiHeading {
  depth: number;
  text: string;
  /** The heading's element id on the page. */
  id: string;
}

export interface WikiPageMeta {
  title: string;
  slug: string;
  /** Folder under wiki/ ("" at the top), for grouping only. */
  folder: string;
  /** Former titles: their slugs redirect here. */
  aliases: string[];
  headings: WikiHeading[];
  excerpt: string;
  /** Slugs of the pages it links to. */
  links: string[];
  /** Paths of the files it uses (as WikiFile.path). */
  files: string[];
  blob: string;
  /** A draft: only signed-in wiki editors get it (see mergeWikiDrafts). */
  draft?: boolean;
}

export interface WikiFile {
  /** Vault path under wiki/, what links resolve against, e.g. `Guides/_attachments/logo.png`. */
  path: string;
  /** Served at /wiki/files/<published>. */
  published: string;
  type: string;
  size: number;
  /** `?v=<v>` makes the URL cacheable for good. */
  v: string;
  /** Where to load it instead (an image just saved in the editor, not yet published). */
  url?: string;
}

export interface WikiIndex {
  schema: number;
  generatedAt: string;
  /** By title, ignoring case. */
  pages: WikiPageMeta[];
  files: WikiFile[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Keep only pages and files with the fields the site relies on; ignore anything unknown. */
export function normaliseWikiIndex(raw: unknown): WikiIndex {
  const data = raw as Partial<WikiIndex> | null;
  if (!data || !Array.isArray(data.pages)) throw new Error('The wiki index has no pages list.');
  const pages = data.pages
    .filter((p): p is WikiPageMeta => !!p && typeof p.slug === 'string' && p.slug !== '' && typeof p.title === 'string')
    .map((p) => ({
      title: p.title,
      slug: p.slug,
      folder: typeof p.folder === 'string' ? p.folder : '',
      aliases: strings(p.aliases),
      headings: Array.isArray(p.headings)
        ? p.headings.filter((h): h is WikiHeading => !!h && typeof h.text === 'string' && typeof h.id === 'string' && typeof h.depth === 'number')
        : [],
      excerpt: typeof p.excerpt === 'string' ? p.excerpt : '',
      links: strings(p.links),
      files: strings(p.files),
      blob: typeof p.blob === 'string' ? p.blob : '',
    }))
    .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  const files = (Array.isArray(data.files) ? data.files : []).filter(
    (f): f is WikiFile => !!f && typeof f.path === 'string' && typeof f.published === 'string' && typeof f.v === 'string',
  );
  return { schema: data.schema ?? 0, generatedAt: data.generatedAt ?? '', pages, files };
}

/** A title's address: lowercased, every run of other than letters and digits one "-", trimmed. */
export function wikiSlug(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

const titleKey = (title: string) => title.normalize('NFC').toLowerCase();

/** Site route of a page: /wiki for the front page. */
export function wikiRoute(slug: string): string {
  return slug === WIKI_HOME ? '/wiki' : `/wiki/${encodeURIComponent(slug)}`;
}

/** A page's history (/wiki/home/history for the front page). */
export function wikiHistoryRoute(slug: string): string {
  return `/wiki/${encodeURIComponent(slug)}/history`;
}

/** The drafts index, from the site's Worker: editors only (worker/wikiApi.ts). */
export const WIKI_DRAFTS_INDEX_URL = '/api/wiki/drafts/index.json';

/** A draft's markdown, from the site's Worker: editors only. */
export function wikiDraftMarkdownUrl(slug: string): string {
  return `/api/wiki/drafts/${encodeURIComponent(slug)}.md`;
}

/**
 * The published index with the drafts added, marked `draft`, for an editor. A draft never
 * replaces a published page. A draft's former titles (a renamed draft) are kept: for an editor,
 * its old address and `[[Old Title]]` links reach it, after any published page's (as the vault's
 * CI resolves a draft's links). Files are the union: a draft's images are published on the vault
 * host like any other.
 */
export function mergeWikiDrafts(index: WikiIndex, drafts: WikiIndex): WikiIndex {
  const taken = new Set(index.pages.map((p) => p.slug));
  const extra = drafts.pages.filter((p) => !taken.has(p.slug)).map((p) => ({ ...p, draft: true }));
  const have = new Set(index.files.map((f) => f.path));
  return {
    ...index,
    pages: [...index.pages, ...extra].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())),
    files: [...index.files, ...drafts.files.filter((f) => !have.has(f.path))],
  };
}

/** A page's markdown on the vault host. */
export function wikiMarkdownUrl(slug: string): string {
  return `${WIKI_BASE}/${encodeURIComponent(slug)}.md`;
}

/** A file's URL on the vault host, cacheable for good. */
export function wikiFileUrl(file: WikiFile): string {
  if (file.url) return file.url;
  return `${WIKI_BASE}/files/${file.published.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(file.v)}`;
}

export function findWikiPage(index: WikiIndex, slug: string): WikiPageMeta | undefined {
  return index.pages.find((p) => p.slug === slug);
}

/** The first page `match` finds: published pages first, then drafts. */
const publishedFirst = (index: WikiIndex, match: (p: WikiPageMeta) => boolean) =>
  index.pages.find((p) => !p.draft && match(p)) ?? index.pages.find((p) => p.draft && match(p));

/** The page an address belongs to by one of its former titles (a published page's, then a draft's). */
export function findWikiAlias(index: WikiIndex, slug: string): WikiPageMeta | undefined {
  return publishedFirst(index, (p) => p.aliases.some((a) => wikiSlug(a) === slug));
}

/**
 * The page a link names, by title, then by former title (a renamed page's old `[[links]]`),
 * ignoring case; a path or ".md" may come with it.
 */
export function findWikiTarget(index: WikiIndex, target: string): WikiPageMeta | undefined {
  const name = target.slice(target.lastIndexOf('/') + 1);
  const key = titleKey(name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name);
  return index.pages.find((p) => titleKey(p.title) === key) ?? publishedFirst(index, (p) => p.aliases.some((a) => titleKey(a) === key));
}

/** The pages grouped by folder: the top first, then folders by name. */
export function wikiFolders(index: WikiIndex): Array<{ folder: string; pages: WikiPageMeta[] }> {
  const groups = new Map<string, WikiPageMeta[]>();
  for (const p of index.pages) groups.set(p.folder, [...(groups.get(p.folder) ?? []), p]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.toLowerCase().localeCompare(b.toLowerCase())))
    .map(([folder, pages]) => ({ folder, pages }));
}

/**
 * A heading's id as rehype-slug (github-slugger) makes it: lowercased, characters other than
 * letters, marks, digits, "_", "-" and spaces removed, spaces turned into "-". Not made unique.
 */
export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

/** The id of a page's heading a link names (`[[Page#Heading]]`), matched as its id would be. */
export function headingAnchor(page: Pick<WikiPageMeta, 'headings'> | undefined, heading: string): string {
  const want = headingId(heading);
  return page?.headings.find((h) => headingId(h.text) === want)?.id ?? want;
}

function normalizePath(parts: string[]): string | undefined {
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

/**
 * The file an image or file link on a page in `fromFolder` means, Obsidian style: a path relative
 * to the page, or to the vault; else by file name, preferring the page's own _attachments folder,
 * then its folder, then the shortest path anywhere in the wiki.
 */
export function resolveWikiFile(index: WikiIndex, target: string, fromFolder: string): WikiFile | undefined {
  const t = target.normalize('NFC').replace(/^\.\//, '');
  if (t === '') return undefined;
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  if (t.includes('/')) {
    const rel = normalizePath([...fromFolder.split('/'), ...t.split('/')]);
    if (rel !== undefined && byPath.has(rel)) return byPath.get(rel);
    const fromRoot = normalizePath(t.split('/'));
    if (fromRoot !== undefined) {
      if (byPath.has(fromRoot)) return byPath.get(fromRoot);
      if (fromRoot.startsWith('wiki/') && byPath.has(fromRoot.slice(5))) return byPath.get(fromRoot.slice(5));
    }
  }
  const name = t.slice(t.lastIndexOf('/') + 1);
  const join = (folder: string, n: string) => (folder === '' ? n : `${folder}/${n}`);
  for (const p of [join(join(fromFolder, '_attachments'), name), join(fromFolder, name)]) if (byPath.has(p)) return byPath.get(p);
  return index.files
    .filter((f) => f.path.slice(f.path.lastIndexOf('/') + 1) === name)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0];
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export type WikiHref =
  /** Leave the URL as written (external, site path, or in-page anchor). */
  | { kind: 'external'; url: string }
  /** Another page (or this one) on the site. */
  | { kind: 'page'; url: string; page: WikiPageMeta }
  /** A file the index lists. */
  | { kind: 'file'; url: string; file: WikiFile }
  /** A page or file that is not published (missing, or a draft). */
  | { kind: 'missing'; target: string };

/**
 * A markdown link's destination on a page, resolved: `Other%20Page.md#Some%20heading` (as
 * Obsidian writes them) opens that page at that heading, a relative path to a file the index
 * lists gets its vault URL, and anything with a scheme, `//`, `/` or `#` stays as written.
 */
export function resolveWikiHref(index: WikiIndex, page: WikiPageMeta, url: string): WikiHref {
  let u = url.trim();
  if (u.startsWith('<') && u.endsWith('>')) u = u.slice(1, -1);
  if (u === '' || u.startsWith('/') || SCHEME.test(u)) return { kind: 'external', url };
  if (u.startsWith('#')) {
    let heading = u.slice(1);
    try {
      heading = decodeURIComponent(heading);
    } catch {
      /* keep it */
    }
    return { kind: 'external', url: `#${headingAnchor(page, heading)}` };
  }
  let decoded = u;
  try {
    decoded = decodeURIComponent(u);
  } catch {
    /* keep it encoded */
  }
  const hash = decoded.indexOf('#');
  const path = hash === -1 ? decoded : decoded.slice(0, hash);
  const heading = hash === -1 ? '' : decoded.slice(hash + 1).trim();
  if (path.toLowerCase().endsWith('.md')) return pageHref(index, page, path, heading);
  const file = resolveWikiFile(index, path, page.folder);
  if (file) return { kind: 'file', url: wikiFileUrl(file), file };
  return { kind: 'missing', target: path };
}

/** A link to the page named `target` (a title, or a path), at `heading` if given. */
export function pageHref(index: WikiIndex, from: WikiPageMeta, target: string, heading = ''): WikiHref {
  const to = target === '' ? from : findWikiTarget(index, target);
  if (!to) return { kind: 'missing', target };
  const anchor = heading ? `#${headingAnchor(to, heading)}` : '';
  return { kind: 'page', url: to === from && anchor ? anchor : `${wikiRoute(to.slug)}${anchor}`, page: to };
}

/** A YouTube video and start time (seconds) from a watch or youtu.be URL; null for anything else. */
export function youtubeVideo(url: string): { id: string; start?: number } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const t = u.searchParams.get('t') ?? u.searchParams.get('start');
  const start = t ? seconds(t) : undefined;
  return start ? { id, start } : { id };
}

function seconds(t: string): number | undefined {
  if (/^\d+s?$/.test(t)) return Number.parseInt(t, 10) || undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || t === '') return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || undefined;
}

/** The privacy-enhanced embed URL of a video. */
export function youtubeEmbedUrl(video: { id: string; start?: number }): string {
  return `https://www.youtube-nocookie.com/embed/${video.id}${video.start ? `?start=${video.start}` : ''}`;
}
