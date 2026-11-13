/**
 * Pure helpers for pulling named sections ("The Question", "The Answer", ...) out of a
 * benchmark README. No I/O.
 */

const HEADING_RE = /^ {0,3}(#{1,4})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** @param {string} text */
function normalizeHeading(text) {
  return text.trim().replace(/:$/, '').trim().toLowerCase();
}

/**
 * Level 1-4 ATX headings outside fenced code blocks, as `{ index, level, text }`.
 * @param {string[]} lines
 */
function listHeadings(lines) {
  const headings = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const f = line.match(FENCE_RE);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = line.match(HEADING_RE);
    if (m) headings.push({ index: i, level: m[1].length, text: m[2] });
  }
  return headings;
}

/**
 * Find a section by heading text. A section runs from its heading to the next heading of
 * the same or a higher level (fewer or equal `#`), or the end of the file; deeper headings
 * belong to it.
 *
 * @param {string} markdown
 * @param {string[]} names  Heading texts to match, compared case-insensitively after
 *                          trimming whitespace and a trailing colon.
 * @returns {{ start: number, end: number, body: string } | null}
 *          Line indexes of the heading line and of the first line after the section;
 *          `body` is the section without its heading line, trimmed.
 */
export function findSection(markdown, names) {
  const wanted = new Set(names.map(normalizeHeading));
  const lines = markdown.split('\n');
  const headings = listHeadings(lines);
  const at = headings.findIndex((h) => wanted.has(normalizeHeading(h.text)));
  if (at < 0) return null;
  const head = headings[at];
  const next = headings.slice(at + 1).find((h) => h.level <= head.level);
  const end = next ? next.index : lines.length;
  return {
    start: head.index,
    end,
    body: lines.slice(head.index + 1, end).join('\n').trim(),
  };
}

/**
 * The markdown with that section (heading and body) removed, one blank line left in its place.
 *
 * @param {string} markdown
 * @param {{ start: number, end: number }} section
 * @returns {string}
 */
export function removeSection(markdown, section) {
  const lines = markdown.split('\n');
  const before = lines.slice(0, section.start);
  const after = lines.slice(section.end);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  if (before.length === 0) return after.join('\n');
  if (after.length === 0) return before.join('\n') + '\n';
  return [...before, '', ...after].join('\n');
}

const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+|$)/;

/** A text shorter than this is joined with the paragraph after it. */
const SHORT_TEXT = 30;

/** Markdown of one inline run to plain text. */
function toPlain(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // inline images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url)
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // [text][ref]
    .replace(/<[^>]*>/g, '') // HTML tags
    .replace(/`/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Blocks (runs of non-blank lines) of a body, leading blank lines skipped.
 * @param {string} body
 * @returns {string[][]}
 */
function toBlocks(body) {
  const blocks = [];
  let current = [];
  for (const line of body.replace(/\r/g, '').split('\n')) {
    if (line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/**
 * Plain text of one block, or null when the block is not prose: a table, an image, an HTML
 * block, a heading or a fenced code block (always), and a list (unless `allowList`, which
 * gives its first item). Prose that runs straight into a list keeps the lines before it.
 *
 * @param {string[]} block
 * @param {boolean} allowList
 * @returns {string | null}
 */
function blockText(block, allowList) {
  const first = block[0].trim();
  if (
    first.startsWith('|') ||
    first.startsWith('![') ||
    /^<[a-z/!]/i.test(first) ||
    first.startsWith('#') ||
    /^(`{3,}|~{3,})/.test(first)
  ) {
    return null;
  }
  let lines = block;
  if (LIST_ITEM_RE.test(block[0])) {
    if (!allowList) return null;
    // A first item with nested items under it is a group label, not a statement.
    const indent = (l) => l.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const following = block.findIndex((l, i) => i > 0 && LIST_ITEM_RE.test(l));
    if (following > 0 && indent(block[following]) > indent(block[0])) {
      return null;
    }
    const next = block.findIndex((l, i) => i > 0 && LIST_ITEM_RE.test(l));
    lines = next > 0 ? block.slice(0, next) : block;
    lines = [lines[0].replace(LIST_ITEM_RE, ''), ...lines.slice(1)];
  } else {
    const next = block.findIndex((l, i) => i > 0 && LIST_ITEM_RE.test(l));
    if (next > 0) lines = block.slice(0, next);
  }
  const text = toPlain(lines.join(' '));
  return text || null;
}

/**
 * First paragraph of a section body as plain text, or '' when the body does not start
 * with prose.
 *
 * - A table, an image, an HTML block, a heading or a fenced code block gives ''.
 * - A list gives '' unless `allowList`, then its first item, unless that item has nested
 *   items under it (a group label).
 * - Prose that runs straight into a list keeps only the lines before it.
 * - Text ending in a colon is a lead-in, not a statement: ''.
 * - Text under 30 characters is joined to the next block when that is prose too.
 * - With `trimToQuestion`, text containing a `?` is cut after its last one.
 * - Emphasis, code ticks, HTML tags and link targets are removed, whitespace is collapsed,
 *   the first letter is upper-cased and text over `maxLength` is cut at a space and ends in `…`.
 *
 * @param {string} body
 * @param {{ maxLength?: number, allowList?: boolean, trimToQuestion?: boolean }} [options]
 * @returns {string}
 */
export function plainFirstParagraph(body, { maxLength = 280, allowList = false, trimToQuestion = false } = {}) {
  const blocks = toBlocks(body);
  if (blocks.length === 0) return '';
  let text = blockText(blocks[0], allowList);
  if (!text) return '';
  if (text.length < SHORT_TEXT && blocks[1]) {
    const more = blockText(blocks[1], false);
    if (more) text = `${/[.!?…]$/.test(text) ? text : text + '.'} ${more}`;
  }
  if (text.endsWith(':')) return '';
  text = text[0].toUpperCase() + text.slice(1);

  if (trimToQuestion && text.includes('?')) text = text.slice(0, text.lastIndexOf('?') + 1);

  if (text.length > maxLength) {
    const cut = text.lastIndexOf(' ', maxLength);
    text = text.slice(0, cut > 0 ? cut : maxLength).replace(/[\s,;:]+$/, '') + '…';
  }
  return text;
}
