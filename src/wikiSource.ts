// A wiki page's source file as the vault stores it (wiki/<folders>/<Title>.md, frontmatter then
// markdown) and the rules the editor and the Worker's save share: where pages and their images may
// be written, what a new page may be called, and how the Draft switch changes the frontmatter.
// Pure (no React, no fetching), so the Worker imports it too (worker/wikiSave.ts).
//
// The vault's own rules are in _tools/plugin/src/core/wiki.ts and frontmatter.ts there; the
// frontmatter split and the page/attachment paths repeat them: keep the two in step.
import { wikiSlug } from './wikiCore.ts';

export const WIKI_ROOT = 'wiki';
export const WIKI_ATTACHMENTS = '_attachments';
/** Slugs the site uses itself (/wiki/all lists every page; /wiki/deleted, recently deleted pages). */
export const WIKI_RESERVED_SLUGS: readonly string[] = ['all', 'deleted'];
/** The front page: it can't be renamed or deleted. */
export const WIKI_HOME_PATH = `${WIKI_ROOT}/Home.md`;
/** The largest page the editor saves, frontmatter included (UTF-8 bytes). */
export const MAX_PAGE_BYTES = 200 * 1024;
/** Longest summary ("What did you change?") a save takes. */
export const MAX_SUMMARY = 200;
export const MAX_TITLE = 100;

/** The frontmatter as written (with the blank lines after it) and the rest, byte for byte. */
export interface PageParts {
  frontmatter: string;
  body: string;
}

const OPEN = /^---[ \t]*\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\n|$)/m;

/**
 * Split a page into its frontmatter and body as the vault does (frontmatter.ts there), with the
 * blank lines that follow the frontmatter counted in it, so the editor never sees or changes them.
 * Line endings are LF in the vault (.gitattributes).
 */
export function splitPage(text: string): PageParts {
  const open = OPEN.exec(text);
  if (open) {
    const rest = text.slice(open[0].length);
    const close = CLOSE.exec(rest);
    if (close) {
      let end = open[0].length + close.index + close[0].length;
      const blank = /^(?:[ \t]*\n)+/.exec(text.slice(end));
      if (blank) end += blank[0].length;
      return { frontmatter: text.slice(0, end), body: text.slice(end) };
    }
  }
  return { frontmatter: '', body: text };
}

/** The page file from its parts: the frontmatter exactly as given, then the body. */
export function composePage(frontmatter: string, body: string): string {
  return frontmatter + body;
}

/** The YAML between the fences, or null without frontmatter. */
function yamlOf(frontmatter: string): { yaml: string; start: number } | null {
  const open = OPEN.exec(frontmatter);
  if (!open) return null;
  const rest = frontmatter.slice(open[0].length);
  const close = CLOSE.exec(rest);
  if (!close) return null;
  return { yaml: rest.slice(0, close.index), start: open[0].length };
}

// YAML 1.2 core schema booleans, as the vault's YAML parser reads them.
const DRAFT_LINE = /^draft[ \t]*:[ \t]*(.*?)[ \t]*$/m;
const TRUE = /^(?:true|True|TRUE)(?:[ \t]+#.*)?$/;

/** Whether the frontmatter says `draft: true` (a top-level line, as Obsidian writes it). */
export function isDraft(frontmatter: string): boolean {
  const y = yamlOf(frontmatter);
  const m = y ? DRAFT_LINE.exec(y.yaml) : null;
  return !!m && TRUE.test(m[1]);
}

export class FrontmatterEditError extends Error {}

/**
 * The frontmatter with the draft switch set: unchanged when it already says so; otherwise the
 * `draft:` line is set to true, added first, or (to publish) removed, and nothing else changes. A
 * frontmatter left empty by that goes away. Throws FrontmatterEditError when the `draft:` key is
 * not a one-line value this can change safely.
 */
export function withDraft(frontmatter: string, draft: boolean): string {
  if (isDraft(frontmatter) === draft) return frontmatter;
  const y = yamlOf(frontmatter);
  if (!y) {
    if (!draft) return frontmatter;
    return `---\ndraft: true\n---\n${frontmatter === '' ? '' : frontmatter}`;
  }
  const m = DRAFT_LINE.exec(y.yaml);
  if (m) {
    const after = y.yaml.slice(m.index + m[0].length + 1);
    // A value continued on the next lines (`draft:` then an indented value) is not ours to change.
    if (m[1] === '' || /^[ \t]+\S/.test(after) || /^[|>[{'"]/.test(m[1])) {
      throw new FrontmatterEditError("This page's frontmatter has a draft value the editor can't change. Change it in Obsidian.");
    }
    const lineEnd = m.index + m[0].length + (y.yaml[m.index + m[0].length] === '\n' ? 1 : 0);
    const yaml = draft ? `${y.yaml.slice(0, m.index)}draft: true${y.yaml.slice(m.index + m[0].length)}` : y.yaml.slice(0, m.index) + y.yaml.slice(lineEnd);
    const rest = frontmatter.slice(y.start + y.yaml.length);
    if (!draft && yaml.trim() === '') {
      // Nothing left: drop the fences and the blank lines after them too.
      return '';
    }
    return frontmatter.slice(0, y.start) + yaml + rest;
  }
  // Not a draft and no draft line: add one at the top.
  return `${frontmatter.slice(0, y.start)}draft: true\n${frontmatter.slice(y.start)}`;
}

// The `aliases:` key (former titles), in the forms Obsidian and people write it: a flow list on
// one line, a block list below the key, one scalar, or nothing.
const ALIASES_LINE = /^aliases[ \t]*:[ \t]*(.*?)[ \t]*$/m;
const BLOCK_ITEM = /^([ \t]*)-(?:[ \t]+(.*?))?[ \t]*$/;
const YAML_KEYWORD = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;

/** A title as a YAML scalar: plain when that reads back as the same string, else double-quoted. */
export function yamlScalar(value: string): string {
  if (/^\p{L}[\p{L}\p{N} _().'&!+-]*$/u.test(value) && !/[ ]$/.test(value) && !YAML_KEYWORD.test(value)) return value;
  return JSON.stringify(value);
}

/** A YAML scalar as written, read back (plain, '...' or "..."); null when it isn't one this can read. */
function readScalar(raw: string): string | null {
  const t = raw.replace(/[ \t]+#.*$/, '').trim();
  if (t.startsWith('"')) {
    try {
      const v = JSON.parse(t) as unknown;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  if (t.startsWith("'")) return t.length >= 2 && t.endsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : null;
  if (/^[|>[\]{}&*!%@`]/.test(t)) return null;
  return t;
}

/** The items of a one-line flow list's inside (`A, "B, C"`), or null when it can't be read safely. */
function flowItems(inner: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (inner[i] === ' ' || inner[i] === '\t') i++;
    if (i >= inner.length) break;
    let end: number;
    const q = inner[i];
    if (q === '"' || q === "'") {
      let j = i + 1;
      while (j < inner.length) {
        if (q === '"' && inner[j] === '\\') j += 2;
        else if (q === "'" && inner[j] === "'" && inner[j + 1] === "'") j += 2;
        else if (inner[j] === q) break;
        else j++;
      }
      if (j >= inner.length) return null;
      const rest = inner.slice(j + 1);
      const comma = rest.search(/\S/);
      if (comma !== -1 && rest[comma] !== ',') return null;
      end = comma === -1 ? inner.length : j + 1 + comma;
    } else {
      end = inner.indexOf(',', i);
      if (end === -1) end = inner.length;
      if (/[[\]{}]/.test(inner.slice(i, end))) return null;
    }
    const v = readScalar(inner.slice(i, end));
    if (v === null) return null;
    out.push(v);
    i = end + 1;
  }
  return out;
}

const sameTitle = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

/**
 * The frontmatter with `alias` added to its `aliases:` (a former title, so old addresses and
 * `[[links]]` keep working after a rename): unchanged when it is there already (ignoring case),
 * the key added when there is none, and frontmatter made when the page has none. Only that key
 * changes. Throws FrontmatterEditError when `aliases:` is written in a way this can't change safely.
 */
export function withAlias(frontmatter: string, alias: string): string {
  const item = yamlScalar(alias.normalize('NFC'));
  const y = yamlOf(frontmatter);
  if (!y) {
    if (frontmatter !== '') throw new FrontmatterEditError("This page's frontmatter can't be read. Change it in Obsidian.");
    return `---\naliases:\n  - ${item}\n---\n\n`;
  }
  const cant = () => new FrontmatterEditError("This page's aliases are written in a way the site can't change. Rename it in Obsidian.");
  const m = ALIASES_LINE.exec(y.yaml);
  const at = (i: number) => y.start + i;
  const splice = (from: number, to: number, text: string) => frontmatter.slice(0, at(from)) + text + frontmatter.slice(at(to));
  if (!m) {
    const yaml = y.yaml === '' || y.yaml.endsWith('\n') ? y.yaml : `${y.yaml}\n`;
    return frontmatter.slice(0, y.start) + yaml + `aliases:\n  - ${item}\n` + frontmatter.slice(y.start + y.yaml.length);
  }
  const value = m[1].replace(/[ \t]+#.*$/, '');
  const lineEnd = m.index + m[0].length;
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw cant();
    const inner = value.slice(1, -1);
    const items = flowItems(inner);
    if (items === null) throw cant();
    if (items.some((a) => sameTitle(a, alias))) return frontmatter;
    const close = m.index + m[0].indexOf(value) + value.length - 1;
    return splice(close, close, `${inner.trim() === '' ? '' : ', '}${item}`);
  }
  if (value === '') {
    // A block list below the key (indented or not), or nothing.
    const lines = y.yaml.slice(lineEnd + 1).split('\n');
    let end = lineEnd + 1;
    let indent: string | null = null;
    const items: string[] = [];
    for (const line of lines) {
      const b = BLOCK_ITEM.exec(line);
      if (!b || (indent !== null && b[1] !== indent)) break;
      indent = b[1];
      const v = readScalar(b[2] ?? '');
      if (v === null) throw cant();
      items.push(v);
      end += line.length + 1;
    }
    if (indent === null) {
      if (lines.length > 0 && /^[ \t]+\S/.test(lines[0])) throw cant();
      return splice(m.index, lineEnd, `aliases:\n  - ${item}`);
    }
    if (items.some((a) => sameTitle(a, alias))) return frontmatter;
    return splice(end, end, `${indent}- ${item}\n`);
  }
  // One scalar: a block list of it and the new one.
  const one = readScalar(value);
  if (one === null) throw cant();
  if (sameTitle(one, alias)) return frontmatter;
  return splice(m.index, lineEnd, `aliases:\n  - ${value.trim()}\n  - ${item}`);
}

// ---------------------------------------------------------------------------------------------
// Paths

const segments = (path: string) => path.split('/');
const okSegment = (s: string) => s !== '' && !s.startsWith('.') && !/[\u0000-\u001f\u007f\\]/.test(s);

/** A folder under wiki/ ("" is the top): segments that are not hidden, not _attachments. */
export function isWikiFolder(folder: string): boolean {
  if (folder === '') return true;
  return folder.length <= 400 && segments(folder).every((s) => okSegment(s) && s !== WIKI_ATTACHMENTS);
}

/** A page file: wiki/<folder>/<Title>.md, as the vault reads pages (isWikiPagePath there). */
export function isPagePath(path: string): boolean {
  if (path.length > 512 || !path.startsWith(`${WIKI_ROOT}/`) || !path.endsWith('.md')) return false;
  const segs = segments(path);
  if (segs.length < 2 || !segs.every(okSegment)) return false;
  return !segs.slice(1, -1).includes(WIKI_ATTACHMENTS) && segs[segs.length - 1].length > 3;
}

/** The folder of a page path relative to wiki/ ("" at the top). */
export function pageFolder(path: string): string {
  const rel = path.slice(WIKI_ROOT.length + 1);
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
}

/** A page's title: its file name without ".md". */
export function pageTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (name.endsWith('.md') ? name.slice(0, -3) : name).normalize('NFC');
}

const join = (...parts: string[]) => parts.filter((p) => p !== '').join('/');

/** Where a new page goes. */
export function newPagePath(folder: string, title: string): string {
  return join(WIKI_ROOT, folder, `${title}.md`);
}

/** Where an image added to a page goes: the _attachments folder beside the page. */
export function attachmentPath(pagePath: string, name: string): string {
  return join(WIKI_ROOT, pageFolder(pagePath), WIKI_ATTACHMENTS, name);
}

/**
 * Image types the editor stores, by extension: WebP (what it converts to), GIF (kept as is, for
 * animations) and JPEG (only from a browser that cannot encode WebP; CI publishes it as WebP).
 */
export const IMAGE_TYPES: Record<string, string> = { webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg' };

/** An image file name the editor may write: letters, digits, spaces, "-", "_", "." and a .webp/.gif/.jpg extension. */
export function isAttachmentName(name: string): boolean {
  return (
    name.length <= 100 &&
    /^[\p{L}\p{N}][\p{L}\p{N} ._-]*\.(webp|gif|jpg)$/u.test(name) &&
    !name.includes('..') &&
    !/[ .]\.(webp|gif|jpg)$/.test(name)
  );
}

/** wiki/<folder>/_attachments/<name> for a valid folder and name. */
export function isAttachmentPath(path: string): boolean {
  const segs = segments(path);
  if (segs.length < 3 || segs[0] !== WIKI_ROOT || segs[segs.length - 2] !== WIKI_ATTACHMENTS) return false;
  return isWikiFolder(segs.slice(1, -2).join('/')) && isAttachmentName(segs[segs.length - 1]);
}

// ---------------------------------------------------------------------------------------------
// New folders

/** Longest folder path (under wiki/) a new page may be put in. */
export const MAX_FOLDER = 200;
/** Characters a folder name may not hold: those a title may not, but for the "/" between folders. */
const BAD_FOLDER = /[\\:*?"<>|#^[\]%\u0000-\u001f\u007f]/;

/** A folder as typed, tidied: NFC, each name trimmed, no "/" at either end ("" is the top level). */
export function tidyFolder(input: string): string {
  const t = input.normalize('NFC').trim().replace(/^\/+|\/+$/g, '');
  return t === '' ? '' : t.split('/').map((s) => s.trim()).join('/');
}

/**
 * What is wrong with a new folder (tidied) for a page, in one sentence, or null. Git has no empty
 * folders: a folder is made by the first page saved in it. The vault reads pages anywhere under
 * wiki/ but in hidden and _attachments folders; new ones also keep to names that work as file
 * names everywhere and never start with "_" (Obsidian's _attachments and the like).
 */
export function folderProblem(folder: string): string | null {
  if (folder === '') return null;
  if (folder.length > MAX_FOLDER) return `Keep the folder to ${MAX_FOLDER} characters.`;
  for (const name of folder.split('/')) {
    if (name === '') return "A folder name can't be empty: remove the extra /.";
    if (name.startsWith('.') || name.startsWith('_')) return `"${name}": a folder can't start with . or _ (those never hold pages).`;
    if (name.endsWith('.')) return `"${name}": a folder can't end with a dot.`;
    if (name.length > MAX_TITLE) return `Keep each folder name to ${MAX_TITLE} characters.`;
    if (BAD_FOLDER.test(name)) return 'A folder name can\'t contain \\ : * ? " < > | # ^ [ ] or %.';
  }
  return null;
}

/**
 * `folder` spelled as the wiki already spells it: each leading part that names an existing folder
 * ignoring case takes that folder's spelling (git folders are case-sensitive, so "guides" next to
 * "Guides" would be a second folder).
 */
export function existingFolder(folder: string, known: Iterable<string>): string {
  if (folder === '') return '';
  const spelled = new Map<string, string>();
  for (const path of withParents(known)) if (!spelled.has(path.toLowerCase())) spelled.set(path.toLowerCase(), path);
  const parts = folder.split('/');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const path = out === '' ? parts[i] : `${out}/${parts[i]}`;
    out = spelled.get(path.toLowerCase()) ?? path;
  }
  return out;
}

/** Every folder in `known` and the folders above them. */
function withParents(known: Iterable<string>): Set<string> {
  const all = new Set<string>();
  for (const k of known) {
    const parts = k.normalize('NFC').split('/');
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  return all;
}

/**
 * What is wrong with putting a new page in `folder` (tidied, and spelled as the wiki does: see
 * existingFolder), given the wiki's folders, or null. A folder there already is fine; the part
 * of it that is new must pass folderProblem.
 */
export function pageFolderProblem(folder: string, known: Iterable<string>): string | null {
  if (folder === '') return null;
  if (!isWikiFolder(folder)) return "That folder can't hold wiki pages.";
  const there = withParents(known);
  const parts = folder.split('/');
  let have = parts.length;
  while (have > 0 && !there.has(parts.slice(0, have).join('/'))) have--;
  if (have === parts.length) return null;
  if (folder.length > MAX_FOLDER) return `Keep the folder to ${MAX_FOLDER} characters.`;
  return folderProblem(parts.slice(have).join('/'));
}

// ---------------------------------------------------------------------------------------------
// New page titles

/** Characters a title may not hold: they break file names on some systems or links in Obsidian. */
const BAD_TITLE = /[\\/:*?"<>|#^[\]%\u0000-\u001f\u007f]/;

/** What is wrong with a new page's title (one sentence), or null. Uniqueness is checked separately. */
export function titleProblem(title: string): string | null {
  if (title.trim() === '') return 'Give the page a title.';
  if (title !== title.trim()) return "A title can't start or end with a space.";
  if (title.length > MAX_TITLE) return `Keep the title to ${MAX_TITLE} characters.`;
  if (BAD_TITLE.test(title)) return 'A title can\'t contain \\ / : * ? " < > | # ^ [ ] or %.';
  if (title.startsWith('.') || title.endsWith('.')) return "A title can't start or end with a dot.";
  const slug = wikiSlug(title);
  if (slug === '') return 'A title needs at least one letter or number.';
  if (WIKI_RESERVED_SLUGS.includes(slug)) return `"${title}" is taken by the site itself. Choose another title.`;
  return null;
}

/** A page another title would clash with: same title ignoring case, or same address. */
export function titleClash(title: string, existing: Iterable<string>): string | null {
  const key = title.normalize('NFC').toLowerCase();
  const slug = wikiSlug(title);
  for (const other of existing) {
    if (other.normalize('NFC').toLowerCase() === key || wikiSlug(other) === slug) return other;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Images a page uses

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The files a page's markdown points at, as written: `![[name]]` and `[[name.ext]]`, and markdown
 * images and links to a file (`![alt](path)`), outside fenced code. Pages (`.md`, or no
 * extension) and URLs are left out.
 */
export function fileRefs(markdown: string): string[] {
  const out = new Set<string>();
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const text = line.replace(/`[^`]*`/g, '');
    for (const m of text.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) out.add(m[1].split('|')[0].split('#')[0].trim());
    for (const m of text.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      let u = m[1];
      if (SCHEME.test(u) || u.startsWith('/') || u.startsWith('#')) continue;
      try {
        u = decodeURIComponent(u);
      } catch {
        /* keep it */
      }
      out.add(u.split('#')[0]);
    }
  }
  return [...out].filter((t) => /\.[A-Za-z0-9]{2,5}$/.test(t) && !/\.md$/i.test(t));
}

/** UTF-8 size of a string. */
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
