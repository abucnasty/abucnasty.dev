// Saving wiki pages (wikiSave.ts, github.ts, rateLimit.ts) through the API (wikiApi.ts), with
// GitHub, buc-bot (the role check and announcements) and the LFS bucket stood in for: the
// critical flows only.
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { pemToPkcs8 } from './github.ts';
import { takeSlot, SAVE_LIMIT } from './rateLimit.ts';
import { signSession, SESSION_COOKIE } from './session.ts';
import { fakeBucBot } from './fakeBucBot.ts';
import type { FakeBucBotOptions } from './fakeBucBot.ts';
import { createWikiApi, type WikiEnv } from './wikiApi.ts';
import { COMMIT_EMAIL, gitBlobSha, lfsKey, lfsPointer } from './wikiSave.ts';
import { existingFolder, folderProblem, isDraft, pageFolderProblem, splitPage, tidyFolder, withDraft } from '../src/wikiSource.ts';

const SITE = 'https://abucnasty.dev';
const SECRET = 's'.repeat(48);
const GUILD = '1381752136450441266';
const USER = '80351110224678912';
const T0 = Date.UTC(2026, 10, 18, 12);
const REPO = 'https://api.github.com/repos/abucnasty/factorio-vault';
const PAGE = 'wiki/Guides/How to Benchmark.md';
const PAGE_TEXT = '---\naliases: [Benchmarking]\n---\n\n# How to benchmark\n\nOld text.\n';

const { privateKey: PKCS8, publicKey: PUBLIC } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const enc = new TextEncoder();
const sha = (text: string) => gitBlobSha(enc.encode(text));
const b64 = (text: string) => Buffer.from(text).toString('base64');

interface Options {
  /** Whether the user holds the Wiki Editor role (buc-bot's answer); default yes. */
  editor?: () => boolean;
  readOnly?: boolean;
  /** Answers of PATCH refs/heads/main in turn (true: moved; false: not a fast-forward). */
  refAnswers?: boolean[];
  /** What main's page is after the first ref refusal. */
  pageAfterMove?: string;
  announce?: FakeBucBotOptions['announce'];
  key?: string;
}

async function setup(o: Options = {}) {
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const logs: string[] = [];
  const objects = new Map<string, { bytes: Uint8Array; opts: unknown }>();
  const stamps: number[] = [];
  let heads = ['head1'];
  const refAnswers = [...(o.refAnswers ?? [true])];
  const blobs = new Map<string, string>([[await sha(PAGE_TEXT), PAGE_TEXT]]);
  const moved = o.pageAfterMove === undefined ? undefined : await sha(o.pageAfterMove);
  if (o.pageAfterMove !== undefined) blobs.set(moved!, o.pageAfterMove);
  const listing = (head: string) => [
    { path: 'Home.md', type: 'blob', mode: '100644', sha: 'a'.repeat(40) },
    { path: 'Guides', type: 'tree', mode: '040000', sha: 'b'.repeat(40) },
    { path: 'Guides/_attachments', type: 'tree', mode: '040000', sha: 'c'.repeat(40) },
    { path: 'Guides/How to Benchmark.md', type: 'blob', mode: '100644', sha: head === 'head1' ? blobs.keys().next().value : (moved ?? blobs.keys().next().value) },
  ];
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    let body: any;
    if (typeof init.body === 'string') body = init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body });
    const head = heads[heads.length - 1];
    if (url === 'https://api.github.com/app/installations/2/access_tokens') {
      assert.equal(method, 'POST');
      return json({ token: 'installation-token', expires_at: new Date(T0 + 3600_000).toISOString() }, 201);
    }
    assert.ok(url.startsWith(REPO), url);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer installation-token');
    const path = url.slice(REPO.length);
    if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
    if (path.startsWith('/git/commits/') && method === 'GET') return json({ tree: { sha: `root-${path.slice(13)}` } });
    if (path.startsWith('/git/trees/root-')) return json({ tree: [{ path: 'wiki', type: 'tree', mode: '040000', sha: `wiki-${path.slice(16)}` }] });
    if (path.startsWith('/git/trees/wiki-')) return json({ tree: listing(path.slice(16).split('?')[0]) });
    if (path.startsWith('/git/blobs/') && method === 'GET') {
      const text = blobs.get(path.slice(11));
      return text === undefined ? json({ message: 'Not Found' }, 404) : json({ content: b64(text), encoding: 'base64' });
    }
    if (path === '/git/blobs') {
      const text = Buffer.from(body.content, 'base64').toString();
      const s = await sha(text);
      blobs.set(s, text);
      return json({ sha: s }, 201);
    }
    if (path === '/git/trees') return json({ sha: `tree-${calls.length}` }, 201);
    if (path === '/git/commits') return json({ sha: `commit-${calls.length}` }, 201);
    if (path === '/git/refs/heads/main') {
      const ok = refAnswers.shift() ?? true;
      if (!ok) {
        heads = [...heads, `head${heads.length + 1}`];
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      return json({ object: { sha: body.sha } });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const env: WikiEnv = {
    SITE_URL: SITE,
    DISCORD_CLIENT_ID: '1572695514938613760',
    DISCORD_GUILD_ID: GUILD,
    DISCORD_CLIENT_SECRET: 'client-secret-value',
    BUC_BOT: fakeBucBot({ editor: o.editor, announce: o.announce }, calls, () => T0),
    WIKI_SESSION_SECRET: SECRET,
    WIKI_READ_ONLY: o.readOnly ? 'true' : undefined,
    GITHUB_APP_ID: '1',
    GITHUB_APP_INSTALLATION_ID: '2',
    GITHUB_APP_PRIVATE_KEY: o.key ?? PKCS8,
    VAULT_CATALOG: { get: async () => null },
    LFS_BUCKET: {
      head: async (key) => (objects.has(key) ? {} : null),
      get: async () => null,
      put: async (key, value, opts) => void objects.set(key, { bytes: new Uint8Array(value as Uint8Array), opts }),
    },
  };
  const store = new Map<string, string>();
  const handle = createWikiApi(env, {
    fetch,
    cache: { match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined), put: async (k, r) => void store.set(k, await r.text()) },
    now: () => T0,
    log: (m) => logs.push(m),
    tokens: new Map(),
    takeSlot: async () => {
      const r = takeSlot(stamps, T0);
      stamps.splice(0, stamps.length, ...r.stamps);
      return r.slot;
    },
  });
  const cookie = `${SESSION_COOKIE}=${await signSession({ sub: USER, name: 'buc', gname: 'Buc', avatar: null }, SECRET, T0)}`;
  const save = async (meta: Record<string, unknown>, images: Record<string, Uint8Array> = {}, headers: Record<string, string> = { Origin: SITE }) => {
    const form = new FormData();
    form.set('save', JSON.stringify(meta));
    for (const [name, bytes] of Object.entries(images)) form.set(`image:${name}`, new Blob([bytes]), name);
    return handle(new Request(`${SITE}/api/wiki/save`, { method: 'POST', body: form, headers: { Cookie: cookie, ...headers } }));
  };
  const get = (path: string) => handle(new Request(`${SITE}${path}`, { headers: { Cookie: cookie } }));
  const github = () => calls.filter((c) => c.url.startsWith('https://api.github.com'));
  return { save, get, calls, github, logs, objects, stamps, blobs };
}

const base = async () => sha(PAGE_TEXT);
const edit = async (body = '# How to benchmark\n\nNew text.\n', extra: object = {}) => ({
  path: PAGE,
  base: await base(),
  frontmatter: '---\naliases: [Benchmarking]\n---\n\n',
  body,
  draft: false,
  summary: 'Explain the new flag',
  ...extra,
});
const j = async (res: Response) => (await res.json()) as any;

test('save: re-checks the role, then blob, tree, commit and ref in order, as the editor, and announces it', async () => {
  const t = await setup();
  const res = await t.save(await edit());
  const out = await j(res);
  assert.equal(res.status, 200, JSON.stringify(out));
  const steps = t.calls.map((c) => `${c.method} ${c.url.replace(REPO, '').replace('https://api.github.com', '')}`);
  assert.deepEqual(steps, [
    'RPC buc-bot/wikiMember',
    'POST /app/installations/2/access_tokens',
    'GET /git/ref/heads/main',
    'GET /git/commits/head1',
    'GET /git/trees/root-head1',
    'GET /git/trees/wiki-head1?recursive=1',
    'POST /git/blobs',
    'POST /git/trees',
    'POST /git/commits',
    'PATCH /git/refs/heads/main',
    'RPC buc-bot/announceWikiEdit',
  ]);
  assert.equal(t.calls[0].body, USER);
  const by = (p: string) => t.calls.find((c) => c.url === `${REPO}${p}` && c.method !== 'GET')!.body;
  const text = '---\naliases: [Benchmarking]\n---\n\n# How to benchmark\n\nNew text.\n';
  assert.equal(Buffer.from(by('/git/blobs').content, 'base64').toString(), text, 'frontmatter put back unchanged');
  assert.deepEqual(by('/git/trees'), { base_tree: 'root-head1', tree: [{ path: PAGE, mode: '100644', type: 'blob', sha: await sha(text) }] });
  const commit = by('/git/commits');
  assert.deepEqual(commit.parents, ['head1']);
  assert.equal(commit.message, `Explain the new flag\n\nWiki edit by Buc the Editor (Discord ${USER}) via abucnasty.dev`);
  assert.deepEqual(commit.author, { name: 'Buc the Editor', email: COMMIT_EMAIL, date: new Date(T0).toISOString() });
  assert.deepEqual(by('/git/refs/heads/main'), { sha: out.commit, force: false });
  assert.deepEqual(t.calls.at(-1)!.body, {
    title: 'How to Benchmark',
    url: 'https://abucnasty.dev/wiki/how-to-benchmark',
    summary: 'Explain the new flag',
    editor: 'Buc the Editor',
    created: false,
  });
  assert.equal(out.blob, await sha(text));
  assert.equal(out.slug, 'how-to-benchmark');

  // An empty summary gets "Edited <Page>"; the installation token is reused.
  const again = await setup();
  await again.save(await edit(undefined, { summary: '' }));
  assert.match(again.calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')!.body.message, /^Edited How to Benchmark\n\n/);
});

test('save: a page that changed since a version GitHub no longer has is a conflict (all of it), and nothing is written', async () => {
  // Merging is tested in wikiMerge.test.ts.
  const t = await setup();
  const res = await t.save(await edit(undefined, { base: 'f'.repeat(40) }));
  assert.equal(res.status, 409);
  const out = await j(res);
  assert.equal(out.error, 'conflict');
  assert.match(out.message, /changed the same part of this page/);
  assert.equal(out.current.blob, await base());
  assert.equal(out.base.body, null);
  assert.equal(out.theirs.body, '# How to benchmark\n\nOld text.\n');
  assert.equal(out.mine.combined, '# How to benchmark\n\nNew text.\n');
  assert.ok(!t.github().some((c) => c.method !== 'GET' && !c.url.endsWith('access_tokens')), 'no writes');
});

test('save: when only main moved, the commit is made again on the new head; when the page changed the same line too, 409', async () => {
  const t = await setup({ refAnswers: [false, true] });
  const res = await t.save(await edit());
  assert.equal(res.status, 200);
  const commits = t.calls.filter((c) => c.url === `${REPO}/git/commits` && c.method === 'POST');
  assert.deepEqual(commits.map((c) => c.body.parents), [['head1'], ['head2']]);
  assert.equal(t.calls.filter((c) => c.url === `${REPO}/git/blobs`).length, 1, 'the blob is made once');
  assert.ok(t.logs.some((l) => /moved during the save/.test(l)));

  const u = await setup({ refAnswers: [false], pageAfterMove: PAGE_TEXT.replace('Old text.', 'Other text.') });
  const res2 = await u.save(await edit());
  assert.equal(res2.status, 409);
  assert.equal((await j(res2)).error, 'conflict');
  assert.equal(u.calls.filter((c) => c.url.endsWith('/git/refs/heads/main')).length, 1);

  // main moving on every try: MAX_ATTEMPTS tries, then a clear refusal.
  const v = await setup({ refAnswers: [false, false, false, false] });
  assert.equal((await v.save(await edit())).status, 503);
  assert.equal(v.calls.filter((c) => c.url.endsWith('/git/refs/heads/main')).length, 3, 'bounded retries');
});

test('save: a lost role is a 403 with no commit, checked on the save itself', async () => {
  let editor = true;
  const t = await setup({ editor: () => editor });
  assert.equal((await j(await t.get('/api/wiki/me'))).editor, true);
  editor = false;
  const res = await t.save(await edit());
  assert.equal(res.status, 403);
  assert.equal((await j(res)).error, 'not_editor');
  assert.equal(t.github().length, 0);
  // Signed out, or from another site: refused before anything else.
  const other = await t.save(await edit(), {}, { Origin: 'https://evil.example' });
  assert.equal(other.status, 403);
});

test('save: WIKI_READ_ONLY=true refuses every save with a clear message, and `me` says so', async () => {
  const t = await setup({ readOnly: true });
  const res = await t.save(await edit());
  assert.equal(res.status, 503);
  const out = await j(res);
  assert.equal(out.error, 'read_only');
  assert.match(out.message, /paused/);
  assert.equal(t.github().length, 0);
  assert.equal((await j(await t.get('/api/wiki/me'))).editing, 'read-only');
});

test('save: size and rate limits', async () => {
  const t = await setup();
  const big = await t.save(await edit(`# Big\n\n${'x'.repeat(200 * 1024)}\n`));
  assert.equal(big.status, 413);
  assert.equal(t.github().length, 0);

  const now = T0;
  t.stamps.push(...Array.from({ length: SAVE_LIMIT }, (_, i) => now - i * 1000));
  const limited = await t.save(await edit());
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  // The slot is taken just before the first write (so a conflict does not use one): read, nothing written.
  assert.ok(!t.github().some((c) => c.method !== 'GET' && !c.url.endsWith('access_tokens')), 'nothing written');
  // The window slides: ten minutes after the oldest save a slot is free again.
  assert.equal(takeSlot(t.stamps, now + 10 * 60 * 1000 - (SAVE_LIMIT - 1) * 1000 + 1).slot.ok, true);
});

test('save: writes only pages under wiki/ and images in the page folder\'s _attachments', async () => {
  const t = await setup();
  for (const path of ['blog/x.md', 'wiki/../blog/x.md', '../wiki/x.md', 'wiki/.obsidian/x.md', 'wiki/Guides/_attachments/x.md', 'wiki/x.txt', 'wiki/a\\b.md', '/wiki/x.md']) {
    const res = await t.save(await edit(undefined, { path }));
    assert.equal(res.status, 400, path);
  }
  for (const name of ['../x.webp', 'a/b.webp', 'x.png', 'x.svg', '.x.webp', 'x..webp']) {
    const res = await t.save(await edit(), { [name]: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) });
    assert.equal(res.status, 400, name);
  }
  for (const create of [{ title: 'a/b', folder: '' }, { title: '../x', folder: '' }, { title: 'All', folder: '' }, { title: 'X', folder: '../blog' }, { title: 'X', folder: 'Guides/_attachments' }]) {
    const res = await t.save({ create, base: null, frontmatter: '', body: 'x\n', draft: false });
    assert.equal(res.status, 400, JSON.stringify(create));
  }
  // An existing title (ignoring case) is taken.
  const taken = await t.save({ create: { title: 'how to benchmark', folder: '' }, base: null, frontmatter: '', body: 'x\n', draft: false });
  assert.equal(taken.status, 409);
  // A file that is not the image its name says.
  const fake = await t.save(await edit(), { 'x.webp': enc.encode('<svg/>') });
  assert.equal(fake.status, 400);
  assert.ok(!t.github().some((c) => c.method !== 'GET' && !c.url.endsWith('access_tokens')), 'nothing written');
});

test('save: a new page in a folder that is not there yet makes it, spelled as the wiki spells its folders', async () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);
  for (const [folder, dir] of [[' guides / Linux/ ', 'wiki/Guides/Linux'], ['Servers', 'wiki/Servers'], ['GUIDES', 'wiki/Guides']]) {
    const t = await setup();
    const res = await t.save({ create: { title: 'Linux Setup', folder }, base: null, frontmatter: '', body: '![[a-1a2b3c4d.webp]]\n', draft: false }, { 'a-1a2b3c4d.webp': webp });
    const out = await j(res);
    assert.equal(res.status, 200, JSON.stringify(out));
    const tree = t.calls.find((c) => c.url === `${REPO}/git/trees` && c.method === 'POST')!.body.tree;
    assert.deepEqual(tree.map((e: any) => e.path), [`${dir}/Linux Setup.md`, `${dir}/_attachments/a-1a2b3c4d.webp`], folder);
    assert.deepEqual([out.path, out.folder], [`${dir}/Linux Setup.md`, dir.slice(5)]);
  }
  // A new folder keeps to the rules; never outside wiki/, never hidden or _ folders.
  const t = await setup();
  for (const folder of ['_drafts', 'Guides/_attachments', 'guides/_ATTACHMENTS', '.obsidian', 'Guides/../..', '../blog', 'a//b', 'a/./b', 'x:y', 'Guides/Linux.', 'a\\b', 'x'.repeat(101)]) {
    const res = await t.save({ create: { title: 'Linux Setup', folder }, base: null, frontmatter: '', body: 'x\n', draft: false });
    assert.equal(res.status, 400, folder);
  }
  assert.ok(!t.github().some((c) => c.method !== 'GET' && !c.url.endsWith('access_tokens')), 'nothing written');
});

test('folders: tidied, spelled as the wiki spells them, and checked when new', () => {
  assert.equal(tidyFolder('  /Guides / Linux / '), 'Guides/Linux');
  assert.equal(tidyFolder(' / '), '');
  assert.equal(tidyFolder('a//b'), 'a//b');
  const known = ['Guides', 'Guides/Arch Linux', 'Mods/_old/Things'];
  assert.equal(existingFolder('guides/arch linux/x', known), 'Guides/Arch Linux/x');
  assert.equal(existingFolder('MODS', known), 'Mods');
  assert.equal(existingFolder('Other/guides', known), 'Other/guides');
  for (const ok of ['', 'Guides', 'Guides/Linux', 'Guides/Linux/Arch', 'Ünïcode & Co', 'Mods/_old/New']) assert.equal(pageFolderProblem(ok, known), null, ok);
  for (const bad of ['_drafts', 'Guides/_x', '.hidden', 'Guides/..', 'a//b', 'x:y', 'a#b', 'a%b', 'Guides/Linux.', 'Guides/_attachments', 'x'.repeat(101), `${'abcdefghi/'.repeat(20)}x`]) {
    assert.ok(pageFolderProblem(bad, known), bad);
  }
  assert.match(folderProblem('a/_b')!, /can't start with \. or _/);
  assert.equal(folderProblem('Guides/Linux'), null);
});

test('save: a new image goes to the LFS bucket under its sha256 and its pointer is committed with the page', async () => {
  const t = await setup();
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);
  const oid = Buffer.from(await crypto.subtle.digest('SHA-256', webp)).toString('hex');
  const res = await t.save(await edit('# How to benchmark\n\n![[shot-1a2b3c4d.webp]]\n'), { 'shot-1a2b3c4d.webp': webp });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const stored = t.objects.get(lfsKey(oid))!;
  assert.deepEqual([...stored.bytes], [...webp]);
  assert.deepEqual(stored.opts, { httpMetadata: { contentType: 'image/webp' }, sha256: oid });
  assert.equal(lfsKey(oid), `${oid.slice(0, 2)}/${oid.slice(2, 4)}/${oid}`);
  const pointer = lfsPointer(oid, webp.length);
  assert.equal(pointer, `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 16\n`);
  const blobs = t.calls.filter((c) => c.url === `${REPO}/git/blobs`).map((c) => Buffer.from(c.body.content, 'base64').toString());
  assert.ok(blobs.includes(pointer), 'the pointer is a blob');
  const tree = t.calls.find((c) => c.url === `${REPO}/git/trees` && c.method === 'POST')!.body.tree;
  assert.deepEqual(tree.map((e: any) => [e.path, e.sha]), [
    [PAGE, await sha('---\naliases: [Benchmarking]\n---\n\n# How to benchmark\n\n![[shot-1a2b3c4d.webp]]\n')],
    ['wiki/Guides/_attachments/shot-1a2b3c4d.webp', await sha(pointer)],
  ]);
  assert.deepEqual((await j(res)).images, [{ path: 'wiki/Guides/_attachments/shot-1a2b3c4d.webp', oid }]);
});

test('save: a failed announcement never fails the save; drafts are not announced', async () => {
  const t = await setup({ announce: () => ({ ok: false, reason: 'messages: HTTP 500' }) });
  const res = await t.save(await edit());
  assert.equal(res.status, 200);
  assert.ok(t.logs.some((l) => /wiki announce: messages: HTTP 500/.test(l)));
  const thrown = await setup({ announce: () => { throw new Error('network down'); } });
  assert.equal((await thrown.save(await edit())).status, 200);

  const d = await setup();
  const draft = await d.save(await edit(undefined, { draft: true }));
  assert.equal(draft.status, 200);
  assert.ok(!d.calls.some((c) => c.url === 'buc-bot/announceWikiEdit'));
  const blob = Buffer.from(d.calls.find((c) => c.url === `${REPO}/git/blobs`)!.body.content, 'base64').toString();
  assert.ok(blob.startsWith('---\ndraft: true\naliases: [Benchmarking]\n---\n\n'), blob);
});

test('source: the page file from main, split into frontmatter and body, with its blob id', async () => {
  const t = await setup();
  const res = await t.get('/api/wiki/source?slug=how-to-benchmark');
  assert.equal(res.status, 200);
  assert.deepEqual(await j(res), {
    path: PAGE,
    title: 'How to Benchmark',
    folder: 'Guides',
    blob: await base(),
    head: 'head1',
    frontmatter: '---\naliases: [Benchmarking]\n---\n\n',
    body: '# How to benchmark\n\nOld text.\n',
    draft: false,
  });
  assert.equal((await t.get('/api/wiki/source?slug=nope')).status, 404);
});

test('GitHub App: an RS256 JWT for the app; a PKCS#1 key works too', async () => {
  const pkcs1 = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  for (const key of [PKCS8, pkcs1.privateKey]) {
    const t = await setup({ key });
    assert.equal((await t.save(await edit())).status, 200);
    const call = t.calls.find((c) => c.url.endsWith('/access_tokens'))!;
    assert.deepEqual(call.body, { repositories: ['factorio-vault'], permissions: { contents: 'write' } });
  }
  // The JWT itself, checked with the public key.
  const { appJwt } = await import('./github.ts');
  const jwt = await appJwt('5824707', PKCS8, T0);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.deepEqual(claims, { iat: T0 / 1000 - 60, exp: T0 / 1000 + 540, iss: '5824707' });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(PUBLIC, Buffer.from(s, 'base64url')));
  assert.ok(pemToPkcs8(pkcs1.privateKey).length > 0);
});

test('frontmatter: the Draft switch changes only the draft line', () => {
  const fm = '---\naliases: [Old]\ndraft: true\n---\n\n';
  assert.equal(isDraft(fm), true);
  assert.equal(withDraft(fm, true), fm);
  assert.equal(withDraft(fm, false), '---\naliases: [Old]\n---\n\n');
  assert.equal(withDraft('---\ndraft: true\n---\n', false), '');
  assert.equal(withDraft('', true), '---\ndraft: true\n---\n');
  assert.equal(withDraft('---\ndraft: false\n---\n', true), '---\ndraft: true\n---\n');
  assert.throws(() => withDraft('---\ndraft:\n  true\n---\n', true), /can't change/);
  assert.deepEqual(splitPage('---\na: 1\n---\n\n\nBody\n'), { frontmatter: '---\na: 1\n---\n\n\n', body: 'Body\n' });
  assert.deepEqual(splitPage('No frontmatter\n'), { frontmatter: '', body: 'No frontmatter\n' });
});
