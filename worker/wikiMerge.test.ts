// Saving over someone else's edit (wikiSave.ts, wikiMerge.ts) through the API (wikiApi.ts), against
// a small stand-in for the vault on GitHub that keeps real commits, so other edits (site saves,
// Obsidian pushes, renames, deletions) can land between the editor opening a page and saving it.
// The critical flows only.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { takeSlot } from './rateLimit.ts';
import { signSession, SESSION_COOKIE } from './session.ts';
import { createWikiApi, type WikiEnv } from './wikiApi.ts';
import { mergeText } from './wikiMerge.ts';
import { gitBlobSha } from './wikiSave.ts';

const SITE = 'https://abucnasty.dev';
const SECRET = 's'.repeat(48);
const GUILD = '1381752136450441266';
const ROLE = '1572672305019101214';
const CHANNEL = '1571207361769644142';
const USER = '80351110224678912';
const T0 = Date.UTC(2026, 10, 18, 12);
const REPO = 'https://api.github.com/repos/abucnasty/factorio-vault';
const PAGE = 'wiki/Guides/How to Benchmark.md';
const FM = '---\naliases: [Benchmarking]\n---\n\n';
const BODY = ['# How to benchmark', '', 'Intro line.', '', '## Steps', '', 'Step one.', '', 'Step two.', '', '## Notes', '', 'Last line.', ''].join('\n');

const { privateKey: KEY } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const enc = new TextEncoder();
const sha = (text: string) => gitBlobSha(enc.encode(text));

interface Commit {
  sha: string;
  parent: string | null;
  files: Map<string, string>;
  message: string;
  author: string;
  date: string;
  renames: Array<{ from: string; to: string }>;
}

/** The vault on GitHub: commits on main (first parent only), blobs, trees made by the save. */
async function vault() {
  const blobs = new Map<string, string>();
  const commits = new Map<string, Commit>();
  const trees = new Map<string, Map<string, string>>();
  let n = 0;
  const nextSha = () => (++n).toString(16).padStart(40, 'c');
  const put = async (text: string) => {
    const s = await sha(text);
    blobs.set(s, text);
    return s;
  };
  let head = '';
  const add = (c: Omit<Commit, 'sha'>) => {
    const s = nextSha();
    commits.set(s, { ...c, sha: s });
    return s;
  };
  const first = new Map([['wiki/Home.md', await put('# Home\n')], [PAGE, await put(FM + BODY)], ['wiki/Other.md', await put('# Other\n')]]);
  head = add({ parent: null, files: first, message: 'sync edits from obsidian', author: 'abucnasty', date: '2026-11-01T10:00:00Z', renames: [] });
  /** Another edit on main (as Obsidian or another editor would make it). */
  const commit = async (c: { author: string; date: string; message?: string; set?: Record<string, string>; remove?: string[]; rename?: { from: string; to: string } }) => {
    const files = new Map(commits.get(head)!.files);
    for (const p of c.remove ?? []) files.delete(p);
    if (c.rename) {
      files.set(c.rename.to, files.get(c.rename.from)!);
      files.delete(c.rename.from);
    }
    for (const [p, text] of Object.entries(c.set ?? {})) files.set(p, await put(text));
    head = add({ parent: head, files, message: c.message ?? 'sync edits from obsidian', author: c.author, date: c.date, renames: c.rename && !c.message?.includes('Wiki-Renamed-From') ? [c.rename] : [] });
    return head;
  };
  /** Run before main is moved by a save (another edit landing meanwhile). */
  const beforeMove: Array<() => Promise<unknown>> = [];
  const listing = (files: Map<string, string>) => {
    const out: Array<{ path: string; type: string; mode: string; sha: string }> = [];
    const dirs = new Set<string>();
    for (const [p, s] of files) {
      const rel = p.slice('wiki/'.length);
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      out.push({ path: rel, type: 'blob', mode: '100644', sha: s });
    }
    for (const d of dirs) out.push({ path: d, type: 'tree', mode: '040000', sha: 'd'.repeat(40) });
    return out;
  };
  const touched = (c: Commit, path: string) => (c.parent ? commits.get(c.parent)!.files.get(path) : undefined) !== c.files.get(path);
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const writes: string[] = [];
  async function github(method: string, path: string, body: any): Promise<Response> {
    const url = new URL(`https://x${path}`);
    if (method !== 'GET') writes.push(`${method} ${url.pathname}`);
    if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
    let m: RegExpExecArray | null;
    if ((m = /^\/git\/commits\/(\w+)$/.exec(path)) && method === 'GET') {
      const c = commits.get(m[1])!;
      return json({ tree: { sha: `root-${c.sha}` }, parents: c.parent ? [{ sha: c.parent }] : [], message: c.message, author: { name: c.author, date: c.date } });
    }
    if ((m = /^\/git\/trees\/root-(\w+)$/.exec(path))) return json({ tree: [{ path: 'wiki', type: 'tree', mode: '040000', sha: `wiki-${m[1]}` }] });
    if ((m = /^\/git\/trees\/wiki-(\w+)\?recursive=1$/.exec(path))) return json({ tree: listing(commits.get(m[1])!.files) });
    if ((m = /^\/git\/blobs\/(\w+)$/.exec(path)) && method === 'GET') {
      const text = blobs.get(m[1]);
      return text === undefined ? json({ message: 'Not Found' }, 404) : json({ content: Buffer.from(text).toString('base64'), encoding: 'base64' });
    }
    if (path === '/git/blobs') return json({ sha: await put(Buffer.from(body.content, 'base64').toString()) }, 201);
    if (path === '/git/trees') {
      const files = new Map(commits.get(body.base_tree.slice(5))!.files);
      for (const e of body.tree) (e.sha === null ? files.delete(e.path) : files.set(e.path, e.sha));
      const id = `tree-${trees.size}`;
      trees.set(id, files);
      return json({ sha: id }, 201);
    }
    if (path === '/git/commits') {
      return json({ sha: add({ parent: body.parents[0], files: trees.get(body.tree)!, message: body.message, author: body.author.name, date: body.author.date, renames: [] }) }, 201);
    }
    if (path === '/git/refs/heads/main') {
      for (const run of beforeMove.splice(0)) await run();
      if (commits.get(body.sha)!.parent !== head) return json({ message: 'Update is not a fast forward' }, 422);
      head = body.sha;
      return json({ object: { sha: head } });
    }
    if (url.pathname === '/commits') {
      const q = url.searchParams;
      const out = [];
      for (let c: Commit | undefined = commits.get(q.get('sha')!); c; c = c.parent ? commits.get(c.parent) : undefined) {
        if (touched(c, q.get('path')!)) out.push({ sha: c.sha, parents: c.parent ? [{ sha: c.parent }] : [], commit: { message: c.message, author: { name: c.author, date: c.date } } });
      }
      return json(out.slice(0, Number(q.get('per_page'))));
    }
    if ((m = /^\/commits\/(\w+)$/.exec(path))) {
      const c = commits.get(m[1])!;
      const before = c.parent ? commits.get(c.parent)!.files : new Map<string, string>();
      const files = [];
      for (const r of c.renames) files.push({ filename: r.to, status: 'renamed', previous_filename: r.from });
      const renamed = new Set(c.renames.flatMap((r) => [r.from, r.to]));
      for (const p of new Set([...before.keys(), ...c.files.keys()])) {
        if (renamed.has(p) || before.get(p) === c.files.get(p)) continue;
        files.push({ filename: p, status: !before.has(p) ? 'added' : !c.files.has(p) ? 'removed' : 'modified' });
      }
      return json({ files });
    }
    throw new Error(`unexpected ${method} ${path}`);
  }
  return { blobs, commits, commit, github, beforeMove, writes, head: () => head, file: (p: string) => blobs.get(commits.get(head)!.files.get(p) ?? '') ?? null };
}

async function setup(o: { roles?: () => string[]; readOnly?: boolean } = {}) {
  const v = await vault();
  const stamps: number[] = [];
  const announced: any[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    if (url === `https://discord.com/api/v10/guilds/${GUILD}/members/${USER}`) {
      return Response.json({ roles: (o.roles ?? (() => [ROLE]))(), nick: 'Buc the Editor', avatar: null, user: { id: USER, username: 'buc', global_name: 'Buc', avatar: null } });
    }
    if (url === `https://discord.com/api/v10/channels/${CHANNEL}/messages`) {
      announced.push(body);
      return Response.json({ id: '1' });
    }
    if (url === 'https://api.github.com/app/installations/2/access_tokens') return Response.json({ token: 't', expires_at: new Date(T0 + 3600_000).toISOString() }, { status: 201 });
    assert.ok(url.startsWith(REPO), url);
    return v.github(method, url.slice(REPO.length), body);
  };
  const env: WikiEnv = {
    SITE_URL: SITE,
    DISCORD_CLIENT_ID: '1572695514938613760',
    DISCORD_GUILD_ID: GUILD,
    WIKI_EDITOR_ROLE_ID: ROLE,
    WIKI_ANNOUNCE_CHANNEL_ID: CHANNEL,
    DISCORD_CLIENT_SECRET: 'client-secret-value',
    DISCORD_BOT_TOKEN: 'bot-token-value',
    WIKI_SESSION_SECRET: SECRET,
    WIKI_READ_ONLY: o.readOnly ? 'true' : undefined,
    GITHUB_APP_ID: '1',
    GITHUB_APP_INSTALLATION_ID: '2',
    GITHUB_APP_PRIVATE_KEY: KEY,
    VAULT_CATALOG: { get: async () => null },
    LFS_BUCKET: { head: async () => null, get: async () => null, put: async () => undefined },
  };
  const handle = createWikiApi(env, {
    fetch,
    cache: null,
    now: () => T0,
    log: () => {},
    tokens: new Map(),
    takeSlot: async () => {
      const r = takeSlot(stamps, T0);
      stamps.splice(0, stamps.length, ...r.stamps);
      return r.slot;
    },
  });
  const cookie = `${SESSION_COOKIE}=${await signSession({ sub: USER, name: 'buc', gname: 'Buc', avatar: null }, SECRET, T0)}`;
  const save = async (meta: Record<string, unknown>) => {
    const form = new FormData();
    form.set('save', JSON.stringify(meta));
    const res = await handle(new Request(`${SITE}/api/wiki/save`, { method: 'POST', body: form, headers: { Cookie: cookie, Origin: SITE } }));
    return { status: res.status, out: (await res.json()) as any };
  };
  /** What the editor read when it opened the page now. */
  const open = async () => {
    const res = await handle(new Request(`${SITE}/api/wiki/source?slug=how-to-benchmark`, { headers: { Cookie: cookie } }));
    return (await res.json()) as any;
  };
  const edit = (src: any, body: string, extra: object = {}) => ({ path: src.path, base: src.blob, head: src.head, frontmatter: src.frontmatter, body, draft: src.draft, summary: 'My edit', ...extra });
  return { v, save, open, edit, stamps, announced };
}

const replace = (text: string, from: string, to: string) => {
  assert.ok(text.includes(from), from);
  return text.replace(from, to);
};

test('merge: line-based three-way merge', () => {
  const base = 'a\nb\nc\nd\ne\n';
  assert.deepEqual(mergeText(base, 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n'), { clean: true, text: 'A\nb\nc\nd\nE\n', conflicts: 0 });
  assert.deepEqual(mergeText(base, 'a\nB\nc\nd\ne\n', 'a\nB\nc\nd\ne\n'), { clean: true, text: 'a\nB\nc\nd\ne\n', conflicts: 0 }, 'the same change on both sides');
  assert.deepEqual(mergeText(base, 'a\nX\nc\nd\ne\n', 'a\nY\nc\nd\ne\n'), { clean: false, text: 'a\nY\nc\nd\ne\n', conflicts: 1 }, 'overlapping: the editor\'s lines kept in `text`');
  assert.equal(mergeText(base, base, 'mine').text, 'mine');
  assert.equal(mergeText(base, 'theirs', base).text, 'theirs');
});

test('concurrent edits: theirs above, mine below are combined, named, and use a rate-limit slot', async () => {
  const t = await setup();
  const src = await t.open();
  await t.v.commit({ author: 'abucnasty', date: '2026-11-18T11:40:00Z', set: { [PAGE]: FM + replace(BODY, 'Intro line.', 'Intro line, from Obsidian.') } });
  const { status, out } = await t.save(t.edit(src, replace(src.body, 'Last line.', 'Last line, from the site.')));
  assert.equal(status, 200, JSON.stringify(out));
  const expected = replace(replace(BODY, 'Intro line.', 'Intro line, from Obsidian.'), 'Last line.', 'Last line, from the site.');
  assert.equal(t.v.file(PAGE), FM + expected);
  assert.equal(out.body, expected, 'the editor is given the combined text');
  assert.deepEqual(out.merged.edits, [{ author: 'abucnasty', date: '2026-11-18T11:40:00Z', summary: 'sync edits from obsidian' }]);
  assert.equal(out.draft, false);
  assert.equal(t.stamps.length, 1, 'a successful merge uses a slot');
  assert.equal(t.announced.length, 1, 'announced once');
  const c = t.v.commits.get(t.v.head())!;
  assert.equal(c.author, 'Buc the Editor');
  assert.equal(c.parent, [...t.v.commits.values()].find((x) => x.author === 'abucnasty' && x.parent)!.sha, 'on top of the other edit');
});

test('concurrent edits: the same change on both sides is no conflict', async () => {
  const t = await setup();
  const src = await t.open();
  const same = replace(BODY, 'Step one.', 'Step one, fixed.');
  await t.v.commit({ author: 'Other Editor', date: '2026-11-18T11:50:00Z', set: { [PAGE]: FM + same } });
  const only = await t.save(t.edit(src, same));
  assert.equal(only.status, 200, JSON.stringify(only.out));
  assert.equal(only.out.unchanged, true, 'nothing left to save');
  assert.equal(only.out.body, same);
  assert.equal(t.stamps.length, 0);
  // The same change and one of the editor's own: saved, combined.
  const more = await t.save(t.edit(src, replace(same, 'Last line.', 'Last line, mine.')));
  assert.equal(more.status, 200);
  assert.equal(t.v.file(PAGE), FM + replace(same, 'Last line.', 'Last line, mine.'));
  assert.equal(more.out.merged.edits[0].author, 'Other Editor');
});

test('concurrent edits: an overlap is a conflict with base, theirs (who, when) and mine; nothing written, no slot used', async () => {
  const t = await setup();
  const src = await t.open();
  const theirs = replace(replace(BODY, 'Step two.', 'Step two, theirs.'), 'Intro line.', 'Intro, theirs.');
  await t.v.commit({ author: 'Other Editor', date: '2026-11-18T11:55:00Z', message: 'Clarify step two\n\nWiki edit by Other Editor (Discord 1) via abucnasty.dev', set: { [PAGE]: FM + theirs } });
  const writes = t.v.writes.length;
  const mine = replace(replace(BODY, 'Step two.', 'Step two, mine.'), 'Last line.', 'Last line, mine.');
  const { status, out } = await t.save(t.edit(src, mine));
  assert.equal(status, 409);
  assert.equal(out.error, 'conflict');
  assert.match(out.message, /^Other Editor changed the same part of this page/);
  assert.deepEqual(out.base, { blob: src.blob, body: BODY });
  assert.equal(out.theirs.body, theirs);
  assert.equal(out.theirs.blob, await sha(FM + theirs));
  assert.equal(out.theirs.head, t.v.head());
  assert.equal(out.theirs.frontmatter, FM);
  assert.deepEqual(out.theirs.edits, [{ author: 'Other Editor', date: '2026-11-18T11:55:00Z', summary: 'Clarify step two' }]);
  assert.equal(out.mine.body, mine);
  assert.equal(out.mine.combined, replace(replace(BODY, 'Step two.', 'Step two, mine.'), 'Last line.', 'Last line, mine.').replace('Intro line.', 'Intro, theirs.'), 'their other changes already in');
  assert.equal(t.v.writes.length, writes, 'nothing written');
  assert.equal(t.stamps.length, 0, 'no rate-limit slot used');

  // The combined version, saved against their blob: a plain save.
  const combined = out.mine.combined.replace('Step two, mine.', 'Step two, both.');
  const again = await t.save({ path: out.path, base: out.theirs.blob, head: out.theirs.head, frontmatter: out.theirs.frontmatter, body: combined, draft: false, summary: 'Combined' });
  assert.equal(again.status, 200, JSON.stringify(again.out));
  assert.equal(again.out.merged, undefined);
  assert.equal(t.v.file(PAGE), FM + combined);
  assert.equal(t.stamps.length, 1);
});

test('concurrent edits: a third edit landing while combining is merged again', async () => {
  const t = await setup();
  const src = await t.open();
  await t.v.commit({ author: 'Other Editor', date: '2026-11-18T11:55:00Z', set: { [PAGE]: FM + replace(BODY, 'Step two.', 'Step two, theirs.') } });
  const { out } = await t.save(t.edit(src, replace(BODY, 'Step two.', 'Step two, mine.')));
  assert.equal(out.error, 'conflict');
  // A third edit, elsewhere on the page, while the editor chooses.
  const third = replace(out.theirs.body, 'Intro line.', 'Intro line, third.');
  await t.v.commit({ author: 'Third Person', date: '2026-11-18T11:58:00Z', set: { [PAGE]: FM + third } });
  const combined = out.mine.combined.replace('Step two, mine.', 'Step two, combined.');
  const again = await t.save({ path: out.path, base: out.theirs.blob, head: out.theirs.head, frontmatter: out.theirs.frontmatter, body: combined, draft: false, summary: 'Combined' });
  assert.equal(again.status, 200, JSON.stringify(again.out));
  assert.deepEqual(again.out.merged.edits.map((e: any) => e.author), ['Third Person'], 'only the edit since the conflict');
  assert.equal(t.v.file(PAGE), FM + replace(combined, 'Intro line.', 'Intro line, third.'));

  // The same while the save is under way: main moves between reading and committing.
  const u = await setup();
  const src2 = await u.open();
  u.v.beforeMove.push(() => u.v.commit({ author: 'Racer', date: '2026-11-18T11:59:00Z', set: { [PAGE]: FM + replace(BODY, 'Intro line.', 'Intro, racer.') } }));
  const raced = await u.save(u.edit(src2, replace(BODY, 'Last line.', 'Last, mine.')));
  assert.equal(raced.status, 200, JSON.stringify(raced.out));
  assert.equal(u.v.file(PAGE), FM + replace(replace(BODY, 'Intro line.', 'Intro, racer.'), 'Last line.', 'Last, mine.'));
  assert.equal(raced.out.merged.edits[0].author, 'Racer');
  assert.equal(u.stamps.length, 1, 'one slot for the save, retries included');
});

test('concurrent edits: frontmatter changed by others is kept; the Draft switch applies only when the editor changed it', async () => {
  const t = await setup();
  const src = await t.open();
  const fm2 = '---\naliases: [Benchmarking, Benchmarks]\ntags: [guide]\n---\n\n';
  await t.v.commit({ author: 'abucnasty', date: '2026-11-18T11:00:00Z', set: { [PAGE]: fm2 + BODY } });
  const mine = replace(BODY, 'Step one.', 'Step one, mine.');
  const kept = await t.save(t.edit(src, mine));
  assert.equal(kept.status, 200, JSON.stringify(kept.out));
  assert.equal(t.v.file(PAGE), fm2 + mine, 'their frontmatter, my body, no conflict');
  assert.equal(kept.out.frontmatter, fm2);

  // Switched to Draft while someone else changed the frontmatter: both.
  const d = await setup();
  const src2 = await d.open();
  await d.v.commit({ author: 'abucnasty', date: '2026-11-18T11:00:00Z', set: { [PAGE]: fm2 + replace(BODY, 'Intro line.', 'Intro, theirs.') } });
  const drafted = await d.save(d.edit(src2, mine, { draft: true }));
  assert.equal(drafted.status, 200);
  assert.equal(d.v.file(PAGE), `---\ndraft: true\naliases: [Benchmarking, Benchmarks]\ntags: [guide]\n---\n\n${replace(mine, 'Intro line.', 'Intro, theirs.')}`);
  assert.equal(drafted.out.draft, true);
  assert.equal(d.announced.length, 0, 'a draft is not announced');

  // Published by someone else meanwhile, the editor left the switch alone: it stays published.
  const p = await setup();
  await p.v.commit({ author: 'abucnasty', date: '2026-11-18T10:00:00Z', set: { [PAGE]: `---\ndraft: true\n---\n\n${BODY}` } });
  const src3 = await p.open();
  assert.equal(src3.draft, true);
  await p.v.commit({ author: 'abucnasty', date: '2026-11-18T11:00:00Z', set: { [PAGE]: BODY } });
  const left = await p.save(p.edit(src3, mine));
  assert.equal(left.status, 200);
  assert.equal(p.v.file(PAGE), mine);
  assert.equal(left.out.draft, false);
});

test('concurrent edits: renamed meanwhile, the edit is saved at the new path (site rename and Obsidian rename)', async () => {
  const NEW = 'wiki/Guides/Benchmarking Basics.md';
  for (const how of ['site', 'obsidian'] as const) {
    const t = await setup();
    const src = await t.open();
    if (how === 'site') {
      await t.v.commit({
        author: 'Other Editor',
        date: '2026-11-18T11:30:00Z',
        message: `Renamed How to Benchmark to Benchmarking Basics\n\nWiki edit by Other Editor (Discord 1) via abucnasty.dev\n\nWiki-Renamed-From: ${PAGE}`,
        remove: [PAGE],
        set: { [NEW]: '---\naliases: [Benchmarking, How to Benchmark]\n---\n\n' + BODY },
      });
    } else {
      await t.v.commit({ author: 'abucnasty', date: '2026-11-18T11:30:00Z', rename: { from: PAGE, to: NEW } });
    }
    const mine = replace(BODY, 'Step one.', 'Step one, mine.');
    const { status, out } = await t.save(t.edit(src, mine));
    assert.equal(status, 200, `${how}: ${JSON.stringify(out)}`);
    assert.equal(out.path, NEW);
    assert.equal(out.slug, 'benchmarking-basics');
    assert.equal(out.renamedFrom, PAGE);
    assert.equal(t.v.file(PAGE), null, `${how}: nothing at the old path`);
    assert.equal(t.v.file(NEW), (how === 'site' ? '---\naliases: [Benchmarking, How to Benchmark]\n---\n\n' : FM) + mine, how);
  }
});

test('concurrent edits: deleted meanwhile, 409 gone naming who; saved as a new page at the old path, or under a new title when it is taken', async () => {
  const t = await setup();
  const src = await t.open();
  await t.v.commit({ author: 'abucnasty', date: '2026-11-18T11:20:00Z', remove: [PAGE] });
  const mine = replace(BODY, 'Step one.', 'Step one, mine.');
  const { status, out } = await t.save(t.edit(src, mine));
  assert.equal(status, 409);
  assert.equal(out.error, 'gone');
  assert.equal(out.deleted.author, 'abucnasty');
  assert.deepEqual([out.title, out.folder], ['How to Benchmark', 'Guides']);
  assert.equal(t.stamps.length, 0);
  // "Save as a new page": a new page at the old path.
  const made = await t.save({ create: { title: out.title, folder: out.folder }, base: null, frontmatter: '', body: mine, draft: false });
  assert.equal(made.status, 200, JSON.stringify(made.out));
  assert.equal(t.v.file(PAGE), mine);

  // The title taken again meanwhile: refused, then saved under another title.
  const u = await setup();
  const src2 = await u.open();
  await u.v.commit({ author: 'abucnasty', date: '2026-11-18T11:20:00Z', remove: [PAGE], set: { 'wiki/How to Benchmark.md': '# Someone else\n' } });
  const gone = await u.save(u.edit(src2, mine));
  assert.equal(gone.out.error, 'gone');
  const taken = await u.save({ create: { title: gone.out.title, folder: gone.out.folder }, base: null, frontmatter: '', body: mine, draft: false });
  assert.equal(taken.status, 409);
  assert.equal(taken.out.error, 'exists');
  const other = await u.save({ create: { title: 'How to Benchmark (mine)', folder: gone.out.folder }, base: null, frontmatter: '', body: mine, draft: false });
  assert.equal(other.status, 200);
  assert.equal(u.v.file('wiki/Guides/How to Benchmark (mine).md'), mine);
});

test('concurrent edits: a lost role and the emergency stop still refuse before anything is read', async () => {
  let roles = [ROLE];
  const t = await setup({ roles: () => roles });
  const src = await t.open();
  await t.v.commit({ author: 'abucnasty', date: '2026-11-18T11:40:00Z', set: { [PAGE]: FM + replace(BODY, 'Intro line.', 'Intro, theirs.') } });
  roles = [];
  const writes = t.v.writes.length;
  const lost = await t.save(t.edit(src, replace(BODY, 'Last line.', 'Last, mine.')));
  assert.equal(lost.status, 403);
  assert.equal(lost.out.error, 'not_editor');
  assert.equal(t.v.writes.length, writes);

  const r = await setup({ readOnly: true });
  const stopped = await r.save({ path: PAGE, base: 'a'.repeat(40), frontmatter: FM, body: 'x\n', draft: false });
  assert.equal(stopped.status, 503);
  assert.equal(stopped.out.error, 'read_only');
  assert.equal(r.v.writes.length, 0);
});
