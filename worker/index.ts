// The site's Worker. wrangler.jsonc's `run_worker_first` sends only /api/*, /blueprints/*,
// /benchmarks/<slug> and /blog/<slug> here; every other request is served from dist/ directly.
//
// - GET /api/latest-video: see latestVideo.ts.
// - A blueprint, benchmark or blog page: index.html with that page's title, description,
//   canonical, Open Graph and Twitter tags, so link previews and crawlers see the page.
//   Unknown pages, and anything that is not index.html, pass through untouched.
import { blogPosts } from '../src/blog/registry.ts';
import { CATALOG_URL, normaliseCatalog, type Catalog } from '../src/catalogCore.ts';
import type { ContentIndex } from '../src/content.ts';
import contentIndex from '../src/generated/index.json';
import { latestVideo } from './latestVideo.ts';
import { absoluteUrl, benchmarkPreview, blogPreview, blueprintPreview, matchRoute, type Preview, type PreviewRoute } from './previews.ts';

// Known at build time, so bundled into the Worker by wrangler: no extra file or request.
const benchmarks = (contentIndex as ContentIndex).benchmarks;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/latest-video') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
      return latestVideo(request, env, ctx);
    }

    const route = request.method === 'GET' || request.method === 'HEAD' ? matchRoute(url) : null;
    const preview = route ? await previewFor(route) : null;
    if (!preview) return env.ASSETS.fetch(request);

    // The SPA fallback: index.html for any path that is not a file. Fetched without the visitor's
    // conditional headers, since the rewritten page differs from the file its ETag names.
    const page = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: { Accept: 'text/html' } }));
    if (!page.ok || !page.headers.get('Content-Type')?.includes('text/html')) return page;
    return withTags(page, preview, env.SITE_URL);
  },
} satisfies ExportedHandler<Env>;

async function previewFor(route: PreviewRoute): Promise<Preview | null> {
  switch (route.kind) {
    case 'benchmark':
      return benchmarkPreview(benchmarks, route.slug);
    case 'blog':
      return blogPreview(blogPosts, route.slug);
    case 'blueprint': {
      const catalog = await loadCatalog();
      return catalog ? blueprintPreview(catalog, route.path, route.entry) : null;
    }
  }
}

// The catalog is served with max-age=60; keep it that long here and in Cloudflare's cache.
const CATALOG_TTL_SECONDS = 60;
let catalogMemo: { catalog: Catalog; at: number } | null = null;

async function loadCatalog(): Promise<Catalog | null> {
  if (catalogMemo && Date.now() - catalogMemo.at < CATALOG_TTL_SECONDS * 1000) return catalogMemo.catalog;
  try {
    const res = await fetch(CATALOG_URL, { cf: { cacheTtl: CATALOG_TTL_SECONDS, cacheEverything: true } });
    if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
    catalogMemo = { catalog: normaliseCatalog(await res.json()), at: Date.now() };
    return catalogMemo.catalog;
  } catch (err) {
    // The page still works without preview tags; an older catalog beats none.
    console.error('catalog:', err);
    return catalogMemo?.catalog ?? null;
  }
}

/**
 * An attribute value for setAttribute. It escapes `"` (so a value cannot leave the attribute) but
 * not `&`, which would make text such as `&lt;` in a title read as an entity; escape that here.
 * (Checked against workerd 1.20261110: `a & "b"` is written as `a & &quot;b&quot;`.)
 */
const attr = (value: string) => value.replaceAll('&', '&amp;');

/** The page with the preview's tags. Text goes in only through setInnerContent (escaped) and attr(). */
function withTags(page: Response, preview: Preview, siteUrl: string): Response {
  const url = absoluteUrl(siteUrl, preview.path);
  const content = (value: string): HTMLRewriterElementContentHandlers => ({
    element: (el) => {
      el.setAttribute('content', attr(value));
    },
  });
  let rewriter = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(`${preview.title} — abucnasty`) })
    .on('meta[name="description"]', content(preview.description))
    .on('link[rel="canonical"]', { element: (el) => void el.setAttribute('href', attr(url)) })
    .on('meta[property="og:title"]', content(preview.title))
    .on('meta[property="og:description"]', content(preview.description))
    .on('meta[property="og:url"]', content(url))
    .on('meta[name="twitter:title"]', content(preview.title))
    .on('meta[name="twitter:description"]', content(preview.description));
  if (preview.image) {
    rewriter = rewriter
      .on('meta[property="og:image"]', content(preview.image))
      .on('meta[name="twitter:image"]', content(preview.image))
      .on('meta[name="twitter:card"]', content('summary_large_image'));
  }
  const res = new Response(rewriter.transform(page).body, page);
  res.headers.delete('ETag');
  return res;
}
