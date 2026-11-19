// Editing the wiki from the site: an editor's page source (GET /api/wiki/source) and saving a
// page with its new images (POST /api/wiki/save), committed to the vault's main branch as the
// wiki's GitHub App. wikiApi.ts checks who is asking (signed in, the editor role looked up live
// for a save) and the request's origin before anything here runs.
//
// A save, in order (each step can refuse; nothing is written until the checks pass):
//   1. WIKI_READ_ONLY = "true" refuses every save (the emergency stop; see README).
//   2. The request: one page under wiki/, at most MAX_PAGE_BYTES, images only as
//      wiki/<page folder>/_attachments/<name>.webp|.gif|.jpg, at most MAX_IMAGES of MAX_IMAGE_BYTES.
//   3. main's head, its wiki/ tree. A new page's title and address must be free. An existing page:
//      - not at its path any more: renamed meanwhile, the edit goes to the new path (and on as
//        below); deleted, 409 `gone` naming who deleted it (the editor offers "Save as a new page").
//      - no longer the blob the editor started from (another save, an Obsidian push, a restore):
//        the editor's body is merged with main's, three ways (wikiMerge.ts). Changes that don't
//        overlap are combined and saved, and the answer names the other edits (`merged`); ones
//        that do are a 409 `conflict` with base, theirs (who and when) and mine, which the editor
//        resolves side by side and saves against the new blob (so this runs again if the page
//        changed once more). The frontmatter is main's, with the Draft switch applied only when
//        the editor changed it.
//      Nothing changed: answered as `unchanged`, nothing written.
//   4. A slot from the editor's rate limit (rateLimit.ts), taken here, before the first write, so
//      an answer that writes nothing (a conflict, a page gone) does not use one up.
//   5. Images: the bytes to the LFS bucket under their sha256 (as the LFS server stores them),
//      then their LFS pointers as blobs. The page as a blob.
//   6. A tree on main's tree, a commit (author: the editor's display name), then main moved to
//      it without force. If main moved meanwhile (a commit elsewhere), step 3 runs again on the
//      new head (merging if the page changed), up to MAX_ATTEMPTS times.
//   7. The edit announced by buc-bot (BUC_BOT.announceWikiEdit; published pages only); a failed
//      announcement is logged and never fails the save.
// The vault's CI publishes the commit about a minute later.
//
// Everything outside Workers globals is passed in, so the flow is unit-tested under Node
// (wikiSave.test.ts).
import type { BucBotApi, WikiEdit } from './bucBot.ts';
import type { Fetch } from './discord.ts';
import { appConfigured, gitData, GitHubError, installationToken, type GitData, type GitHubAppConfig, type TokenCache, type TreeEntry } from './github.ts';
import type { Slot } from './rateLimit.ts';
import { mergeText, otherEdits, whereabouts, type OtherEdit } from './wikiMerge.ts';
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
  /** buc-bot, which announces edits in the server (bucBot.ts). */
  BUC_BOT?: Pick<BucBotApi, 'announceWikiEdit'>;
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
  /** main's head when the editor read the page (the source's `head`): names the edits made since. */
  head?: string;
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

  // --- GitHub ------------------------------------------------------------------------------
  // The rate limit is taken just before the first write: an answer that writes nothing (a
  // conflict, a page that is gone, nothing changed) does not use up a save.
  const author = authorName(editor);
  const message = commitMessage(summary, { author, id: editor.id });
  const openedAt = path;
  const baseHead = typeof req.head === 'string' && SHA1.test(req.head) ? req.head : null;
  let slotTaken = false;
  let imagesStored = false;
  /** The page blob made so far, and the text it holds. */
  let made = null as { text: string; sha: string } | null;
  /** The page as the editor opened it (fetched once, when the page changed meanwhile). */
  let baseText: string | null | undefined;
  let renamed = null as { from: string; by: OtherEdit } | null;
  try {
    const g = await git(env, deps);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { head, root, files } = await readWiki(g);
      let current = files.get(path);
      let pageText = text;
      let pageBody = body;
      let pageFrontmatter = frontmatter;
      let merged: { edits: OtherEdit[] } | null = null;
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
      } else {
        if (!current || current.type !== 'blob') {
          // Renamed (the edit goes to the new path) or deleted while the editor was editing.
          const where = await whereabouts(g, path, head, (p) => files.get(p)?.type === 'blob');
          if (where.kind === 'deleted') {
            const by = where.by;
            const who = by ? `${by.author} deleted this page` : 'This page was deleted';
            return failure(409, 'gone', `${who} while you were editing. Your text is still here: save it as a new page, or discard it.`, {
              current: null,
              deleted: by,
              path,
              title: pageTitle(path),
              folder: pageFolder(path),
            });
          }
          renamed = { from: renamed?.from ?? openedAt, by: where.by };
          path = where.path;
          current = files.get(path)!;
          for (const image of images) image.path = attachmentPath(path, image.name);
        }
        if (current.sha !== req.base) {
          // Changed meanwhile: merge the bodies (frontmatter from main, the Draft switch applied
          // only when the editor changed it).
          if (baseText === undefined) baseText = await blobText(g, req.base!);
          const theirs = splitPage(new TextDecoder().decode(await g.blob(current.sha)).replace(/\r\n?/g, '\n'));
          const base = baseText === null ? null : splitPage(baseText);
          const m = base === null ? { clean: false, text: body, conflicts: 1 } : mergeText(base.body, theirs.body, body);
          const edits = await otherEdits(g, { path, head, basePath: openedAt, baseHead }, deps.log);
          if (!m.clean) {
            const who = edits.length === 0 ? 'Someone else' : edits.length === 1 ? edits[0].author : `${edits.length} other edits`;
            return failure(
              409,
              'conflict',
              `${who} changed the same part of this page while you were editing. Choose what to keep, then save the combined version.`,
              {
                current: { blob: current.sha },
                path,
                title: pageTitle(path),
                folder: pageFolder(path),
                base: { blob: req.base, body: base?.body ?? null },
                theirs: { blob: current.sha, head, frontmatter: theirs.frontmatter, body: theirs.body, draft: isDraft(theirs.frontmatter), edits },
                mine: { body, combined: m.text },
                ...(renamed ? { renamedFrom: renamed.from } : {}),
              },
            );
          }
          const switched = req.draft !== isDraft(base!.frontmatter);
          try {
            pageFrontmatter = switched ? withDraft(theirs.frontmatter, req.draft) : theirs.frontmatter;
          } catch (err) {
            if (err instanceof FrontmatterEditError) return bad(err.message);
            throw err;
          }
          if (pageFrontmatter === '' && splitPage(m.text).frontmatter !== '') return bad("The combined page would start with a --- line followed by another --- line, which would be read as frontmatter. Change the first lines and save again.");
          pageBody = m.text;
          pageText = composePage(pageFrontmatter, pageBody);
          const size = byteLength(pageText);
          if (size > MAX_PAGE_BYTES) return failure(413, 'too_large', `Combined with the other edit, the page would be ${Math.ceil(size / 1024)} KB; pages can be up to ${MAX_PAGE_BYTES / 1024} KB.`);
          merged = { edits };
        }
      }
      for (const image of images) {
        const there = files.get(image.path);
        // Images are named by their content (see the editor), so another file there is a real clash.
        if (there && there.sha !== image.pointerSha) {
          return failure(409, 'file_exists', `An image called ${image.name} is already beside this page. Remove yours, add it again and save.`);
        }
      }

      const pageBytes = new TextEncoder().encode(pageText);
      const pageSha = made?.text === pageText ? made.sha : await gitBlobSha(pageBytes);
      const draft = isDraft(pageFrontmatter);
      const extra = { ...(merged ? { merged } : {}), ...(renamed ? { renamedFrom: renamed.from, renamedBy: renamed.by } : {}) };
      if (!creating && pageSha === current!.sha && images.length === 0) {
        return json(200, { ok: true, unchanged: true, path, slug: wikiSlug(pageTitle(path)), title: pageTitle(path), folder: pageFolder(path), blob: pageSha, frontmatter: pageFrontmatter, body: pageBody, draft, ...extra });
      }

      // --- The rate limit (once) ---------------------------------------------------------
      if (!slotTaken) {
        const limited = await takeWriteSlot(deps, editor);
        if (limited) return limited;
        slotTaken = true;
      }
      if (made?.text !== pageText) made = { text: pageText, sha: await g.createBlob(pageBytes) };
      if (!imagesStored) {
        for (const image of images) {
          const key = lfsKey(image.oid);
          if (!(await env.LFS_BUCKET!.head(key))) await env.LFS_BUCKET!.put(key, image.bytes, { httpMetadata: { contentType: image.type }, sha256: image.oid });
          await g.createBlob(new TextEncoder().encode(image.pointer));
        }
        imagesStored = true;
      }
      // An identical image already there needs no entry.
      const entries = [{ path, sha: made.sha }, ...images.filter((i) => !files.has(i.path)).map((i) => ({ path: i.path, sha: i.pointerSha }))];
      const tree = await g.createTree(root, entries);
      const commit = await g.createCommit({ message, tree, parent: head, author: { name: author, email: COMMIT_EMAIL, date: new Date(deps.now()).toISOString() } });
      if (!(await g.updateRef(VAULT_BRANCH, commit))) {
        deps.log(`wiki save: ${VAULT_BRANCH} moved during the save (attempt ${attempt + 1}); trying again on the new head`);
        continue;
      }

      // --- Saved: announce ----------------------------------------------------------------
      deps.changed?.(renamed ? [path, renamed.from] : [path]);
      const pageName = pageTitle(path);
      const slug = wikiSlug(pageName);
      if (!draft) {
        const announce = announceSave(env, deps, { title: pageName, url: `${env.SITE_URL.replace(/\/+$/, '')}${wikiRoute(slug)}`, summary, editor: author, created: creating });
        if (deps.waitUntil) deps.waitUntil(announce);
        else await announce;
      }
      return json(200, {
        ok: true,
        commit,
        path,
        slug,
        title: pageName,
        folder: pageFolder(path),
        blob: made.sha,
        frontmatter: pageFrontmatter,
        body: pageBody,
        draft,
        created: creating,
        images: images.map((i) => ({ path: i.path, oid: i.oid })),
        ...extra,
      });
    }
    return failure(503, 'busy', 'The vault was changing too quickly to save. Nothing was saved; try again in a moment.');
  } catch (err) {
    deps.log(`wiki save: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof GitHubError || (err instanceof Error && err.name === 'TimeoutError')) return failure(502, 'github_error', GITHUB_DOWN);
    throw err;
  }
}

/** A blob's text (LF line endings), or null when GitHub doesn't have it. */
async function blobText(g: GitData, sha: string): Promise<string | null> {
  try {
    return new TextDecoder().decode(await g.blob(sha)).replace(/\r\n?/g, '\n');
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 404 || err.status === 422)) return null;
    throw err;
  }
}

/** Announce an edit through buc-bot. Never throws: a failure is logged. */
export async function announceSave(env: SaveEnv, deps: SaveDeps, edit: WikiEdit): Promise<void> {
  if (!env.BUC_BOT) {
    deps.log('wiki announce: the BUC_BOT binding is missing');
    return;
  }
  try {
    const r = await env.BUC_BOT.announceWikiEdit(edit);
    if (!r.ok) deps.log(`wiki announce: ${r.reason}`);
  } catch (err) {
    deps.log(`wiki announce: ${err instanceof Error ? err.message : String(err)}`);
  }
}
