// The blog index's types and pure helpers. Posts live in the vault
// (abucnasty/factorio-vault, blog/<slug>/README.md); its CI publishes the
// published ones to the vault host: /blog/index.json lists them, and each
// post's markdown (frontmatter removed) and files are under /blog/<slug>/.
// No React and no fetching, so the Worker imports this too (worker/previews.ts);
// the browser-side loading lives in blog.ts.
import { VAULT_ORIGIN } from './catalogCore.ts';

/** The live blog index. */
export const BLOG_INDEX_URL = `${VAULT_ORIGIN}/blog/index.json`;

export type PostStatus = 'public' | 'deprecated' | 'unlisted';

export interface BlogFile {
  /** Relative to the post folder, e.g. `screenshots/a.jpg`. */
  path: string;
  size: number;
  /** Git blob id: `?v=<blob>` makes the file's URL cacheable for good. */
  blob: string;
}

export interface BlogPostMeta {
  /** The vault folder name; the site route is /blog/<slug>. */
  slug: string;
  title: string;
  /** ISO date, e.g. "2026-05-11" (or a date and time). */
  date: string;
  description: string;
  tags: string[];
  /** Unlisted posts open by their address but appear in no list or search. */
  status: PostStatus;
  files: BlogFile[];
}

export interface BlogIndex {
  schema: number;
  generatedAt: string;
  /** Newest first. */
  posts: BlogPostMeta[];
}

const STATUSES: readonly string[] = ['public', 'deprecated', 'unlisted'];

/** Keep only posts with the fields the site relies on, newest first; ignore anything unknown. */
export function normaliseBlogIndex(raw: unknown): BlogIndex {
  const data = raw as Partial<BlogIndex> | null;
  if (!data || !Array.isArray(data.posts)) throw new Error('The blog index has no posts list.');
  const posts = data.posts
    .filter((p): p is BlogPostMeta => !!p && typeof p.slug === 'string' && typeof p.title === 'string' && typeof p.date === 'string')
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      date: p.date,
      description: typeof p.description === 'string' ? p.description : '',
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
      status: (STATUSES.includes(p.status) ? p.status : 'public') as PostStatus,
      files: Array.isArray(p.files) ? p.files.filter((f) => !!f && typeof f.path === 'string') : [],
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
  return { schema: data.schema ?? 0, generatedAt: data.generatedAt ?? '', posts };
}

/** False for an unlisted post: it opens by its address but appears in no list, count or search. */
export function isListedPost(post: BlogPostMeta): boolean {
  return post.status !== 'unlisted';
}

/** Posts shown in lists, the count and search. */
export function listedPosts(index: BlogIndex): BlogPostMeta[] {
  return index.posts.filter(isListedPost);
}

export function findPost(index: BlogIndex, slug: string): BlogPostMeta | undefined {
  return index.posts.find((p) => p.slug === slug);
}

/** Site route of a post. */
export function postRoute(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}

/** The folder a post's relative links resolve against, with a trailing slash. */
export function postBaseUrl(slug: string): string {
  return `${VAULT_ORIGIN}/blog/${encodeURIComponent(slug)}/`;
}

/** The post's markdown, frontmatter removed. */
export function postMarkdownUrl(slug: string): string {
  return `${postBaseUrl(slug)}index.md`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOG_BASE = `${VAULT_ORIGIN}/blog/`;

/**
 * A URL written in a post's markdown, as the page should use it. Absolute
 * URLs (with a scheme or `//`), in-page anchors and site paths (`/...`) stay
 * as written. A relative one is resolved against the post's folder in the
 * vault (`./screenshots/a.jpg` → https://vault.abucnasty.dev/blog/<slug>/screenshots/a.jpg),
 * with `?v=<blob>` when the index lists that file, so it can be cached for good.
 * A relative link to a post's note or folder (`../other-post/README.md`, as
 * Obsidian writes it) opens that post on this site instead.
 */
export function resolvePostUrl(url: string, post: Pick<BlogPostMeta, 'slug' | 'files'>): string {
  if (url === '' || url.startsWith('#') || url.startsWith('/') || SCHEME.test(url)) return url;
  let resolved: URL;
  try {
    resolved = new URL(url, postBaseUrl(post.slug));
  } catch {
    return url;
  }
  if (!resolved.href.startsWith(BLOG_BASE)) return resolved.href;
  const [slug, ...rest] = resolved.pathname.slice('/blog/'.length).split('/');
  const file = rest.join('/');
  if (file === '' || file === 'README.md' || file === 'index.md') {
    return `/blog/${slug}${resolved.search}${resolved.hash}`;
  }
  let path = file;
  try {
    path = decodeURIComponent(file);
  } catch {
    /* keep it encoded */
  }
  const listed = slug === encodeURIComponent(post.slug) ? post.files.find((f) => f.path === path) : undefined;
  if (listed && !resolved.searchParams.has('v')) resolved.searchParams.set('v', listed.blob);
  return resolved.href;
}
