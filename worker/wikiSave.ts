// Editing the wiki from the site: an editor's page source (GET /api/wiki/source) and saving a
// page with its new images (POST /api/wiki/save), committed to the vault's main branch as the
// wiki's GitHub App. wikiApi.ts checks who is asking (signed in, the editor role looked up live
// for a save) and the request's origin before anything here runs.
//
// A save, in order (each step can refuse; nothing is written until the checks pass):
//   1. WIKI_READ_ONLY = "true" refuses every save (the emergency stop; see README).
//   2. The request: one page under wiki/, at most MAX_PAGE_BYTES, images only as
//      wiki/<page folder>/_attachments/<name>.webp|.gif|.jpg, at most MAX_IMAGES of MAX_IMAGE_BYTES.
//   3. A slot from the editor's rate limit (rateLimit.ts).
//   4. main's head, its wiki/ tree: the page must still be the blob the editor started from
//      (else 409 "changed since you opened it"); a new page's title and address must be free.
//   5. Images: the bytes to the LFS bucket under their sha256 (as the LFS server stores them),
//      then their LFS pointers as blobs. The page as a blob.
//   6. A tree on main's tree, a commit (author: the editor's display name), then main moved to
//      it without force. If main moved meanwhile (a commit elsewhere) and the page did not
//      change, the commit is made again on the new head, up to MAX_ATTEMPTS times.
//   7. The edit announced in WIKI_ANNOUNCE_CHANNEL_ID (published pages only); a failed
//      announcement is logged and never fails the save.
// The vault's CI publishes the commit about a minute later.
//
// Everything outside Workers globals is passed in, so the flow is unit-tested under Node
// (wikiSave.test.ts).
import { announceEdit, type Fetch } from './discord.ts';
import { appConfigured, gitData, GitHubError, installationToken, type GitData, type GitHubAppConfig, type TokenCache, type TreeEntry } from './github.ts';
import type { Slot } from './rateLimit.ts';
import { wikiRoute, wikiSlug } from '../src/wikiCore.ts';
import {
  attachmentPath,
  byteLength,
  composePage,
  existingFolder,
  FrontmatterEditError,
  IMAGE_TYPES,
  isAttachmentName,
  isAttachmentPath,
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
  WIKI_ROOT,
  withDraft,
} from '../src/wikiSource.ts';

/** The vault: where wiki edits are committed. */
export const VAULT_REPO = 'abucnasty/factorio-vault';
export const VAULT_BRANCH = 'main';
/** The commit author's email: a fixed address that is no mailbox (the author name is the editor). */
export const COMMIT_EMAIL = 'wiki-editor@users.noreply.abucnasty.dev';
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PAGE_BYTES * 2 + MAX_IMAGES * MAX_IMAGE_BYTES + 64 * 1024;
export const MAX_ATTEMPTS = 3;

export interface SaveEnv {
  SITE_URL: string;
  WIKI_ANNOUNCE_CHANNEL_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  /** "true" stops all saves (set in the Cloudflare dashboard; see README). */
  WIKI_READ_ONLY?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  /** The LFS bucket (factorio-blueprints-lfs), objects at <oid[0:2]>/<oid[2:4]>/<oid>. */
  LFS_BUCKET?: {
    head(key: string): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream | null; size: number; httpMetadata?: { contentType?: string } } | null>;
    put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string }; sha256?: string }): Promise<unknown>;
  };
}

export interface SaveDeps {
  fetch: Fetch;
  now: () => number;
  /** Installation tokens, kept between requests. */
  tokens: TokenCache;
  /** Take a save slot for a Discord user id (rateLimit.ts). */
  takeSlot: (userId: string) => Promise<Slot>;
  /** Run work after the response (ctx.waitUntil); awaited inline when absent. */
  waitUntil?: (p: Promise<unknown>) => void;
  log: (message: string) => void;
  /** Pages just committed (paths): their cached history is out of date. */
  changed?: (paths: string[]) => void;
}

export interface Editor {
  id: string;
  displayName: string;
}

/** Whether saving is possible: on, stopped by WIKI_READ_ONLY, or not set up (no GitHub App or LFS bucket). */
export type EditingState = 'on' | 'read-only' | 'unavailable';

export function editingState(env: SaveEnv): EditingState {
  if (/^\s*true\s*$/i.test(env.WIKI_READ_ONLY ?? '')) return 'read-only';
  return appConfigured(appConfig(env)) && env.LFS_BUCKET ? 'on' : 'unavailable';
}

const appConfig = (env: SaveEnv): Partial<GitHubAppConfig> => ({
  appId: env.GITHUB_APP_ID?.trim(),
  installationId: env.GITHUB_APP_INSTALLATION_ID?.trim(),
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  repo: VAULT_REPO,
});

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers } });
export const failure = (status: number, error: string, message: string, extra: object = {}, headers: Record<string, string> = {}) =>
  json(status, { error, message, ...extra }, headers);

export const READ_ONLY_MESSAGE = 'Wiki editing is paused for now, so nothing was saved. Keep a copy of your text and try again later.';
const UNAVAILABLE_MESSAGE = "Wiki editing isn't set up on the site yet, so nothing was saved.";
export const GITHUB_DOWN = "Couldn't reach GitHub to save the page. Nothing was saved; try again in a minute.";

/** A refusal when saving is not possible, or null. */
export function editingRefusal(env: SaveEnv): Response | null {
  const state = editingState(env);
  if (state === 'read-only') return failure(503, 'read_only', READ_ONLY_MESSAGE);
  if (state === 'unavailable') return failure(503, 'not_configured', UNAVAILABLE_MESSAGE);
  return null;
}

export async function git(env: SaveEnv, deps: SaveDeps): Promise<GitData> {
  const c = appConfig(env) as GitHubAppConfig;
  const token = await installationToken(deps.fetch, c, deps.tokens, deps.now());
  return gitData(deps.fetch, c.repo, token);
}

/** main's head, its tree and every entry under wiki/ by full path. */
export async function readWiki(g: GitData): Promise<{ head: string; root: string; files: Map<string, TreeEntry> }> {
  const head = await g.headOf(VAULT_BRANCH);
  const root = await g.commitTree(head);
  const wiki = (await g.tree(root)).find((e) => e.path === WIKI_ROOT && e.type === 'tree');
  const files = new Map<string, TreeEntry>();
  if (wiki) for (const e of await g.tree(wiki.sha, true)) files.set(`${WIKI_ROOT}/${e.path}`, e);
  return { head, root, files };
}

/** Pages in a wiki listing, as the vault counts them. */
export function pagesIn(files: Map<string, TreeEntry>): string[] {
  return [...files.values()].filter((e) => e.type === 'blob' && isPagePath(`${WIKI_ROOT}/${e.path}`)).map((e) => `${WIKI_ROOT}/${e.path}`);
}

/** GET /api/wiki/source?slug=<slug>: a page's file on main, split, with its blob id. */
export async function readSource(env: SaveEnv, deps: SaveDeps, slug: string): Promise<Response> {
  if (editingState(env) === 'unavailable') return failure(503, 'not_configured', "Wiki editing isn't set up on the site yet.");
  try {
    const g = await git(env, deps);
    const { head, files } = await readWiki(g);
    const path = pagesIn(files).find((p) => wikiSlug(pageTitle(p)) === slug);
    if (!path) return failure(404, 'not_found', "This page isn't in the vault's main branch.");
    const entry = files.get(path)!;
    const text = new TextDecoder().decode(await g.blob(entry.sha));
    const { frontmatter, body } = splitPage(text.replace(/\r\n?/g, '\n'));
    return json(200, { path, title: pageTitle(path), folder: pageFolder(path), blob: entry.sha, head, frontmatter, body, draft: isDraft(frontmatter) });
  } catch (err) {
    deps.log(`wiki source: ${err instanceof Error ? err.message : String(err)}`);
    return failure(502, 'github_error', "Couldn't read the page from GitHub. Try again in a minute.");
  }
}

/** What the editor sends with a save (the `save` field of the form). */
export interface SaveRequest {
  /** An existing page's path (from the source), or absent for a new page. */
  path?: string;
  /** A new page. */
  create?: { title: string; folder: string };
  /** The blob the editor started from; null for a new page. */
  base: string | null;
  /** The frontmatter as loaded (the editor never changes it). */
  frontmatter: string;
  body: string;
  draft: boolean;
  summary?: string;
}

interface Image {
  name: string;
  path: string;
  bytes: Uint8Array;
  type: string;
  /** sha256 of the bytes: the LFS object id. */
  oid: string;
  /** The LFS pointer file committed in its place, and its git blob id. */
  pointer: string;
  pointerSha: string;
}

const SHA1 = /^[0-9a-f]{40}$/;

function sniff(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes));

/** A file's git blob id: sha1 of "blob <size>\0" and the bytes. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

/** An LFS pointer file, as git-lfs writes it. */
export function lfsPointer(oid: string, size: number): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
}

/** The LFS bucket's key of an object (as _tools/lfs-worker in the vault stores them). */
export const lfsKey = (oid: string) => `${oid.slice(0, 2)}/${oid.slice(2, 4)}/${oid}`;

export const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The last line of every site commit's message body: who saved it (the author name is the same). */
const SITE_LINE = / via abucnasty\.dev$/m;
/** Whether a commit was made by the site (its message says "Wiki edit by ... via abucnasty.dev"). */
export const isSiteCommit = (message: string) => SITE_LINE.test(message);

/**
 * A site commit's message: the subject, the line naming the editor, then any trailers (a last
 * paragraph of `Key: value` lines, as git reads trailers), e.g. `Wiki-Renamed-From: wiki/Old.md`.
 */
export function commitMessage(subject: string, editor: { author: string; id: string }, trailers: string[] = []): string {
  return `${subject}\n\nWiki edit by ${editor.author} (Discord ${editor.id}) via abucnasty.dev${trailers.length ? `\n\n${trailers.join('\n')}` : ''}`;
}

/** The commit author name for an editor: their display name on one line. */
export const authorName = (editor: Editor) => oneLine(editor.displayName) || 'Wiki editor';

/** Take one of the editor's write slots (rateLimit.ts): null when taken, else the refusal. */
export async function takeWriteSlot(deps: SaveDeps, editor: Editor, what = 'saved'): Promise<Response | null> {
  let slot: Slot;
  try {
    slot = await deps.takeSlot(editor.id);
  } catch (err) {
    deps.log(`wiki write: rate limiter: ${err instanceof Error ? err.message : String(err)}`);
    return failure(503, 'unavailable', "Couldn't do that right now. Nothing was changed; try again in a minute.");
  }
  if (slot.ok) return null;
  const minutes = Math.ceil(slot.retryAfter / 60);
  return failure(429, 'rate_limited', `You've ${what} a lot in the last few minutes. Wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, then try again; your text is still here.`, { retryAfter: slot.retryAfter }, { 'Retry-After': String(slot.retryAfter) });
}

/** POST /api/wiki/save, for an editor whose role was just checked. */
export async function save(env: SaveEnv, deps: SaveDeps, request: Request, editor: Editor): Promise<Response> {
  const refused = editingRefusal(env);
  if (refused) return refused;

  // --- The request -------------------------------------------------------------------------
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > MAX_REQUEST_BYTES) return failure(413, 'too_large', 'That save is too large. Pages can be up to 200 KB and images up to 5 MB each.');
  let form: FormData;
  let req: SaveRequest;
  try {
    form = await request.formData();
    req = JSON.parse(String(form.get('save') ?? '')) as SaveRequest;
  } catch {
    return failure(400, 'bad_request', "The save couldn't be read. Reload the page and try again.");
  }
  const bad = (message: string) => failure(400, 'bad_request', message);
  if (!req || typeof req !== 'object' || typeof req.body !== 'string' || typeof req.frontmatter !== 'string' || typeof req.draft !== 'boolean') {
    return bad("The save couldn't be read. Reload the page and try again.");
  }

  let path: string;
  const creating = req.create !== undefined && req.create !== null;
  if (creating) {
    const { title, folder } = req.create!;
    if (typeof title !== 'string' || typeof folder !== 'string' || req.path !== undefined || req.base !== null) return bad('A new page needs a title and a folder.');
    const problem = titleProblem(title);
    if (problem) return bad(problem);
    if (!isWikiFolder(tidyFolder(folder))) return bad("That folder can't hold wiki pages.");
    path = newPagePath(tidyFolder(folder), title.normalize('NFC'));
    if (!isPagePath(path)) return bad('Pages can only be saved under wiki/.');
    if (req.frontmatter !== '') return bad('A new page starts without frontmatter.');
  } else {
    if (typeof req.path !== 'string' || !isPagePath(req.path)) return bad('Pages can only be saved under wiki/.');
    if (typeof req.base !== 'string' || !SHA1.test(req.base)) return bad('The save is missing the version you started from. Reload the page and try again.');
    path = req.path;
  }
  // The frontmatter must be exactly a frontmatter block, and the body must not start one.
  if (req.frontmatter !== '' && splitPage(req.frontmatter).frontmatter !== req.frontmatter) return bad("The page's frontmatter couldn't be read. Reload the page and try again.");
  const body = req.body.replace(/\r\n?/g, '\n');
  if (req.frontmatter === '' && splitPage(body).frontmatter !== '') return bad("A page can't start with a --- line followed by another --- line: that would be read as frontmatter.");
  let frontmatter: string;
  try {
    frontmatter = withDraft(req.frontmatter, req.draft);
  } catch (err) {
    if (err instanceof FrontmatterEditError) return bad(err.message);
    throw err;
  }
  const text = composePage(frontmatter, body);
  const size = byteLength(text);
  if (size > MAX_PAGE_BYTES) return failure(413, 'too_large', `The page is ${Math.ceil(size / 1024)} KB; pages can be up to ${MAX_PAGE_BYTES / 1024} KB. Split it into several pages.`);
  const title = pageTitle(path);
  const summary = oneLine(typeof req.summary === 'string' ? req.summary : '').slice(0, MAX_SUMMARY) || `${creating ? 'Created' : 'Edited'} ${title}`;

  const images: Image[] = [];
  for (const [field, value] of form.entries()) {
    if (field === 'save') continue;
    if (!field.startsWith('image:') || typeof value === 'string') return bad("The save couldn't be read. Reload the page and try again.");
    const name = field.slice('image:'.length).normalize('NFC');
    if (!isAttachmentName(name)) return bad(`"${name}" isn't a name an image can have here.`);
    if (images.length >= MAX_IMAGES) return bad(`Add at most ${MAX_IMAGES} new images per save.`);
    if (value.size > MAX_IMAGE_BYTES) return failure(413, 'too_large', `${name} is larger than 5 MB.`);
    const bytes = new Uint8Array(await value.arrayBuffer());
    const ext = name.slice(name.lastIndexOf('.') + 1);
    if (sniff(bytes) !== ext) return bad(`${name} isn't a ${ext.toUpperCase()} image.`);
    const imagePath = attachmentPath(path, name);
    if (!isAttachmentPath(imagePath)) return bad(`"${name}" can't be stored beside this page.`);
    if (images.some((i) => i.path === imagePath)) return bad(`${name} was added twice.`);
    const oid = await sha256Hex(bytes);
    const pointer = lfsPointer(oid, bytes.length);
    const pointerSha = await gitBlobSha(new TextEncoder().encode(pointer));
    images.push({ name, path: imagePath, bytes, type: IMAGE_TYPES[ext], oid, pointer, pointerSha });
  }

  // --- The rate limit ----------------------------------------------------------------------
  const limited = await takeWriteSlot(deps, editor);
  if (limited) return limited;

  // --- GitHub ------------------------------------------------------------------------------
  const author = authorName(editor);
  const message = commitMessage(summary, { author, id: editor.id });
  const pageBytes = new TextEncoder().encode(text);
  try {
    const g = await git(env, deps);
    let pageBlob: string | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { head, root, files } = await readWiki(g);
      const current = files.get(path);
      if (creating) {
        // A folder that isn't there yet is made by this page; one that is takes the wiki's spelling.
        const typed = pageFolder(path);
        const folders = [...files].filter(([, e]) => e.type === 'tree').map(([p]) => p.slice(WIKI_ROOT.length + 1));
        const folder = existingFolder(typed, folders);
        const problem = pageFolderProblem(folder, folders);
        if (problem) return bad(problem);
        if (folder !== typed) {
          path = newPagePath(folder, title);
          for (const image of images) image.path = attachmentPath(path, image.name);
        }
        if (files.get(path)) return failure(409, 'exists', `A page called "${title}" was just created by someone else. Choose another title.`);
        const clash = titleClash(title, pagesIn(files).map(pageTitle));
        if (clash) return failure(409, 'exists', `There's already a page called "${clash}", which has the same title or address. Choose another title.`);
      } else if (!current) {
        return failure(409, 'gone', 'This page was renamed or deleted since you opened it. Copy your text, then open the page again.', { current: null });
      } else if (current.sha !== req.base) {
        return failure(409, 'conflict', 'This page changed since you opened it. Copy your text, open the page again and add your changes to the new version.', { current: { blob: current.sha } });
      }
      for (const image of images) {
        const there = files.get(image.path);
        // Images are named by their content (see the editor), so another file there is a real clash.
        if (there && there.sha !== image.pointerSha) {
          return failure(409, 'file_exists', `An image called ${image.name} is already beside this page. Remove yours, add it again and save.`);
        }
      }

      if (pageBlob === undefined) {
        pageBlob = await g.createBlob(pageBytes);
        if (!creating && pageBlob === req.base && images.length === 0) {
          return json(200, { ok: true, unchanged: true, path, slug: wikiSlug(title), title, blob: pageBlob, frontmatter, draft: req.draft });
        }
        for (const image of images) {
          const key = lfsKey(image.oid);
          if (!(await env.LFS_BUCKET!.head(key))) await env.LFS_BUCKET!.put(key, image.bytes, { httpMetadata: { contentType: image.type }, sha256: image.oid });
          await g.createBlob(new TextEncoder().encode(image.pointer));
        }
      }
      // An identical image already there needs no entry.
      const entries = [{ path, sha: pageBlob }, ...images.filter((i) => !files.has(i.path)).map((i) => ({ path: i.path, sha: i.pointerSha }))];
      const tree = await g.createTree(root, entries);
      const commit = await g.createCommit({ message, tree, parent: head, author: { name: author, email: COMMIT_EMAIL, date: new Date(deps.now()).toISOString() } });
      if (!(await g.updateRef(VAULT_BRANCH, commit))) {
        deps.log(`wiki save: ${VAULT_BRANCH} moved during the save (attempt ${attempt + 1}); trying again on the new head`);
        continue;
      }

      // --- Saved: announce ----------------------------------------------------------------
      deps.changed?.([path]);
      const slug = wikiSlug(title);
      if (!req.draft) {
        const announce = announceSave(env, deps, { title, url: `${env.SITE_URL.replace(/\/+$/, '')}${wikiRoute(slug)}`, summary, editor: author, created: creating });
        if (deps.waitUntil) deps.waitUntil(announce);
        else await announce;
      }
      return json(200, {
        ok: true,
        commit,
        path,
        slug,
        title,
        folder: pageFolder(path),
        blob: pageBlob,
        frontmatter,
        draft: req.draft,
        created: creating,
        images: images.map((i) => ({ path: i.path, oid: i.oid })),
      });
    }
    return failure(503, 'busy', 'The vault was changing too quickly to save. Nothing was saved; try again in a moment.');
  } catch (err) {
    deps.log(`wiki save: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof GitHubError || (err instanceof Error && err.name === 'TimeoutError')) return failure(502, 'github_error', GITHUB_DOWN);
    throw err;
  }
}

export async function announceSave(env: SaveEnv, deps: SaveDeps, edit: Parameters<typeof announceEdit>[1]['edit']): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN || !env.WIKI_ANNOUNCE_CHANNEL_ID) {
    deps.log('wiki announce: DISCORD_BOT_TOKEN or WIKI_ANNOUNCE_CHANNEL_ID is not set');
    return;
  }
  try {
    const r = await announceEdit(deps.fetch, { botToken: env.DISCORD_BOT_TOKEN, channelId: env.WIKI_ANNOUNCE_CHANNEL_ID, edit });
    if (!r.ok) deps.log(`wiki announce: ${r.reason}`);
  } catch (err) {
    deps.log(`wiki announce: ${err instanceof Error ? err.message : String(err)}`);
  }
}

