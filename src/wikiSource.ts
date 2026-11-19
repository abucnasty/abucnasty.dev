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
/** Slugs the site uses itself (/wiki/all lists every page). */
export const WIKI_RESERVED_SLUGS: readonly string[] = ['all'];
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

/** UTF-8 size of a string. */
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
