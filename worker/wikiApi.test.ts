// The wiki's sign-in, editor check and drafts (wikiApi.ts, session.ts, discord.ts), with Discord,
// the cache and the R2 bucket stood in for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avatarUrl } from './discord.ts';
import {
  ACK_COOKIE,
  SESSION_COOKIE,
  SESSION_SECONDS,
  STATE_COOKIE,
  signAck,
  signSession,
  signState,
  verifySession,
  verifyState,
} from './session.ts';
import { createWikiApi, isDraftSlug, safeReturnPath, type AccessCache, type WikiEnv } from './wikiApi.ts';

const SITE = 'https://abucnasty.dev';
const SECRET = 's'.repeat(48);
const GUILD = '1381752136450441266';
const ROLE = '1572672305019101214';
const USER = '80351110224678912';
const T0 = Date.UTC(2026, 10, 18, 12);

interface Discord {
  /** What GET /guilds/{guild}/members/{user} answers. */
  member: () => Response;
  token?: () => Response;
  me?: () => Response;
}

const member = (roles: string[], extra: object = {}) =>
  Response.json({ roles, nick: null, avatar: null, user: { id: USER, username: 'buc', global_name: 'Buc', avatar: null }, ...extra });
const notMember = () => Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });

function setup(discord: Discord, opts: { drafts?: Record<string, string>; secret?: string } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const logs: string[] = [];
  let now = T0;
  const objects = new Map(Object.entries(opts.drafts ?? {}));
  const reads: string[] = [];
  const env: WikiEnv = {
    SITE_URL: SITE,
    DISCORD_CLIENT_ID: '1572695514938613760',
    DISCORD_GUILD_ID: GUILD,
    WIKI_EDITOR_ROLE_ID: ROLE,
    DISCORD_CLIENT_SECRET: 'client-secret-value',
    DISCORD_BOT_TOKEN: 'bot-token-value',
    WIKI_SESSION_SECRET: opts.secret ?? SECRET,
    VAULT_CATALOG: {
      async get(key) {
        reads.push(key);
        const v = objects.get(key);
        return v === undefined ? null : { text: async () => v };
      },
    },
  };
  const store = new Map<string, string>();
  const cache: AccessCache = {
    async match(key) {
      const v = store.get(key);
      return v === undefined ? undefined : new Response(v);
    },
    async put(key, res) {
      store.set(key, await res.text());
    },
  };
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === 'https://discord.com/api/v10/oauth2/token') return (discord.token ?? (() => Response.json({ access_token: 'user-access-token', token_type: 'Bearer' })))();
    if (url === 'https://discord.com/api/v10/users/@me') return (discord.me ?? (() => Response.json({ id: USER, username: 'buc', global_name: 'Buc', avatar: 'abcdef0123456789' })))();
    if (url === `https://discord.com/api/v10/guilds/${GUILD}/members/${USER}`) return discord.member();
    throw new Error(`unexpected fetch ${url}`);
  };
  const handle = createWikiApi(env, { fetch, cache, now: () => now, log: (m) => logs.push(m) });
  const req = (path: string, init: RequestInit & { cookies?: Record<string, string> } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookies) headers.set('Cookie', Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
    return handle(new Request(path.startsWith('https://') ? path : SITE + path, { ...init, headers }));
  };
  return { req, calls, logs, store, reads, tick: (ms: number) => (now += ms), clearCache: () => store.clear() };
}

const session = (nowMs = T0) => signSession({ sub: USER, name: 'buc', gname: 'Buc', avatar: null }, SECRET, nowMs);
const j = async (res: Response) => (await res.json()) as any;
const cookieOf = (res: Response, name: string) => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line === undefined ? undefined : { value: line.slice(name.length + 1, line.indexOf(';')), line };
};

test('session: sign, verify, expiry, tampering, wrong secret, and one cookie kind cannot pass for another', async () => {
  const value = await session();
  const s = await verifySession(value, SECRET, T0 + 1000);
  assert.deepEqual(s && [s.sub, s.name, s.exp - s.iat], [USER, 'buc', SESSION_SECONDS]);
  assert.equal(await verifySession(value, SECRET, T0 + SESSION_SECONDS * 1000 + 1000), null, 'expired after 30 days');
  assert.equal(await verifySession(value, 'x'.repeat(48), T0), null, 'another secret');
  const [body, mac] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: '1' })).toString('base64url');
  assert.equal(await verifySession(`${forged}.${mac}`, SECRET, T0), null, 'changed payload');
  assert.equal(await verifySession(`${body}.${mac.slice(0, -2)}AA`, SECRET, T0), null, 'changed signature');
  assert.equal(await verifySession(`${body}`, SECRET, T0), null);
  assert.equal(await verifySession('', SECRET, T0), null);
  // A state or ack cookie, validly signed, is not a session.
  assert.equal(await verifySession(await signState('x', '/wiki', SECRET, T0), SECRET, T0), null);
  assert.equal(await verifySession(await signAck(USER, SECRET, T0), SECRET, T0), null);
});

test('return paths: only same-site paths outside /api/', () => {
  assert.equal(safeReturnPath('/wiki/how-to-benchmark?x=1#tips', SITE), '/wiki/how-to-benchmark?x=1#tips');
  assert.equal(safeReturnPath('/wiki/../blog', SITE), '/blog');
  for (const bad of ['https://evil.example/', '//evil.example/x', '/\\evil.example', '\\\\evil', 'wiki', '/wiki\n', 'javascript:alert(1)', '/api/wiki/auth/logout', '/api', '', null, `/${'a'.repeat(1100)}`]) {
    assert.equal(safeReturnPath(bad, SITE), null, String(bad));
  }
  assert.ok(isDraftSlug('how-to-edit') && isDraftSlug('über-2') && !isDraftSlug('../x') && !isDraftSlug('A') && !isDraftSlug('a--b') && !isDraftSlug(''));
});

test('login: a state cookie bound to the request, then Discord with identify only and the registered redirect', async () => {
  const t = setup({ member: () => member([ROLE]) });
  const res = await t.req('/api/wiki/auth/login?return=%2Fwiki%2Fall');
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('Location')!);
  assert.equal(`${to.origin}${to.pathname}`, 'https://discord.com/oauth2/authorize');
  assert.equal(to.searchParams.get('scope'), 'identify');
  assert.equal(to.searchParams.get('response_type'), 'code');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://abucnasty.dev/api/wiki/auth/callback');
  const c = cookieOf(res, STATE_COOKIE)!;
  assert.match(c.line, /Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  const st = await verifyState(c.value, SECRET, T0);
  assert.deepEqual([st?.state, st?.ret], [to.searchParams.get('state'), '/wiki/all']);
  // A return path off the site falls back to /wiki.
  const off = await t.req('/api/wiki/auth/login?return=https%3A%2F%2Fevil.example');
  assert.equal((await verifyState(cookieOf(off, STATE_COOKIE)!.value, SECRET, T0))?.ret, '/wiki');
  // From another host (the workers.dev preview), first to SITE_URL so the cookie lands there.
  const preview = await t.req('https://abucnasty-dev.example.workers.dev/api/wiki/auth/login?return=/wiki');
  assert.deepEqual([preview.status, preview.headers.get('Location'), cookieOf(preview, STATE_COOKIE)], [302, `${SITE}/api/wiki/auth/login?return=/wiki`, undefined]);
});

test('callback: happy path sets a 30-day session, drops the token, clears the state and returns', async () => {
  const t = setup({ member: () => member([ROLE]) });
  const login = await t.req('/api/wiki/auth/login?return=/wiki/all');
  const state = new URL(login.headers.get('Location')!).searchParams.get('state')!;
  const stateCookie = cookieOf(login, STATE_COOKIE)!.value;
  const res = await t.req(`/api/wiki/auth/callback?code=abc&state=${encodeURIComponent(state)}&iss=https%3A%2F%2Fdiscord.com`, { cookies: { [STATE_COOKIE]: stateCookie } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/wiki/all');
  assert.match(cookieOf(res, STATE_COOKIE)!.line, /Max-Age=0/);
  const s = cookieOf(res, SESSION_COOKIE)!;
  assert.match(s.line, /^__Host-wiki-session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal((await verifySession(s.value, SECRET, T0))?.sub, USER);
  assert.doesNotMatch(s.value + res.headers.get('Location'), /user-access-token/);
  // The code was exchanged with client credentials by Basic auth, form-encoded, with the same redirect_uri.
  const token = t.calls[0];
  assert.equal(token.init?.method, 'POST');
  const h = token.init?.headers as Record<string, string>;
  assert.equal(h['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(h.Authorization, `Basic ${btoa('1572695514938613760:client-secret-value')}`);
  assert.match(h['User-Agent'], /^DiscordBot \(/);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(token.init?.body))), {
    grant_type: 'authorization_code',
    code: 'abc',
    redirect_uri: 'https://abucnasty.dev/api/wiki/auth/callback',
  });
  assert.equal((t.calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer user-access-token');
});

test('callback: failures sign nobody in and say why on the return page', async () => {
  const t = setup({ member: () => member([ROLE]) });
  const st = await signState('the-state', '/wiki/x', SECRET, T0);
  const cb = (q: string, cookies: Record<string, string> = { [STATE_COOKIE]: st }) => t.req(`/api/wiki/auth/callback?${q}`, { cookies });
  const outcome = async (res: Response) => {
    assert.equal(res.status, 302);
    assert.equal(cookieOf(res, SESSION_COOKIE), undefined, 'no session cookie');
    return res.headers.get('Location');
  };
  assert.equal(await outcome(await cb('code=abc&state=the-state', {})), '/wiki?wiki-signin=expired', 'no state cookie');
  assert.equal(await outcome(await cb('code=abc&state=other')), '/wiki/x?wiki-signin=failed', 'state mismatch');
  assert.equal(await outcome(await cb('code=abc')), '/wiki/x?wiki-signin=failed', 'no state');
  assert.equal(await outcome(await cb('code=abc&state=the-state&iss=https%3A%2F%2Fevil.example')), '/wiki/x?wiki-signin=failed', 'other issuer');
  assert.equal(await outcome(await cb('error=access_denied&state=the-state')), '/wiki/x?wiki-signin=cancelled');
  t.tick(11 * 60 * 1000);
  assert.equal(await outcome(await cb('code=abc&state=the-state')), '/wiki?wiki-signin=expired', 'state older than 10 minutes');
  assert.equal(t.calls.length, 0, 'Discord was never asked');

  const bad = setup({ member: () => member([ROLE]), token: () => Response.json({ error: 'invalid_grant' }, { status: 400 }) });
  const res = await bad.req('/api/wiki/auth/callback?code=used&state=the-state', { cookies: { [STATE_COOKIE]: st } });
  assert.equal(await outcome(res), '/wiki/x?wiki-signin=failed', 'Discord refused the code');
  assert.match(bad.logs.join(), /token exchange: HTTP 400/);
  const down = setup({ member: () => member([ROLE]), me: () => new Response('oops', { status: 502 }) });
  assert.equal(await outcome(await down.req('/api/wiki/auth/callback?code=abc&state=the-state', { cookies: { [STATE_COOKIE]: st } })), '/wiki/x?wiki-signin=failed');
  // Nothing secret in the logs.
  assert.doesNotMatch([...bad.logs, ...down.logs].join(), /secret-value|token-value|user-access-token/);
});

test('me: signed out, editor (first sign-in until acknowledged), no role, not in the server, Discord failing', async () => {
  const out = setup({ member: () => member([ROLE]) });
  let res = await out.req('/api/wiki/me');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await j(res), { signedIn: false, editor: false, userId: null, displayName: null, avatarUrl: null });
  // A forged or expired cookie is signed out, and cleared.
  res = await out.req('/api/wiki/me', { cookies: { [SESSION_COOKIE]: 'e30.AAAA' } });
  assert.equal((await j(res)).signedIn, false);
  assert.match(cookieOf(res, SESSION_COOKIE)!.line, /Max-Age=0/);

  const ed = setup({ member: () => member([ROLE, '1'], { nick: 'Buc the Editor' }) });
  const cookies = { [SESSION_COOKIE]: await session() };
  res = await ed.req('/api/wiki/me', { cookies });
  assert.deepEqual(await j(res), {
    signedIn: true,
    editor: true,
    userId: USER,
    displayName: 'Buc the Editor',
    avatarUrl: avatarUrl({ userId: USER, guildId: GUILD, memberAvatar: null, avatar: null }),
    firstSignIn: true,
    // No GitHub App in these tests: editing is not set up.
    editing: 'unavailable',
  });
  const member0 = ed.calls[0];
  assert.equal((member0.init?.headers as Record<string, string>).Authorization, 'Bot bot-token-value');
  // Acknowledging: same-origin only, then not shown again for this user on this device.
  assert.equal((await ed.req('/api/wiki/ack', { method: 'POST', cookies, headers: { Origin: 'https://evil.example' } })).status, 403);
  const ack = await ed.req('/api/wiki/ack', { method: 'POST', cookies, headers: { Origin: SITE } });
  assert.equal(ack.status, 204);
  const ackCookie = cookieOf(ack, ACK_COOKIE)!;
  assert.match(ackCookie.line, /HttpOnly; Secure; SameSite=Lax/);
  res = await ed.req('/api/wiki/me', { cookies: { ...cookies, [ACK_COOKIE]: ackCookie.value } });
  assert.equal((await j(res)).firstSignIn, false);
  assert.equal(ed.calls.length, 1, 'the second me used the cached role check');

  const plain = setup({ member: () => member(['1']) });
  assert.deepEqual(await j(await plain.req('/api/wiki/me', { cookies })), {
    signedIn: true,
    editor: false,
    userId: USER,
    displayName: 'Buc',
    avatarUrl: avatarUrl({ userId: USER, guildId: GUILD, memberAvatar: null, avatar: null }),
  });
  const stranger = setup({ member: notMember });
  const s = await j(await stranger.req('/api/wiki/me', { cookies }));
  assert.deepEqual([s.signedIn, s.editor, s.displayName], [true, false, 'Buc']);

  for (const failing of [() => new Response('{}', { status: 500 }), () => Response.json({ message: 'rate limited', retry_after: 2 }, { status: 429 }), () => Response.json({ code: 10004 }, { status: 404 })]) {
    const t = setup({ member: failing });
    res = await t.req('/api/wiki/me', { cookies });
    assert.equal(res.status, 503);
    const body = await j(res);
    assert.deepEqual([body.error, body.signedIn, body.editor], ['access_check_failed', true, undefined]);
    assert.match(body.message, /Couldn't check your wiki access/);
    assert.equal(t.store.size, 0, 'a failed check is not cached');
  }
  const thrown = setup({ member: () => { throw new TypeError('network'); } });
  assert.equal((await thrown.req('/api/wiki/me', { cookies })).status, 503);
});

test('drafts: editors only, re-checked (cached a few minutes), only drafts the index lists, never cached by browsers', async () => {
  const drafts = {
    'wiki-drafts/index.json': JSON.stringify({ schema: 1, pages: [{ slug: 'how-to-edit', title: 'How to Edit' }], files: [] }),
    'wiki-drafts/how-to-edit.md': '# Draft\n',
    'wiki-drafts/old-draft.md': 'published since',
  };
  let roles = [ROLE];
  const t = setup({ member: () => member(roles) }, { drafts });
  const cookies = { [SESSION_COOKIE]: await session() };
  assert.equal((await t.req('/api/wiki/drafts/index.json')).status, 401);
  let res = await t.req('/api/wiki/drafts/index.json', { cookies });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await j(res)).pages[0].slug, 'how-to-edit');
  res = await t.req('/api/wiki/drafts/how-to-edit.md', { cookies });
  assert.deepEqual([res.status, await res.text()], [200, '# Draft\n']);
  assert.equal((await t.req('/api/wiki/drafts/old-draft.md', { cookies })).status, 404);
  assert.equal((await t.req('/api/wiki/drafts/..%2Fwiki%2Findex.md', { cookies })).status, 404);
  assert.equal((await t.req('/api/wiki/drafts/how-to-edit.md', { cookies, method: 'POST' })).status, 405);
  assert.ok(t.reads.every((k) => k.startsWith('wiki-drafts/')), t.reads.join());

  // The role taken away: refused once the cached answer is gone.
  roles = ['1'];
  t.clearCache();
  res = await t.req('/api/wiki/drafts/how-to-edit.md', { cookies });
  assert.deepEqual([res.status, (await j(res)).error], [403, 'not_editor']);
  const stranger = setup({ member: notMember }, { drafts });
  assert.equal((await stranger.req('/api/wiki/drafts/index.json', { cookies })).status, 403);
  const down = setup({ member: () => new Response('', { status: 503 }) }, { drafts });
  assert.equal((await down.req('/api/wiki/drafts/index.json', { cookies })).status, 503);
  // Before the vault publishes any drafts: an empty list.
  const none = setup({ member: () => member([ROLE]) });
  assert.deepEqual((await j(await none.req('/api/wiki/drafts/index.json', { cookies }))).pages, []);
});

test('logout: POST from the site only; clears the session', async () => {
  const t = setup({ member: () => member([ROLE]) });
  assert.equal((await t.req('/api/wiki/auth/logout')).status, 405);
  assert.equal((await t.req('/api/wiki/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await t.req('/api/wiki/auth/logout', { method: 'POST' })).status, 403, 'no Origin and no Sec-Fetch-Site');
  for (const headers of [{ Origin: SITE }, { 'Sec-Fetch-Site': 'same-origin' }] as Record<string, string>[]) {
    const res = await t.req('/api/wiki/auth/logout', { method: 'POST', headers });
    assert.equal(res.status, 204);
    assert.match(cookieOf(res, SESSION_COOKIE)!.line, /^__Host-wiki-session=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  }
});

test('not configured: no session secret means nobody is signed in and sign-in says unavailable', async () => {
  const t = setup({ member: () => member([ROLE]) }, { secret: '' });
  const res = await t.req('/api/wiki/auth/login?return=/wiki/all');
  assert.equal(res.headers.get('Location'), '/wiki/all?wiki-signin=unavailable');
  assert.equal((await j(await t.req('/api/wiki/me', { cookies: { [SESSION_COOKIE]: await session() } }))).signedIn, false);
  assert.equal((await t.req('/api/wiki/drafts/index.json', { cookies: { [SESSION_COOKIE]: await session() } })).status, 401);
});
