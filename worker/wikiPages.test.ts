// Page history, restoring versions, renaming, deleting and restoring deleted pages (wikiHistory.ts,
// wikiPages.ts) through the API (wikiApi.ts), against an in-memory vault that answers GitHub's
// calls as GitHub does: the critical flows only.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { signSession, SESSION_COOKIE } from './session.ts';
import type { WikiEdit } from './bucBot.ts';
import { fakeBucBot } from './fakeBucBot.ts';
import { createWikiApi, type WikiEnv } from './wikiApi.ts';
import { pageHistory, recentlyDeleted, type HistoryGitHub } from './wikiHistory.ts';
import { COMMIT_EMAIL } from './wikiSave.ts';
import type { CommitFile, ListedCommit } from './github.ts';
import { findWikiAlias, findWikiTarget, mergeWikiDrafts, normaliseWikiIndex, type WikiIndex } from '../src/wikiCore.ts';
import { splitPage, withAlias } from '../src/wikiSource.ts';

const SITE = 'https://abucnasty.dev';
const SECRET = 's'.repeat(48);
const GUILD = '1381752136450441266';
const USER = '80351110224678912';
const T0 = Date.UTC(2026, 10, 18, 12);
const REPO = 'https://api.github.com/repos/abucnasty/factorio-vault';
const DAY = 24 * 3600 * 1000;
const SITE_LINE = (subject: string, trailers = '') => `${subject}\n\nWiki edit by Buc the Editor (Discord ${USER}) via abucnasty.dev${trailers ? `\n\n${trailers}` : ''}`;

const { privateKey: PKCS8 } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

// ---------------------------------------------------------------------------------------------
// An in-memory vault: commits on main, each a full file list; GitHub's calls answered from it.

interface Commit {
  sha: string;
  parents: string[];
  files: Map<string, string>; // path -> blob sha
  message: string;
  author: string;
  date: string;
}

function vault() {
  const blobs = new Map<string, string>();
  const commits = new Map<string, Commit>();
  const trees = new Map<string, Map<string, string>>();
  let n = 0;
  const blob = (text: string) => {
    const known = [...blobs].find(([, t]) => t === text);
    if (known) return known[0];
    const sha = `b${String(++n).padStart(39, '0')}`;
    blobs.set(sha, text);
    return sha;
  };
  const shaOf = (prefix: string) => `${prefix}${String(++n).padStart(40 - prefix.length, '0')}`;
  let head = '';
  let clock = T0 - 200 * DAY;
  /** A commit on main (as the owner's git push would make it): `changes` maps paths to text, or null to delete. */
  const push = (message: string, changes: Record<string, string | null>, author = 'abucnasty', at?: number) => {
    const files = new Map(head ? commits.get(head)!.files : []);
    for (const [p, text] of Object.entries(changes)) {
      if (text === null) files.delete(p);
      else files.set(p, blob(text));
    }
    clock = at ?? clock + DAY;
    const c: Commit = { sha: shaOf('c'), parents: head ? [head] : [], files, message, author, date: new Date(clock).toISOString() };
    commits.set(c.sha, c);
    head = c.sha;
    return c.sha;
  };
  /** Files changed by a commit, as GitHub lists them (an unchanged blob that moved is "renamed"). */
  const changed = (c: Commit): CommitFile[] => {
    const before = c.parents[0] ? commits.get(c.parents[0])!.files : new Map<string, string>();
    const removed = [...before].filter(([p]) => !c.files.has(p));
    const out: CommitFile[] = [];
    for (const [p, sha] of c.files) {
      if (before.get(p) === sha) continue;
      if (before.has(p)) out.push({ filename: p, status: 'modified' });
      else {
        const moved = removed.findIndex(([, s]) => s === sha);
        if (moved !== -1) out.push({ filename: p, status: 'renamed', previous_filename: removed.splice(moved, 1)[0][0] });
        else out.push({ filename: p, status: 'added' });
      }
    }
    for (const [p] of removed) out.push({ filename: p, status: 'removed' });
    return out;
  };
  const touches = (c: Commit, path: string) => changed(c).some((f) => f.filename === path || f.previous_filename === path || f.filename.startsWith(`${path}/`) || (f.previous_filename ?? '').startsWith(`${path}/`));
  const listed = (c: Commit): ListedCommit => ({ sha: c.sha, parents: c.parents, message: c.message, author: c.author, date: c.date });
  const treeOf = (files: Map<string, string>) => {
    const id = shaOf('t');
    trees.set(id, files);
    return id;
  };
  const treeIds = new Map<string, string>();
  const rootTree = (c: Commit) => {
    if (!treeIds.has(c.sha)) treeIds.set(c.sha, treeOf(c.files));
    return treeIds.get(c.sha)!;
  };
  const calls: Array<{ method: string; path: string; body?: any }> = [];

  async function github(url: string, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const path = url.slice(REPO.length);
    calls.push({ method, path, body });
    const json = (b: unknown, status = 200) => Response.json(b, { status });
    const u = new URL(url);
    if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
    let m = /^\/git\/commits\/(\w+)$/.exec(path);
    if (m && method === 'GET') {
      const c = commits.get(m[1])!;
      return json({ tree: { sha: rootTree(c) }, parents: c.parents.map((sha) => ({ sha })), message: c.message, author: { name: c.author, email: 'owner@example.invalid', date: c.date } });
    }
    m = /^\/git\/trees\/(\w+)/.exec(path);
    if (m && method === 'GET') {
      const id = m[1];
      if (id.startsWith('w')) {
        const files = trees.get(`t${id.slice(1)}`)!;
        const entries = new Map<string, { path: string; type: string; mode: string; sha: string }>();
        for (const [p, sha] of files) {
          if (!p.startsWith('wiki/')) continue;
          const rel = p.slice(5);
          const parts = rel.split('/');
          for (let i = 1; i < parts.length; i++) entries.set(parts.slice(0, i).join('/'), { path: parts.slice(0, i).join('/'), type: 'tree', mode: '040000', sha: 'f'.repeat(40) });
          entries.set(rel, { path: rel, type: 'blob', mode: '100644', sha });
        }
        return json({ tree: [...entries.values()] });
      }
      return json({ tree: [{ path: 'wiki', type: 'tree', mode: '040000', sha: `w${id.slice(1)}` }] });
    }
    m = /^\/git\/blobs\/(\w+)$/.exec(path);
    if (m && method === 'GET') return json({ content: Buffer.from(blobs.get(m[1]) ?? '').toString('base64'), encoding: 'base64' });
    if (path === '/git/blobs' && method === 'POST') {
      const text = Buffer.from(body.content, 'base64').toString();
      const known = [...blobs].find(([, t]) => t === text);
      return json({ sha: known ? known[0] : blob(text) }, 201);
    }
    if (path === '/git/trees' && method === 'POST') {
      const files = new Map(trees.get(body.base_tree)!);
      for (const e of body.tree) {
        if (e.sha === null) files.delete(e.path);
        else files.set(e.path, e.sha);
      }
      return json({ sha: treeOf(files) }, 201);
    }
    if (path === '/git/commits' && method === 'POST') {
      const c: Commit = { sha: shaOf('c'), parents: body.parents, files: trees.get(body.tree)!, message: body.message, author: body.author.name, date: body.author.date };
      commits.set(c.sha, c);
      treeIds.set(c.sha, body.tree);
      return json({ sha: c.sha }, 201);
    }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      if (commits.get(body.sha)!.parents[0] !== head) return json({ message: 'Update is not a fast forward' }, 422);
      head = body.sha;
      return json({ object: { sha: head } });
    }
    if (u.pathname.endsWith('/commits') && method === 'GET') {
      const q = u.searchParams;
      const out: ListedCommit[] = [];
      for (let c: Commit | undefined = commits.get(q.get('sha') === 'main' ? head : q.get('sha')!); c; c = c.parents[0] ? commits.get(c.parents[0]) : undefined) {
        if (q.get('since') && c.date < q.get('since')!) break;
        if (q.get('path') && !touches(c, q.get('path')!)) continue;
        out.push(listed(c));
      }
      const per = Number(q.get('per_page')), page = Number(q.get('page') ?? '1');
      return json(
        out.slice((page - 1) * per, page * per).map((c) => ({ sha: c.sha, parents: c.parents.map((sha) => ({ sha })), commit: { message: c.message, author: { name: c.author, email: 'owner@example.invalid', date: c.date } } })),
      );
    }
    m = /^\/commits\/(\w+)$/.exec(u.pathname.slice(new URL(REPO).pathname.length));
    if (m) return json({ sha: m[1], files: changed(commits.get(m[1])!) });
    if (u.pathname.includes('/contents/')) {
      const p = decodeURIComponent(u.pathname.slice(u.pathname.indexOf('/contents/') + 10));
      const c = commits.get(u.searchParams.get('ref')!);
      const sha = c?.files.get(p);
      assert.equal((init.headers as Record<string, string>).Accept, 'application/vnd.github.raw+json');
      return sha ? new Response(blobs.get(sha)) : json({ message: 'Not Found' }, 404);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }

  const gh: HistoryGitHub & { fileCalls: number } = {
    fileCalls: 0,
    commits: async (q) => {
      const res = await github(`${REPO}/commits?${new URLSearchParams({ sha: q.sha, per_page: String(q.perPage), ...(q.path ? { path: q.path } : {}), ...(q.since ? { since: q.since } : {}), ...(q.page ? { page: String(q.page) } : {}) })}`, {});
      return ((await res.json()) as any[]).map((c) => ({ sha: c.sha, parents: c.parents.map((p: any) => p.sha), message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date }));
    },
    commitFiles: async (sha) => {
      gh.fileCalls++;
      return ((await (await github(`${REPO}/commits/${sha}`, {})).json()) as any).files;
    },
  };
  return { push, github, gh, calls, commits, blobs, head: () => head, text: (path: string, at = head) => blobs.get(commits.get(at)!.files.get(path)!) ?? null, blobAt: (path: string) => commits.get(head)!.files.get(path) };
}

// ---------------------------------------------------------------------------------------------
// The API with that vault, Discord and the rate limit stood in for.

interface Options {
  /** Whether the user holds the Wiki Editor role (default yes). */
  editor?: boolean;
  readOnly?: boolean;
  published?: WikiIndex['pages'];
  drafts?: WikiIndex['pages'];
}

const meta = (title: string, folder = '', aliases: string[] = []) => ({ title, slug: title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''), folder, aliases, headings: [], excerpt: '', links: [], files: [], blob: '' });

async function api(v: ReturnType<typeof vault>, o: Options = {}) {
  /** The edits announced through buc-bot, in order. */
  const announced: WikiEdit[] = [];
  const store = new Map<string, string>();
  const fetch = async (url: string, init: RequestInit = {}) => {
    if (url === 'https://api.github.com/app/installations/2/access_tokens') return Response.json({ token: 'installation-token', expires_at: new Date(T0 + 3600_000).toISOString() }, { status: 201 });
    assert.ok(url.startsWith(REPO), url);
    return v.github(url, init);
  };
  const drafts = { schema: 1, pages: o.drafts ?? [], files: [] };
  const env: WikiEnv = {
    SITE_URL: SITE,
    DISCORD_CLIENT_ID: '1572695514938613760',
    DISCORD_GUILD_ID: GUILD,
    DISCORD_CLIENT_SECRET: 'client-secret-value',
    BUC_BOT: fakeBucBot({ editor: () => o.editor ?? true, announce: (e) => (announced.push(e), { ok: true }) }, [], () => T0),
    WIKI_SESSION_SECRET: SECRET,
    WIKI_READ_ONLY: o.readOnly ? 'true' : undefined,
    GITHUB_APP_ID: '1',
    GITHUB_APP_INSTALLATION_ID: '2',
    GITHUB_APP_PRIVATE_KEY: PKCS8,
    VAULT_CATALOG: { get: async (key) => (key === 'wiki-drafts/index.json' ? { text: async () => JSON.stringify(drafts) } : null) },
    LFS_BUCKET: { head: async () => null, get: async () => null, put: async () => undefined },
  };
  const handle = createWikiApi(env, {
    fetch,
    cache: {
      match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined),
      put: async (k, r) => void store.set(k, await r.text()),
      delete: async (k) => store.delete(k),
    },
    now: () => T0,
    log: () => {},
    tokens: new Map(),
    takeSlot: async () => ({ ok: true, retryAfter: 0 }),
    wikiIndex: async () => normaliseWikiIndex({ schema: 1, pages: o.published ?? [], files: [] }),
  });
  const cookie = `${SESSION_COOKIE}=${await signSession({ sub: USER, name: 'buc', gname: 'Buc', avatar: null }, SECRET, T0)}`;
  const post = (what: string, body: unknown, headers: Record<string, string> = { Origin: SITE, Cookie: cookie }) =>
    handle(new Request(`${SITE}/api/wiki/${what}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } }));
  const get = (path: string, signedIn = true) => handle(new Request(`${SITE}${path}`, { headers: signedIn ? { Cookie: cookie } : {} }));
  return { post, get, announced, store };
}

const j = async (res: Response) => (await res.json()) as any;
/** The last commit the site made: message, author and what it changed. */
function lastCommit(v: ReturnType<typeof vault>) {
  const c = v.commits.get(v.head())!;
  const before = v.commits.get(c.parents[0])!.files;
  const removed = [...before.keys()].filter((p) => !c.files.has(p)).sort();
  const written = [...c.files].filter(([p, s]) => before.get(p) !== s).map(([p]) => p).sort();
  return { ...c, removed, written };
}

// ---------------------------------------------------------------------------------------------

test('history: newest first, across a site rename (trailer) and an Obsidian rename (file list), with editor names and no emails', async () => {
  const v = vault();
  v.push('Add the guide', { 'wiki/Benchmarking.md': '# Benchmarks\n\nv1\n' }, 'abucnasty');
  v.push('sync edits from obsidian', { 'wiki/Benchmarking.md': '# Benchmarks\n\nv2\n' });
  // The owner renames it in Obsidian: git sees the same blob at a new path ("renamed").
  v.push('sync edits from obsidian', { 'wiki/Benchmarking.md': null, 'wiki/Guides/Benchmarking.md': '# Benchmarks\n\nv2\n' });
  v.push(SITE_LINE('Explain flags'), { 'wiki/Guides/Benchmarking.md': '# Benchmarks\n\nv3\n' }, 'Buc the Editor');
  // A site rename: the frontmatter changes too, so only the trailer tells.
  v.push(SITE_LINE('Renamed Benchmarking to How to Benchmark', 'Wiki-Renamed-From: wiki/Guides/Benchmarking.md'), {
    'wiki/Guides/Benchmarking.md': null,
    'wiki/Guides/How to Benchmark.md': '---\naliases:\n  - Benchmarking\n---\n\n# Benchmarks\n\nv3\n',
  }, 'Buc the Editor');
  v.push('Unrelated', { 'wiki/Home.md': '# Home\n' });
  const h = await pageHistory(v.gh, 'wiki/Guides/How to Benchmark.md', 'main');
  assert.equal(h.truncated, false);
  assert.deepEqual(
    h.entries.map((e) => [e.summary, e.author, e.path, e.kind ?? '', e.from ?? '', e.site]),
    [
      ['Renamed Benchmarking to How to Benchmark', 'Buc the Editor', 'wiki/Guides/How to Benchmark.md', 'renamed', 'wiki/Guides/Benchmarking.md', true],
      ['Explain flags', 'Buc the Editor', 'wiki/Guides/Benchmarking.md', '', '', true],
      ['sync edits from obsidian', 'abucnasty', 'wiki/Guides/Benchmarking.md', 'renamed', 'wiki/Benchmarking.md', false],
      ['sync edits from obsidian', 'abucnasty', 'wiki/Benchmarking.md', '', '', false],
      ['Add the guide', 'abucnasty', 'wiki/Benchmarking.md', '', '', false],
    ],
  );
  // One file list fetched per Obsidian-made oldest commit (the move, then the first commit); the
  // site rename needed none.
  assert.equal(v.gh.fileCalls, 2);
  assert.ok(!JSON.stringify(h).includes('@'), 'no email in the history');
});

test('history API: anyone for a published page (cached), editors only for a draft; versions are for editors', async () => {
  const v = vault();
  v.push('Add pages', { 'wiki/Home.md': '# Home\n', 'wiki/Secret Plan.md': '---\ndraft: true\n---\n\n# Plan\n' });
  const t = await api(v, { published: [meta('Home')], drafts: [meta('Secret Plan')] });
  const anon = await t.get('/api/wiki/history?path=wiki%2FHome.md', false);
  assert.equal(anon.status, 200);
  assert.match(anon.headers.get('Cache-Control')!, /public, max-age=60/);
  const h = await j(anon);
  assert.equal(h.entries[0].summary, 'Add pages');
  const calls = v.calls.length;
  await t.get('/api/wiki/history?path=wiki%2FHome.md', false);
  assert.equal(v.calls.length, calls, 'the second view came from the cache');

  // A draft: signed out 401, signed in without the role 403, editor 200.
  assert.equal((await t.get('/api/wiki/history?path=wiki%2FSecret%20Plan.md', false)).status, 401);
  const member = await api(v, { editor: false, published: [meta('Home')] });
  assert.equal((await member.get('/api/wiki/history?path=wiki%2FSecret%20Plan.md')).status, 403);
  assert.equal((await member.get(`/api/wiki/version?path=wiki%2FHome.md&ref=${v.head()}`)).status, 403);
  const draft = await t.get('/api/wiki/history?path=wiki%2FSecret%20Plan.md');
  assert.equal(draft.status, 200);
  assert.match(draft.headers.get('Cache-Control')!, /private, no-store/);
  const version = await t.get(`/api/wiki/version?path=wiki%2FSecret%20Plan.md&ref=${v.head()}`);
  assert.equal(await version.text(), '---\ndraft: true\n---\n\n# Plan\n');
  assert.equal((await t.get('/api/wiki/history?path=..%2Fsecrets.md')).status, 404);
});

test('restore: the old text as a new commit through the save checks, frontmatter kept, announced; a stale base is refused', async () => {
  const v = vault();
  const first = v.push('Add', { 'wiki/Guide.md': '---\naliases: [Old Guide]\n---\n\n# Guide\n\nGood text.\n' }, 'abucnasty', Date.UTC(2026, 9, 1, 9));
  v.push('Vandalised', { 'wiki/Guide.md': '---\naliases: [Old Guide]\n---\n\n# Guide\n\nBad text.\n' });
  const t = await api(v, { published: [meta('Guide')] });
  const base = v.blobAt('wiki/Guide.md')!;
  assert.equal((await t.post('restore', { path: 'wiki/Guide.md', base: 'e'.repeat(40), commit: first, from: 'wiki/Guide.md' })).status, 409);
  const res = await t.post('restore', { path: 'wiki/Guide.md', base, commit: first, from: 'wiki/Guide.md' });
  const out = await j(res);
  assert.equal(res.status, 200, JSON.stringify(out));
  const c = lastCommit(v);
  assert.equal(v.text('wiki/Guide.md'), '---\naliases: [Old Guide]\n---\n\n# Guide\n\nGood text.\n');
  assert.equal(c.message, SITE_LINE('Restored Guide to the version from 2026-10-01', `Wiki-Restored-Version: ${first}`));
  assert.equal(c.author, 'Buc the Editor');
  assert.equal(t.announced[0].heading, 'Restored Guide to the version from 2026-10-01');
  assert.equal(out.body, '# Guide\n\nGood text.\n');
  // History shows it as a restore; nothing was rewritten.
  const h = await j(await t.get('/api/wiki/history?path=wiki%2FGuide.md'));
  assert.deepEqual(h.entries.map((e: any) => e.summary), ['Restored Guide to the version from 2026-10-01', 'Vandalised', 'Add']);
  assert.equal(h.entries[0].kind, 'restored');
});

test('rename: one commit moves the page and adds the old title to aliases; clashes refused', async () => {
  const v = vault();
  v.push('Add', {
    'wiki/Home.md': '# Home\n',
    'wiki/Guides/Setup.md': '---\ntags: [x]\n---\n\n# Setup\n\n![[shot.webp]] and ![[logo.png]]\n',
    'wiki/Guides/_attachments/shot.webp': 'pointer-shot',
    'wiki/Guides/_attachments/logo.png': 'pointer-logo',
    'wiki/Linux/Kernel.md': '# Kernel\n',
  });
  const t = await api(v, { published: [meta('Home'), meta('Setup', 'Guides'), meta('Kernel', 'Linux', ['Tuning'])] });
  const base = v.blobAt('wiki/Guides/Setup.md')!;
  const rename = (title: string, folder: string, b = base) => t.post('rename', { path: 'wiki/Guides/Setup.md', base: b, title, folder });

  // Refused: another page's title (any case), another page's former title, Home, a stale base, a bad folder.
  assert.equal((await j(await rename('kernel', 'Guides'))).error, 'exists');
  assert.equal((await j(await rename('Tuning', 'Guides'))).error, 'exists');
  assert.equal((await rename('All', 'Guides')).status, 400);
  assert.equal((await rename('Setup 2', '_attachments')).status, 400);
  assert.equal((await rename('Setup 2', 'Guides', 'e'.repeat(40))).status, 409);
  assert.equal((await t.post('rename', { path: 'wiki/Home.md', base: v.blobAt('wiki/Home.md'), title: 'Start', folder: '' })).status, 400);
  assert.equal(v.commits.size, 1, 'nothing was committed');

  // Renamed and moved to "linux" (spelled as the wiki spells it). Its images still resolve by name.
  const res = await rename('Setting Up', 'linux');
  const out = await j(res);
  assert.equal(res.status, 200, JSON.stringify(out));
  const c = lastCommit(v);
  assert.deepEqual(c.removed, ['wiki/Guides/Setup.md']);
  assert.deepEqual(c.written, ['wiki/Linux/Setting Up.md']);
  assert.ok(c.message.endsWith('\n\nWiki-Renamed-From: wiki/Guides/Setup.md'), c.message);
  assert.match(c.message, /^Renamed Setup to Setting Up \(in Linux\)\n/);
  const text = v.text('wiki/Linux/Setting Up.md')!;
  const fm = parseYaml(splitPage(text).frontmatter.replace(/^---\n|---\n*$/g, ''));
  assert.deepEqual(fm, { tags: ['x'], aliases: ['Setup'] });
  assert.equal(splitPage(text).body, '# Setup\n\n![[shot.webp]] and ![[logo.png]]\n');
  assert.equal(out.path, 'wiki/Linux/Setting Up.md');
  assert.equal(t.announced[0].heading, 'Renamed Setup to Setting Up');
  assert.equal(t.announced[0].url, 'https://abucnasty.dev/wiki/setting-up');
});

test('rename: an image is copied (same blob) only when the new folder would resolve its name to another file', async () => {
  const v = vault();
  v.push('Add', {
    'wiki/Guides/Setup.md': '# Setup\n\n![[shot.webp]] ![](_attachments/diagram.png)\n',
    'wiki/Guides/_attachments/shot.webp': 'pointer-shot',
    'wiki/Guides/_attachments/diagram.png': 'pointer-diagram',
    'wiki/Linux/diagram.png': 'pointer-linux-diagram',
    'wiki/Linux/Kernel.md': '# Kernel\n',
    'wiki/Clash/_attachments/shot.webp': 'pointer-clash',
    'wiki/Clash/Other.md': '# Other\n',
  });
  const t = await api(v);
  const res = await t.post('rename', { path: 'wiki/Guides/Setup.md', base: v.blobAt('wiki/Guides/Setup.md'), title: 'Setup', folder: 'Linux' });
  const out = await j(res);
  assert.equal(res.status, 200, JSON.stringify(out));
  const c = lastCommit(v);
  // diagram.png: Linux has its own diagram.png. shot.webp: from Linux, the name resolves to the
  // first of two equally near files, Clash's. Both are copied; the page's own images win then.
  assert.deepEqual(c.written, ['wiki/Linux/Setup.md', 'wiki/Linux/_attachments/diagram.png', 'wiki/Linux/_attachments/shot.webp']);
  assert.equal(v.blobAt('wiki/Linux/_attachments/diagram.png'), v.commits.get(c.parents[0])!.files.get('wiki/Guides/_attachments/diagram.png'));
  assert.ok(v.blobAt('wiki/Guides/_attachments/diagram.png'), 'the old image stays');
  assert.equal(v.text('wiki/Linux/Setup.md'), '# Setup\n\n![[shot.webp]] ![](_attachments/diagram.png)\n', 'same title: no alias, text unchanged');
  assert.match(c.message, /^Moved Setup to Linux\n/);
  assert.equal(t.announced.length, 0, 'a move alone is not announced');
  // Moving it into a folder whose _attachments has another shot.webp: refused.
  const clash = await t.post('rename', { path: 'wiki/Linux/Setup.md', base: v.blobAt('wiki/Linux/Setup.md'), title: 'Setup', folder: 'Clash' });
  assert.equal(clash.status, 409);
  assert.equal((await j(clash)).error, 'file_exists');
});

test('aliases: old [[links]] and addresses reach a renamed page on the site, a draft too', () => {
  const index = normaliseWikiIndex({ schema: 1, pages: [meta('Setting Up', 'Linux', ['Setup']), meta('Home')], files: [] });
  const drafts = normaliseWikiIndex({ schema: 1, pages: [meta('New Plan', '', ['Plan'])], files: [] });
  const merged = mergeWikiDrafts(index, drafts);
  assert.equal(findWikiTarget(merged, 'Setup')?.slug, 'setting-up');
  assert.equal(findWikiTarget(merged, 'setup.md')?.slug, 'setting-up');
  assert.equal(findWikiAlias(merged, 'setup')?.slug, 'setting-up');
  assert.equal(findWikiTarget(merged, 'Plan')?.slug, 'new-plan');
  assert.equal(findWikiAlias(merged, 'plan')?.slug, 'new-plan');
  assert.equal(findWikiTarget(index, 'Plan'), undefined, 'readers do not get drafts');
  // A published page's former title wins over a draft's.
  const both = mergeWikiDrafts(index, normaliseWikiIndex({ schema: 1, pages: [meta('Zed', '', ['Setup'])], files: [] }));
  assert.equal(findWikiTarget(both, 'Setup')?.slug, 'setting-up');
  // withAlias: every form people write.
  assert.equal(withAlias('', 'Old'), '---\naliases:\n  - Old\n---\n\n');
  assert.equal(withAlias('---\naliases: [A]\n---\n\n', 'Old'), '---\naliases: [A, Old]\n---\n\n');
  assert.equal(withAlias('---\naliases: [old]\n---\n', 'Old'), '---\naliases: [old]\n---\n', 'already there');
  assert.equal(withAlias('---\naliases:\n- A\ndraft: true\n---\n', '2024: Results'), '---\naliases:\n- A\n- "2024: Results"\ndraft: true\n---\n');
  assert.equal(withAlias('---\naliases: A\n---\n', 'true'), '---\naliases:\n  - A\n  - "true"\n---\n');
  assert.throws(() => withAlias('---\naliases: &x [A]\n---\n', 'Old'));
});

test('delete: one commit removing the page (images kept), announced when published; Home refused; drafts not announced', async () => {
  const v = vault();
  v.push('Add', {
    'wiki/Home.md': '# Home\n',
    'wiki/Guides/Old.md': '# Old\n\n![[shot.webp]]\n',
    'wiki/Guides/_attachments/shot.webp': 'pointer',
    'wiki/Draft.md': '---\ndraft: true\n---\n\n# Draft\n',
  });
  const t = await api(v);
  assert.equal((await t.post('delete', { path: 'wiki/Home.md', base: v.blobAt('wiki/Home.md') })).status, 400);
  assert.equal((await t.post('delete', { path: 'wiki/Guides/Old.md', base: 'e'.repeat(40) })).status, 409);
  const res = await t.post('delete', { path: 'wiki/Guides/Old.md', base: v.blobAt('wiki/Guides/Old.md'), summary: 'Merged into Setup' });
  assert.equal(res.status, 200, JSON.stringify(await j(res.clone())));
  const c = lastCommit(v);
  assert.deepEqual([c.removed, c.written], [['wiki/Guides/Old.md'], []]);
  assert.equal(c.message, SITE_LINE('Merged into Setup', 'Wiki-Deleted: wiki/Guides/Old.md'));
  assert.ok(v.blobAt('wiki/Guides/_attachments/shot.webp'));
  assert.equal(t.announced[0].heading, 'Deleted Old');
  await t.post('delete', { path: 'wiki/Draft.md', base: v.blobAt('wiki/Draft.md') });
  assert.equal(lastCommit(v).removed[0], 'wiki/Draft.md');
  assert.equal(t.announced.length, 1, 'a draft is never announced');
});

test('recently deleted: site and Obsidian deletions in 90 days, not renames or pages back since; restore, and a taken title', async () => {
  const v = vault();
  v.push('Add', { 'wiki/A.md': '# A\n', 'wiki/B.md': '# B\n', 'wiki/C.md': '# C\n', 'wiki/D.md': '# D\n', 'wiki/Ancient.md': '# Ancient\n' }, 'abucnasty', T0 - 120 * DAY);
  v.push('sync edits from obsidian', { 'wiki/Ancient.md': null }, 'abucnasty', T0 - 100 * DAY);
  v.push(SITE_LINE('Deleted A', 'Wiki-Deleted: wiki/A.md'), { 'wiki/A.md': null }, 'Buc the Editor', T0 - 10 * DAY);
  v.push('sync edits from obsidian', { 'wiki/B.md': null }, 'abucnasty', T0 - 9 * DAY);
  v.push('sync edits from obsidian', { 'wiki/C.md': null, 'wiki/Guides/C.md': '# C\n' }, 'abucnasty', T0 - 8 * DAY); // a rename
  v.push('sync edits from obsidian', { 'wiki/D.md': null }, 'abucnasty', T0 - 7 * DAY);
  v.push('sync edits from obsidian', { 'wiki/D.md': '# D again\n' }, 'abucnasty', T0 - 6 * DAY); // back
  v.push('sync edits from obsidian', { 'wiki/b.md': '# another b\n' }, 'abucnasty', T0 - 5 * DAY); // takes B's title

  // Pure: what is found, and the cost (one file list per Obsidian commit; none for the site's).
  const live = new Set([...v.commits.get(v.head())!.files.keys()]);
  const found = await recentlyDeleted(v.gh, 'main', new Date(T0 - 90 * DAY).toISOString(), live, () => true);
  assert.deepEqual(found.pages.map((p) => [p.path, p.author, p.site]), [['wiki/B.md', 'abucnasty', false], ['wiki/A.md', 'Buc the Editor', true]]);
  assert.equal(v.gh.fileCalls, 5);
  const budget = await recentlyDeleted(v.gh, 'main', new Date(T0 - 90 * DAY).toISOString(), live, () => false);
  assert.deepEqual([budget.pages.map((p) => p.path), budget.partial], [['wiki/A.md'], true]);

  // Through the API: editors only; B's title is taken now.
  const t = await api(v);
  assert.equal((await t.get('/api/wiki/deleted', false)).status, 401);
  const list = await j(await t.get('/api/wiki/deleted'));
  assert.deepEqual(list.pages.map((p: any) => [p.title, p.titleTaken]), [['B', 'b'], ['A', null]]);

  // Restore A: back at its path, as it was.
  const a = list.pages[1];
  const res = await t.post('undelete', { path: a.path, commit: a.commit });
  const out = await j(res);
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.equal(v.text('wiki/A.md'), '# A\n');
  assert.equal(lastCommit(v).message, SITE_LINE('Restored A', 'Wiki-Restored-From: wiki/A.md'));
  assert.equal(t.announced[0].heading, 'Restored A');
  assert.equal(out.body, '# A\n');
  const after = await j(await t.get('/api/wiki/deleted'));
  assert.deepEqual(after.pages.map((p: any) => p.title), ['B'], 'the list was read again after the restore');

  // B: its title is taken; refused, then restored under another title (history follows it).
  const b = list.pages[0];
  const taken = await t.post('undelete', { path: b.path, commit: b.commit });
  assert.equal(taken.status, 409);
  assert.equal((await j(taken)).error, 'title_taken');
  const renamed = await t.post('undelete', { path: b.path, commit: b.commit, title: 'B (old)' });
  assert.equal(renamed.status, 200);
  assert.equal(v.text('wiki/B (old).md'), '# B\n');
  const h = await j(await t.get(`/api/wiki/history?path=${encodeURIComponent('wiki/B (old).md')}`));
  assert.deepEqual(h.entries.map((e: any) => [e.summary, e.path]), [
    ['Restored B as B (old)', 'wiki/B (old).md'],
    ['sync edits from obsidian', 'wiki/B.md'],
    ['Add', 'wiki/B.md'],
  ]);
});

test('every change is refused cross-site, signed out, without the role, and while read-only; nothing is committed', async () => {
  const v = vault();
  v.push('Add', { 'wiki/Guide.md': '# Guide\n' });
  const base = v.blobAt('wiki/Guide.md');
  const bodies: Record<string, unknown> = {
    restore: { path: 'wiki/Guide.md', base, commit: v.head(), from: 'wiki/Guide.md' },
    rename: { path: 'wiki/Guide.md', base, title: 'Guide 2', folder: '' },
    delete: { path: 'wiki/Guide.md', base },
    undelete: { path: 'wiki/Gone.md', commit: v.head() },
  };
  const ok = await api(v);
  const member = await api(v, { editor: false });
  const readOnly = await api(v, { readOnly: true });
  for (const [what, body] of Object.entries(bodies)) {
    assert.equal((await ok.post(what, body, { Origin: 'https://evil.example', Cookie: 'x' })).status, 403, `${what} cross-site`);
    assert.equal((await ok.post(what, body, { Origin: SITE })).status, 401, `${what} signed out`);
    assert.equal((await j(await member.post(what, body))).error, 'not_editor', `${what} without the role`);
    assert.equal((await j(await readOnly.post(what, body))).error, 'read_only', `${what} read-only`);
    assert.equal((await ok.post(what, { ...(body as object), path: '../outside.md' })).status, 400, `${what} outside wiki/`);
  }
  assert.equal(v.commits.size, 1);
  assert.equal(COMMIT_EMAIL, 'wiki-editor@users.noreply.abucnasty.dev');
});
