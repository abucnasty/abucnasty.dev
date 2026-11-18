// How a wiki page's markdown becomes HTML: the plugins and options react-markdown runs with on a
// wiki page (src/components/WikiMarkdown.tsx). Pure (no React), so worker/wiki.test.ts renders
// with exactly these.
//
// - GFM (tables, task lists, strikethrough, autolinks, fenced code with a language class).
// - No raw HTML: it is dropped (skipHtml), and rehype-sanitize removes anything else executable,
//   including javascript: URLs. Only the wiki's own markup (callout boxes, the YouTube
//   placeholder, missing-page spans) is allowed through, by exact class names.
// - Obsidian: [[Page]], [[Page|label]], [[Page#Heading]], ![[image.png]], ![[image.png|400]],
//   relative markdown links to pages (`Other%20Page.md#Heading`) and images, `> [!type] Title`
//   callouts and `%% comments %%`. A link to a page or file that is not published shows as a
//   missing page; page embeds and anything unsupported stay plain text.
// - A paragraph that is only a YouTube link becomes an embedded player (youtube-nocookie.com).
// - Headings get github-slugger ids (rehype-slug), which the wiki index's heading ids match.
import type { BlockContent, Blockquote, Link, Paragraph, PhrasingContent, Root, RootContent, Text } from 'mdast';
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import {
  pageHref,
  resolveWikiFile,
  resolveWikiHref,
  wikiFileUrl,
  youtubeEmbedUrl,
  youtubeVideo,
  type WikiIndex,
  type WikiPageMeta,
} from './wikiCore.ts';

export interface WikiContext {
  index: WikiIndex;
  page: WikiPageMeta;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Remove a leading frontmatter block and Obsidian comments (`%%...%%`, inline or over several
 * lines) outside fenced and inline code. The vault's CI removes both before publishing; this
 * repeats it so a page never shows either.
 */
export function prepareWikiSource(markdown: string): string {
  const text = markdown.replace(/\r\n?/g, '\n').replace(/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, '');
  let open = false;
  let fence: string | undefined;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line);
    if (!open && fence === undefined && m && !(m[1][0] === '`' && line.slice(m[0].length).includes('`'))) {
      fence = m[1];
      out.push(line);
      continue;
    }
    if (fence !== undefined) {
      out.push(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.slice(m[0].length).trim() === '') fence = undefined;
      continue;
    }
    let kept = '';
    for (let i = 0; i < line.length; ) {
      if (!open && line[i] === '`') {
        const run = /^`+/.exec(line.slice(i))![0];
        const end = line.indexOf(run, i + run.length);
        const stop = end === -1 ? i + run.length : end + run.length;
        kept += line.slice(i, stop);
        i = stop;
      } else if (line.startsWith('%%', i)) {
        open = !open;
        i += 2;
      } else {
        if (!open) kept += line[i];
        i += 1;
      }
    }
    if (kept.trim() === '' && line.trim() !== '') continue;
    out.push(kept);
  }
  return out.join('\n');
}

// Obsidian's callout types and their aliases; anything else is styled as a note.
const CALLOUT_TYPES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};
export const CALLOUT_KINDS = [...new Set(Object.values(CALLOUT_TYPES))];
const CALLOUT = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

const textOf = (nodes: readonly RootContent[]): string =>
  nodes.map((n) => ('value' in n && typeof n.value === 'string' ? n.value : 'children' in n ? textOf(n.children as RootContent[]) : '')).join('');

/** `> [!warning] Title` → a callout box: div.callout.callout-warning with div.callout-title. Folding markers are ignored. */
function callout(node: Blockquote): void {
  const first = node.children[0];
  if (first?.type !== 'paragraph' || first.children[0]?.type !== 'text') return;
  const lead = first.children[0];
  const m = CALLOUT.exec(lead.value);
  if (!m) return;
  const written = m[1].toLowerCase();
  const kind = CALLOUT_TYPES[written] ?? 'note';
  // The title is the rest of the first line; what follows the line break is the body's first paragraph.
  const inline: PhrasingContent[] = [{ ...lead, value: lead.value.slice(m[0].length) }, ...first.children.slice(1)];
  const title: PhrasingContent[] = [];
  let body: PhrasingContent[] = [];
  for (let i = 0; i < inline.length; i += 1) {
    const n = inline[i];
    const nl = n.type === 'text' ? n.value.indexOf('\n') : n.type === 'break' ? 0 : -1;
    if (nl === -1) {
      title.push(n);
      continue;
    }
    if (n.type === 'text') {
      if (nl > 0) title.push({ type: 'text', value: n.value.slice(0, nl) });
      const rest = n.value.slice(nl + 1);
      body = [...(rest ? [{ type: 'text', value: rest } as Text] : []), ...inline.slice(i + 1)];
    } else body = inline.slice(i + 1);
    break;
  }
  const hasTitle = textOf(title).trim() !== '' || title.some((n) => n.type !== 'text');
  const titleBox: Paragraph = {
    type: 'paragraph',
    children: hasTitle ? title : [{ type: 'text', value: written[0].toUpperCase() + written.slice(1) }],
    data: { hName: 'div', hProperties: { className: ['callout-title'] } },
  };
  const rest: BlockContent[] = body.length > 0 && textOf(body).trim() !== '' ? [{ type: 'paragraph', children: body }] : [];
  node.children = [titleBox, ...rest, ...(node.children.slice(1) as BlockContent[])];
  node.data = { hName: 'div', hProperties: { className: ['callout', `callout-${kind}`] } };
}

/** A paragraph that is only a YouTube link (as GFM autolinks it) → div.youtube-embed, made a player after sanitising. */
function youtube(node: Paragraph): void {
  const only = node.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  if (only.length !== 1 || only[0].type !== 'link') return;
  const link = only[0];
  if (textOf(link.children).trim() !== link.url.trim()) return;
  const video = youtubeVideo(link.url);
  if (!video) return;
  node.data = {
    hName: 'div',
    hProperties: { className: ['youtube-embed'], dataYoutube: video.id, ...(video.start ? { dataStart: video.start } : {}) },
  };
}

const MISSING_TITLE = 'This page does not exist yet';
const missing = (children: PhrasingContent[], title = MISSING_TITLE): PhrasingContent => ({
  type: 'emphasis',
  children,
  data: { hName: 'span', hProperties: { className: ['wiki-missing'], title } },
});

const WIKI_LINK = /(!?)\[\[([^\]\n]+)\]\]/g;
const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i;
const SIZE = /^(\d+)(?:x(\d+))?$/;

/** `[[...]]` and `![[...]]` in a text node → links, images, missing spans or the text as written. */
function wikiLinks(value: string, ctx: WikiContext): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let last = 0;
  for (const m of value.matchAll(WIKI_LINK)) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    last = m.index + m[0].length;
    const [target, ...params] = m[2].split('|').map((s) => s.trim());
    const hash = target.indexOf('#');
    const name = (hash === -1 ? target : target.slice(0, hash)).trim();
    const heading = hash === -1 ? '' : target.slice(hash + 1).replace(/^#+/, '').trim();
    if (m[1]) {
      // An image embed; a page embed (or anything else) stays as written.
      const file = IMAGE.test(name) ? resolveWikiFile(ctx.index, name, ctx.page.folder) : undefined;
      if (!IMAGE.test(name)) out.push({ type: 'text', value: m[0] });
      else if (!file) out.push(missing([{ type: 'text', value: name }], 'This image is not in the wiki'));
      else {
        const size = params.map((p) => SIZE.exec(p)).find(Boolean);
        const alt = params.find((p) => !SIZE.test(p)) ?? '';
        out.push({
          type: 'image',
          url: wikiFileUrl(file),
          alt,
          data: size ? { hProperties: { width: Number(size[1]), ...(size[2] ? { height: Number(size[2]) } : {}) } } : undefined,
        });
      }
      continue;
    }
    const label = params.join('|') || (name && heading ? `${name.replace(/\.md$/i, '')} > ${heading}` : name.replace(/\.md$/i, '') || heading);
    const href = pageHref(ctx.index, ctx.page, name, heading);
    if (href.kind === 'page') out.push({ type: 'link', url: href.url, children: [{ type: 'text', value: label }] });
    else out.push(missing([{ type: 'text', value: label }]));
  }
  if (last === 0) return [{ type: 'text', value }];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function inline(nodes: PhrasingContent[], ctx: WikiContext): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const n of nodes) {
    if (n.type === 'text') out.push(...wikiLinks(n.value, ctx));
    else if (n.type === 'link') {
      const href = resolveWikiHref(ctx.index, ctx.page, n.url);
      if (href.kind === 'missing') out.push(missing(n.children));
      else out.push({ ...n, url: href.url } as Link);
    } else if (n.type === 'image') {
      const href = resolveWikiHref(ctx.index, ctx.page, n.url);
      if (href.kind === 'file' || (href.kind === 'external' && /^https?:\/\//i.test(href.url))) out.push({ ...n, url: href.url });
      else out.push(missing([{ type: 'text', value: n.alt || n.url }], 'This image is not in the wiki'));
    } else if ('children' in n && Array.isArray(n.children)) out.push({ ...n, children: inline(n.children as PhrasingContent[], ctx) } as PhrasingContent);
    else out.push(n);
  }
  return out;
}

function walk(node: Root | RootContent, ctx: WikiContext): void {
  if (node.type === 'blockquote') callout(node);
  if (node.type === 'paragraph') youtube(node);
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
    node.children = inline(node.children, ctx);
    return;
  }
  if ('children' in node) for (const c of node.children as RootContent[]) walk(c, ctx);
}

/** The remark plugin: Obsidian syntax, link and image resolution, callouts and YouTube paragraphs. */
export function remarkWiki(ctx: WikiContext) {
  return (tree: Root) => walk(tree, ctx);
}

/** GitHub's sanitising, plus the wiki's own classes and the YouTube placeholder's data. */
export const wikiSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  // remark-rehype already prefixes footnote ids with "user-content-"; raw HTML (the only other
  // source of ids and names) never gets this far, and heading ids are added after sanitising.
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^callout(?:-title|-[a-z]+)?$/, 'youtube-embed'], 'dataYoutube', 'dataStart'],
    span: [['className', 'wiki-missing']],
  },
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** After sanitising: each YouTube placeholder becomes a lazy, privacy-enhanced player. */
export function rehypeYoutube() {
  const visit = (node: HastRoot | Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const id = child.properties.dataYoutube;
      if (child.tagName === 'div' && typeof id === 'string' && VIDEO_ID.test(id)) {
        const start = Number(child.properties.dataStart) || undefined;
        child.properties = { className: ['youtube-embed'] };
        const player: ElementContent = {
          type: 'element',
          tagName: 'iframe',
          properties: {
            src: youtubeEmbedUrl({ id, start }),
            title: 'YouTube video player',
            loading: 'lazy',
            allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
            referrerPolicy: 'strict-origin-when-cross-origin',
            allowFullScreen: true,
          },
          children: [],
        };
        child.children = [player];
      } else visit(child);
    }
  };
  return (tree: HastRoot) => visit(tree);
}

/** react-markdown's options for a wiki page (components aside). */
export function wikiMarkdownOptions(ctx: WikiContext): Pick<Options, 'remarkPlugins' | 'rehypePlugins' | 'skipHtml'> {
  return {
    skipHtml: true,
    remarkPlugins: [remarkGfm, [remarkWiki, ctx]],
    rehypePlugins: [[rehypeSanitize, wikiSanitizeSchema], rehypeSlug, rehypeYoutube, [rehypeAutolinkHeadings, { behavior: 'wrap' }]],
  };
}
