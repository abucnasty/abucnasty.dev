// Changing wiki pages other than by saving their text: restoring an older version, renaming or
// moving a page, deleting one, and restoring a deleted one. wikiApi.ts checks the origin, the
// emergency stop and the editor role (looked up live) before anything here runs, as for a save.
//
// Each change, like a save (wikiSave.ts):
//   1. WIKI_READ_ONLY refuses it; the request is checked (paths only under wiki/, as pages).
//   2. A slot from the editor's rate limit (the same one saves use).
//   3. main's head and wiki/ tree: the page must still be the blob the editor saw (409 otherwise),
//      the new title and address must be free (titles, and other pages' former titles).
//   4. One commit on main (author: the editor's display name; the message names the editor and
//      ends with a trailer saying what happened, which the history reads: see wikiHistory.ts),
//      main moved to it without force, retried on a new head up to MAX_ATTEMPTS times.
//   5. Announced by buc-bot unless the page is a draft.
// History is never rewritten: a restore is a new commit.
//
//   POST /api/wiki/restore   { path, base, commit, from }  the text of the page as it was at `commit`
//                            (where it was `from`), with the page's current frontmatter (title,
//                            draft switch and former titles stay as they are now)
//   POST /api/wiki/rename    { path, base, title, folder } one commit: the file moved, the old title
//                            added to its `aliases:` (old addresses and [[links]] keep working),
//                            and any image it shows that would resolve differently from the new
//                            folder copied into that folder's _attachments (same blob)
//   POST /api/wiki/delete    { path, base }                 the file removed (its images stay)
//   POST /api/wiki/undelete  { path, commit, title? }       the page as it was before `commit`
//                            deleted it, at its old path (or under `title` in the same folder)
import type { GitData, TreeEntry } from './github.ts';
import { GitHubError } from './github.ts';
import { TRAILER } from './wikiHistory.ts';
import {
  announceSave,
  authorName,
  COMMIT_EMAIL,
  commitMessage,
  editingRefusal,
  failure,
  git,
  GITHUB_DOWN,
  json,
  MAX_ATTEMPTS,
  oneLine,
  pagesIn,
  readWiki,
  takeWriteSlot,
  VAULT_BRANCH,
  type Editor,
  type SaveDeps,
  type SaveEnv,
} from './wikiSave.ts';
import { resolveWikiFile, wikiRoute, wikiSlug, type WikiIndex } from '../src/wikiCore.ts';
import {
  byteLength,
  composePage,
  existingFolder,
  fileRefs,
  FrontmatterEditError,
  isDraft,
  isPagePath,
  isWikiFolder,
  MAX_PAGE_BYTES,
  MAX_SUMMARY,
  newPagePath,
  pageFolder,
  pageFolderProblem,
  pageTitle,
  splitPage,
  tidyFolder,
  titleClash,
  titleProblem,
  WIKI_ATTACHMENTS,
  WIKI_HOME_PATH,
  WIKI_ROOT,
  withAlias,
} from '../src/wikiSource.ts';

const SHA1 = /^[0-9a-f]{40}$/;
/** The largest request body these take (JSON, no page text). */
const MAX_BODY = 8 * 1024;

export type PageAction = 'restore' | 'rename' | 'delete' | 'undelete';

export interface PageDeps extends SaveDeps {
  /** Former titles of every page but `slug` (published and drafts), for clash checks. */
  aliases: (exceptSlug: string | null) => Promise<string[]>;
}

/** The wiki on main as one attempt sees it. */
interface Wiki {
  g: GitData;
  head: string;
  root: string;
  files: Map<string, TreeEntry>;
}

interface Planned {
  changes: Array<{ path: string; sha: string | null }>;
  subject: string;
  trailers: string[];
  /** Announced when set (never for a draft). */
  announce: { heading: string; title: string; slug: string; summary: string } | null;
  /** What the answer says besides `ok` and `commit`. */
  result: Record<string, unknown>;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
const bad = (message: string) => failure(400, 'bad_request', message);
const GONE = () => failure(409, 'gone', 'This page was renamed or deleted since you opened it. Reload the page and try again.', { current: null });
const CHANGED = (blob: string) => failure(409, 'conflict', 'This page changed since you opened it. Reload the page to see the new version, then try again.', { current: { blob } });
const tooLarge = (text: string) =>
  byteLength(text) > MAX_PAGE_BYTES ? failure(413, 'too_large', `The page would be ${Math.ceil(byteLength(text) / 1024)} KB; pages can be up to ${MAX_PAGE_BYTES / 1024} KB.`) : null;

/** The page at `path` must be the blob the editor saw. */
function current(w: Wiki, path: string, base: string): TreeEntry | Response {
  const entry = w.files.get(path);
  if (!entry || entry.type !== 'blob') return GONE();
  if (entry.sha !== base) return CHANGED(entry.sha);
  return entry;
}

const textOf = async (w: Wiki, entry: TreeEntry) => decode(await w.g.blob(entry.sha));

/** Every page title on main, and every other page's former titles. */
async function takenTitles(w: Wiki, deps: PageDeps, except: { path: string; slug: string } | null): Promise<string[]> {
  const titles = pagesIn(w.files)
    .filter((p) => p !== except?.path)
    .map(pageTitle);
  return [...titles, ...(await deps.aliases(except?.slug ?? null))];
}

const summaryOf = (raw: unknown) => oneLine(typeof raw === 'string' ? raw : '').slice(0, MAX_SUMMARY);

/** Read the JSON body (small), or null. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_BODY) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return null;
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POST /api/wiki/<action>, for an editor whose role was just checked. */
export async function changePage(env: SaveEnv, deps: PageDeps, request: Request, editor: Editor, action: PageAction): Promise<Response> {
  const refused = editingRefusal(env);
  if (refused) return refused;
  const req = await readBody(request);
  if (!req) return bad("The request couldn't be read. Reload the page and try again.");
  const plan = planFor(action, req, deps);
  if (plan instanceof Response) return plan;
  const limited = await takeWriteSlot(deps, editor, 'changed pages');
  if (limited) return limited;
  return commit(env, deps, editor, plan);
}

type Plan = (w: Wiki) => Promise<Planned | Response>;

/** Check the request and return what to do on each attempt, or the refusal. */
function planFor(action: PageAction, req: Record<string, unknown>, deps: PageDeps): Plan | Response {
  const path = req.path;
  if (typeof path !== 'string' || !isPagePath(path)) return bad('Pages are only under wiki/.');
  const summary = summaryOf(req.summary);
  switch (action) {
    case 'restore': {
      const { base, commit: at, from } = req;
      if (typeof base !== 'string' || !SHA1.test(base) || typeof at !== 'string' || !SHA1.test(at) || typeof from !== 'string' || !isPagePath(from)) {
        return bad('That version is missing from the request. Reload the page and try again.');
      }
      return (w) => restoreVersion(w, path, base, at, from, summary);
    }
    case 'rename': {
      const { base, title, folder } = req;
      if (typeof base !== 'string' || !SHA1.test(base) || typeof title !== 'string' || typeof folder !== 'string') return bad('A rename needs the page, a title and a folder.');
      if (path === WIKI_HOME_PATH) return bad("The front page (Home) can't be renamed or moved.");
      const problem = titleProblem(title);
      if (problem) return bad(problem);
      if (!isWikiFolder(tidyFolder(folder))) return bad("That folder can't hold wiki pages.");
      return (w) => rename(w, deps, path, base, title.normalize('NFC'), tidyFolder(folder), summary);
    }
    case 'delete': {
      const { base } = req;
      if (typeof base !== 'string' || !SHA1.test(base)) return bad('The request is missing the version you saw. Reload the page and try again.');
      if (path === WIKI_HOME_PATH) return bad("The front page (Home) can't be deleted.");
      return (w) => remove(w, path, base, summary);
    }
    case 'undelete': {
      const { commit: at, title } = req;
      if (typeof at !== 'string' || !SHA1.test(at)) return bad('The request is missing the deletion. Reload the page and try again.');
      if (title !== undefined && title !== null) {
        if (typeof title !== 'string') return bad('Give the page a title.');
        const problem = titleProblem(title);
        if (problem) return bad(problem);
      }
      const target = typeof title === 'string' ? newPagePath(pageFolder(path), title.normalize('NFC')) : path;
      if (!isPagePath(target)) return bad('Pages are only under wiki/.');
      return (w) => undelete(w, deps, path, at, target, summary);
    }
  }
}

/** Make the commit, retrying on a new head; announce; answer. */
async function commit(env: SaveEnv, deps: PageDeps, editor: Editor, plan: Plan): Promise<Response> {
  const author = authorName(editor);
  try {
    const g = await git(env, deps);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const w = { g, ...(await readWiki(g)) };
      const p = await plan(w);
      if (p instanceof Response) return p;
      if (p.changes.length === 0) return json(200, { ok: true, unchanged: true, ...p.result });
      const tree = await g.createTree(w.root, p.changes);
      const sha = await g.createCommit({
        message: commitMessage(p.subject, { author, id: editor.id }, p.trailers),
        tree,
        parent: w.head,
        author: { name: author, email: COMMIT_EMAIL, date: new Date(deps.now()).toISOString() },
      });
      if (!(await g.updateRef(VAULT_BRANCH, sha))) {
        deps.log(`wiki change: ${VAULT_BRANCH} moved (attempt ${attempt + 1}); trying again on the new head`);
        continue;
      }
      deps.changed?.(p.changes.map((c) => c.path));
      if (p.announce) {
        const a = p.announce;
        const announce = announceSave(env, deps, {
          heading: a.heading,
          title: a.title,
          url: `${env.SITE_URL.replace(/\/+$/, '')}${wikiRoute(a.slug)}`,
          summary: a.summary,
          editor: author,
          created: false,
        });
        if (deps.waitUntil) deps.waitUntil(announce);
        else await announce;
      }
      return json(200, { ok: true, commit: sha, ...p.result });
    }
    return failure(503, 'busy', 'The vault was changing too quickly. Nothing was changed; try again in a moment.');
  } catch (err) {
    deps.log(`wiki change: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof FrontmatterEditError) return bad(err.message);
    if (err instanceof GitHubError || (err instanceof Error && err.name === 'TimeoutError')) return failure(502, 'github_error', GITHUB_DOWN.replace('save the page', 'change the page'));
    throw err;
  }
}

/** What the page is after the change, for the editor's screen. */
function pageResult(path: string, frontmatter: string, blob: string, extra: object = {}) {
  const title = pageTitle(path);
  return { path, slug: wikiSlug(title), title, folder: pageFolder(path), blob, frontmatter, draft: isDraft(frontmatter), ...extra };
}

const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? iso);

async function restoreVersion(w: Wiki, path: string, base: string, at: string, from: string, summary: string): Promise<Planned | Response> {
  const entry = current(w, path, base);
  if (entry instanceof Response) return entry;
  const old = await w.g.fileAt(from, at);
  if (old === null) return failure(404, 'not_found', "That version isn't in the vault's history.");
  const info = await w.g.commit(at);
  const now = splitPage(await textOf(w, entry));
  const body = splitPage(decode(old)).body;
  const text = composePage(now.frontmatter, body);
  const big = tooLarge(text);
  if (big) return big;
  const title = pageTitle(path);
  const date = day(info.date);
  const result = pageResult(path, now.frontmatter, entry.sha, { body, restoredFrom: date });
  if (body === now.body) return { changes: [], subject: '', trailers: [], announce: null, result };
  const blob = await w.g.createBlob(new TextEncoder().encode(text));
  const heading = `Restored ${title} to the version from ${date}`;
  return {
    changes: [{ path, sha: blob }],
    subject: summary || heading,
    trailers: [`${TRAILER.restoredVersion}: ${at}`],
    announce: isDraft(now.frontmatter) ? null : { heading, title, slug: wikiSlug(title), summary: summary || heading },
    result: { ...result, blob },
  };
}

/** wiki/<folder>/<name> relative to wiki/. */
const rel = (path: string) => path.slice(WIKI_ROOT.length + 1);
const joinPath = (...parts: string[]) => parts.filter((p) => p !== '').join('/');

/**
 * The images (and other files) a moved page shows that would resolve to something else from its
 * new folder: copied into that folder's _attachments (the same blob, so no new bytes and no LFS
 * upload). Files resolve by name from anywhere in the wiki (wikiCore.ts resolveWikiFile, as the
 * vault does), so most need nothing; a copy is only needed when another file of the same name is
 * closer to the new folder. The old files stay: other pages may use them.
 */
function imageCopies(w: Wiki, body: string, fromFolder: string, toFolder: string): Array<{ path: string; sha: string }> | Response {
  if (fromFolder === toFolder) return [];
  const files = new Map<string, string>();
  for (const [p, e] of w.files) if (e.type === 'blob' && !isPagePath(p)) files.set(rel(p), e.sha);
  const copies = new Map<string, string>();
  const index = () => ({ files: [...files.keys(), ...copies.keys()].map((path) => ({ path, published: '', type: '', size: 0, v: '' })) }) as unknown as WikiIndex;
  const shaOf = (p: string) => copies.get(p) ?? files.get(p);
  for (const ref of fileRefs(body)) {
    const before = resolveWikiFile(index(), ref, fromFolder);
    if (!before) continue;
    const sha = shaOf(before.path)!;
    const after = resolveWikiFile(index(), ref, toFolder);
    if (after && shaOf(after.path) === sha) continue;
    const name = before.path.slice(before.path.lastIndexOf('/') + 1);
    const target = joinPath(toFolder, WIKI_ATTACHMENTS, name);
    const there = files.get(target);
    if (there !== undefined && there !== sha) {
      return failure(409, 'file_exists', `"${ref}" would show a different file named ${name} in the new folder. Rename one of the images in Obsidian first, or choose another folder.`);
    }
    if (there === undefined) copies.set(target, sha);
    const now = resolveWikiFile(index(), ref, toFolder);
    if (!now || shaOf(now.path) !== sha) {
      return failure(409, 'file_exists', `"${ref}" wouldn't show the same file from the new folder. Move the page in Obsidian instead, or choose another folder.`);
    }
  }
  return [...copies].map(([p, sha]) => ({ path: `${WIKI_ROOT}/${p}`, sha }));
}

async function rename(w: Wiki, deps: PageDeps, path: string, base: string, title: string, typedFolder: string, summary: string): Promise<Planned | Response> {
  const entry = current(w, path, base);
  if (entry instanceof Response) return entry;
  const folders = [...w.files].filter(([, e]) => e.type === 'tree').map(([p]) => rel(p));
  const folder = existingFolder(typedFolder, folders);
  const problem = pageFolderProblem(folder, folders);
  if (problem) return bad(problem);
  const target = newPagePath(folder, title);
  if (!isPagePath(target)) return bad('Pages are only under wiki/.');
  if (target === path) return bad('The page already has that title and folder.');
  const oldTitle = pageTitle(path);
  const clash = titleClash(title, await takenTitles(w, deps, { path, slug: wikiSlug(oldTitle) }));
  if (clash) return failure(409, 'exists', `There's already a page called "${clash}" (or with that address or former title). Choose another title.`);
  if (w.files.has(target)) return failure(409, 'exists', 'Something is already at that path in the vault. Choose another title.');

  const { frontmatter, body } = splitPage(await textOf(w, entry));
  const retitled = oldTitle.toLowerCase() !== title.toLowerCase();
  const fm = retitled ? withAlias(frontmatter, oldTitle) : frontmatter;
  const text = composePage(fm, body);
  const big = tooLarge(text);
  if (big) return big;
  const copies = imageCopies(w, body, pageFolder(path), folder);
  if (copies instanceof Response) return copies;
  const blob = fm === frontmatter ? entry.sha : await w.g.createBlob(new TextEncoder().encode(text));
  const moved = pageFolder(path) !== folder;
  const where = folder === '' ? 'the top level' : folder;
  const heading = retitled || oldTitle !== title ? `Renamed ${oldTitle} to ${title}` : `Moved ${title} to ${where}`;
  const subject = retitled && moved ? `${heading} (in ${where})` : heading;
  return {
    changes: [{ path, sha: null }, { path: target, sha: blob }, ...copies],
    subject: summary || subject,
    trailers: [`${TRAILER.renamedFrom}: ${path}`],
    // Folders only organise the vault: a move alone changes nothing a reader sees.
    announce: isDraft(fm) || !retitled ? null : { heading, title, slug: wikiSlug(title), summary: summary || heading },
    result: pageResult(target, fm, blob, { from: path, images: copies.map((c) => c.path) }),
  };
}

async function remove(w: Wiki, path: string, base: string, summary: string): Promise<Planned | Response> {
  const entry = current(w, path, base);
  if (entry instanceof Response) return entry;
  const { frontmatter } = splitPage(await textOf(w, entry));
  const title = pageTitle(path);
  const heading = `Deleted ${title}`;
  return {
    changes: [{ path, sha: null }],
    subject: summary || heading,
    trailers: [`${TRAILER.deleted}: ${path}`],
    announce: isDraft(frontmatter) ? null : { heading, title, slug: 'all', summary: summary || heading },
    result: { path, slug: wikiSlug(title), title, draft: isDraft(frontmatter) },
  };
}

async function undelete(w: Wiki, deps: PageDeps, path: string, at: string, target: string, summary: string): Promise<Planned | Response> {
  const title = pageTitle(target);
  if (w.files.has(target)) return failure(409, 'title_taken', `There's a page at ${target} again. Restore this one under a different title.`);
  const clash = titleClash(title, await takenTitles(w, deps, null));
  if (clash) return failure(409, 'title_taken', `There's already a page called "${clash}" (or with that address or former title). Restore this one under a different title.`, { clash });
  const info = await w.g.commit(at);
  const parent = info.parents[0];
  const old = parent ? await w.g.fileAt(path, parent) : null;
  if (old === null) return failure(404, 'not_found', "That page's last version isn't in the vault's history.");
  const text = decode(old);
  const big = tooLarge(text);
  if (big) return big;
  const blob = await w.g.createBlob(new TextEncoder().encode(text));
  const { frontmatter, body } = splitPage(text);
  const heading = target === path ? `Restored ${title}` : `Restored ${pageTitle(path)} as ${title}`;
  return {
    changes: [{ path: target, sha: blob }],
    subject: summary || heading,
    trailers: [`${TRAILER.restoredFrom}: ${path}`],
    announce: isDraft(frontmatter) ? null : { heading, title, slug: wikiSlug(title), summary: summary || heading },
    result: pageResult(target, frontmatter, blob, { body, from: path }),
  };
}
