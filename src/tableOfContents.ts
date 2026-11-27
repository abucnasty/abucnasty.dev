// The headings of a page's markdown and the ids they get, for the "On this page" list
// (src/components/TableOfContents.tsx). Pure (no React), so worker/tableOfContents.test.ts
// checks the ids against the ids rehype-slug renders.
//
// The ids follow rehype-slug (github-slugger): the rule of `headingId`, and a heading that repeats
// an earlier id gets "-1", "-2" and so on. Every heading from h1 to h6 takes part in the counting;
// the list shows h1 to h4.
import { headingId } from './wikiCore.ts';

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface HeadingOptions {
  /** The page is a wiki page: `[[Page|label]]` is read as the label it renders as. */
  wikiLinks?: boolean;
}

/** Deepest heading level the list shows. */
const LISTED_LEVEL = 4;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/;
const WIKI_LINK = /(!?)\[\[([^\]\n]+)\]\]/g;

/** What `[[...]]` renders as: its label, else the page name (`Page > Heading` with a heading). */
function wikiLinkLabel(inner: string): string {
  const [target, ...params] = inner.split('|').map((s) => s.trim());
  const hash = target.indexOf('#');
  const name = (hash === -1 ? target : target.slice(0, hash)).trim().replace(/\.md$/i, '');
  const heading = hash === -1 ? '' : target.slice(hash + 1).replace(/^#+/, '').trim();
  return params.join('|') || (name && heading ? `${name} > ${heading}` : name || heading);
}

/** The ids github-slugger gives a page's headings, one after the other. */
function sluggerFor() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = headingId(text);
    let id = base;
    while (seen.has(id)) {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      id = `${base}-${n}`;
    }
    seen.set(id, 0);
    return id;
  };
}

export function parseHeadings(markdown: string, options: HeadingOptions = {}): Heading[] {
  const headings: Heading[] = [];
  const slug = sluggerFor();
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (fence === undefined) {
      // A backtick fence's info string holds no backtick; otherwise the line is an inline code span.
      if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
        fence = f[1];
        continue;
      }
    } else {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && f[2].trim() === '') fence = undefined;
      continue;
    }
    const m = HEADING.exec(line);
    if (!m) continue;
    const level = m[1].length;
    let source = m[2].replace(/(^|[ \t])#+$/, '').trim();
    if (source === '') continue;
    if (options.wikiLinks) source = source.replace(WIKI_LINK, (all, embed: string, inner: string) => (embed ? all : wikiLinkLabel(inner)));
    // Links render as their label; the id is built from that, keeping "_" as rehype-slug does
    const linked = source.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    const id = slug(linked);
    if (level > LISTED_LEVEL) continue;
    // Strip inline markdown from display text
    const text = linked.replace(/[*_`]/g, '').trim();
    headings.push({ id, text, level });
  }
  return headings;
}
