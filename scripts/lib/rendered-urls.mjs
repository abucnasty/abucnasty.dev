/**
 * Every URL a piece of published markdown puts on the page, found by rendering it the way the
 * site does (react-markdown with remark-gfm and rehype-raw, as in src/components/MarkdownRenderer.tsx)
 * and reading the attributes of the resulting HTML. Rendering, rather than matching the markdown
 * with patterns, covers every way of writing a link or image: inline, reference-style, autolinks,
 * and raw HTML.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

/** Attributes that make the browser load, or link to, a URL (React writes `srcSet`). */
const URL_ATTR_RE = /\s(src|href|srcset|poster|data)="([^"]*)"/gi;

/** @param {string} s */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * @param {string} markdown
 * @returns {{ tag: string, attr: string, url: string }[]} every URL-valued attribute, `srcset` split into its URLs
 */
export function renderedUrls(markdown) {
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeRaw] }, markdown),
  );
  const out = [];
  for (const tagMatch of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = tagMatch[1].toLowerCase();
    for (const [, attrName, value] of tagMatch[2].matchAll(URL_ATTR_RE)) {
      const attr = attrName.toLowerCase();
      const decoded = decodeEntities(value);
      const urls = attr === 'srcset' ? decoded.split(',').map((c) => c.trim().split(/\s+/)[0]) : [decoded];
      for (const url of urls) if (url) out.push({ tag, attr, url });
    }
  }
  return out;
}

/**
 * Whether a URL is fetched from, or links into, this site (as opposed to another origin, a
 * `mailto:`/`data:` URL, or an in-page `#fragment`).
 *
 * @param {string} url
 */
export function isSiteUrl(url) {
  return !(/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#'));
}
