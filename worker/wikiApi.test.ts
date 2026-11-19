// The wiki's sign-in, editor check and drafts (wikiApi.ts, session.ts, discord.ts, bucBot.ts),
// with Discord, buc-bot (the BUC_BOT binding) and the R2 bucket stood in for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STALE_AFTER_MS } from './bucBot.ts';
import { avatarUrl } from './discord.ts';
import { fakeBucBot, type FakeBucBotOptions } from './fakeBucBot.ts';
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
import { createWikiApi, isDraftSlug, safeReturnPath, type WikiEnv } from './wikiApi.ts';

const SITE = 'https://abucnasty.dev';
const SECRET = 's'.repeat(48);
const GUILD = '1381752136450441266';
const USER = '80351110224678912';
const T0 = Date.UTC(2026, 10, 18, 12);

interface Discord {
  token?: () => Response;
  me?: () => Response;
}

function setup(bot: FakeBucBotOptions = {}, opts: { drafts?: Record<string, string>; secret?: string; discord?: Discord; noBinding?: boolean } = {}) {
  const discord = opts.discord ?? {};
  const rpc: Array<{ method: string; url: string; body?: any }> = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const logs: string[] = [];
  let now = T0;
  const objects = new Map(Object.entries(opts.drafts ?? {}));
  const reads: string[] = [];
  const env: WikiEnv = {
    SITE_URL: SITE,
    DISCORD_CLIENT_ID: '1572695514938613760',
    DISCORD_GUILD_ID: GUILD,
    DISCORD_CLIENT_SECRET: 'client-secret-value',
    BUC_BOT: opts.noBinding ? undefined : fakeBucBot(bot, rpc, () => now),
    WIKI_SESSION_SECRET: opts.secret ?? SECRET,
    VAULT_CATALOG: {
      async get(key) {
        reads.push(key);
        const v = objects.get(key);
        return v === undefined ? null : { text: async () => v };
      },
    },
  };
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === 'https://discord.com/api/v10/oauth2/token') return (discord.token ?? (() => Response.json({ access_token: 'user-access-token', token_type: 'Bearer' })))();
    if (url === 'https://discord.com/api/v10/users/@me') return (discord.me ?? (() => Response.json({ id: USER, username: 'buc', global_name: 'Buc', avatar: 'abcdef0123456789' })))();
    throw new Error(`unexpected fetch ${url}`);
  };
  const handle = createWikiApi(env, { fetch, cache: null, now: () => now, log: (m) => logs.push(m) });
  const req = (path: string, init: RequestInit & { cookies?: Record<string, string> } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookies) headers.set('Cookie', Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
    return handle(new Request(path.startsWith('https://') ? path : SITE + path, { ...init, headers }));
  };
  return { req, calls, rpc, logs, reads, tick: (ms: number) => (now += ms) };
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
  const t = setup();
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
  const t = setup();
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
  const t = setup();
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

  const bad = setup({}, { discord: { token: () => Response.json({ error: 'invalid_grant' }, { status: 400 }) } });
  const res = await bad.req('/api/wiki/auth/callback?code=used&state=the-state', { cookies: { [STATE_COOKIE]: st } });
  assert.equal(await outcome(res), '/wiki/x?wiki-signin=failed', 'Discord refused the code');
  assert.match(bad.logs.join(), /token exchange: HTTP 400/);
  const down = setup({}, { discord: { me: () => new Response('oops', { status: 502 }) } });
  assert.equal(await outcome(await down.req('/api/wiki/auth/callback?code=abc&state=the-state', { cookies: { [STATE_COOKIE]: st } })), '/wiki/x?wiki-signin=failed');
  // Nothing secret in the logs.
  assert.doesNotMatch([...bad.logs, ...down.logs].join(), /secret-value|user-access-token/);
});

test('me: signed out, editor (first sign-in until acknowledged), not an editor, and buc-bot unable to say', async () => {
  const out = setup();
  let res = await out.req('/api/wiki/me');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await j(res), { signedIn: false, editor: false, userId: null, displayName: null, avatarUrl: null });
  assert.equal(out.rpc.length, 0, 'signed out: the bot is not asked');
  // A forged or expired cookie is signed out, and cleared.
  res = await out.req('/api/wiki/me', { cookies: { [SESSION_COOKIE]: 'e30.AAAA' } });
  assert.equal((await j(res)).signedIn, false);
  assert.match(cookieOf(res, SESSION_COOKIE)!.line, /Max-Age=0/);

  const serverAvatar = `https://cdn.discordapp.com/guilds/${GUILD}/users/${USER}/avatars/0123456789abcdef.png?size=64`;
  const ed = setup({ displayName: 'Buc the Editor', avatarUrl: serverAvatar });
  const cookies = { [SESSION_COOKIE]: await session() };
  res = await ed.req('/api/wiki/me', { cookies });
  assert.deepEqual(await j(res), {
    signedIn: true,
    editor: true,
    userId: USER,
    displayName: 'Buc the Editor',
    avatarUrl: serverAvatar,
    firstSignIn: true,
    // No GitHub App in these tests: editing is not set up.
    editing: 'unavailable',
  });
  assert.deepEqual(ed.rpc[0], { method: 'RPC', url: 'buc-bot/wikiMember', body: USER });
  // Acknowledging: same-origin only, then not shown again for this user on this device.
  assert.equal((await ed.req('/api/wiki/ack', { method: 'POST', cookies, headers: { Origin: 'https://evil.example' } })).status, 403);
  const ack = await ed.req('/api/wiki/ack', { method: 'POST', cookies, headers: { Origin: SITE } });
  assert.equal(ack.status, 204);
  const ackCookie = cookieOf(ack, ACK_COOKIE)!;
  assert.match(ackCookie.line, /HttpOnly; Secure; SameSite=Lax/);
  res = await ed.req('/api/wiki/me', { cookies: { ...cookies, [ACK_COOKIE]: ackCookie.value } });
  assert.equal((await j(res)).firstSignIn, false);
  assert.equal(ed.rpc.length, 2, 'each request asks the bot (nothing cached)');

  // Not an editor (no role, or not in the server): their own name and default avatar.
  const plain = setup({ editor: () => false });
  assert.deepEqual(await j(await plain.req('/api/wiki/me', { cookies })), {
    signedIn: true,
    editor: false,
    userId: USER,
    displayName: 'Buc',
    avatarUrl: avatarUrl({ userId: USER, guildId: GUILD, memberAvatar: null, avatar: null }),
  });

  // The bot can't say: never synced, its list older than 2 hours, the call failing, a nonsense
  // answer, no binding. Never a yes, never a silent no.
  const cantSay: Array<[string, ReturnType<typeof setup>, RegExp]> = [
    ['never synced', setup({ syncedAt: () => null }), /never synced/],
    ['stale', setup({ syncedAt: () => T0 - STALE_AFTER_MS - 1000 }), /last synced the role 120 minutes ago/],
    ['binding error', setup({ wikiMember: () => Promise.reject(new Error('Worker "buc-bot" not found')) }), /buc-bot: Worker "buc-bot" not found/],
    ['bad answer', setup({ wikiMember: async () => ({ syncedAt: T0, member: { editor: true, displayName: 'x', avatarUrl: 'javascript:alert(1)' } }) as any }), /not an answer/],
    ['no binding', setup({}, { noBinding: true }), /BUC_BOT binding is missing/],
  ];
  for (const [why, t, logged] of cantSay) {
    res = await t.req('/api/wiki/me', { cookies });
    assert.equal(res.status, 503, why);
    const body = await j(res);
    assert.deepEqual([body.error, body.signedIn, body.editor], ['access_check_failed', true, undefined], why);
    assert.match(body.message, /Couldn't check your wiki access/);
    assert.ok(t.logs.some((l) => logged.test(l)), `${why}: ${t.logs.join(' | ')}`);
  }
  // Just inside the threshold is still an answer.
  assert.equal((await j(await setup({ syncedAt: () => T0 - STALE_AFTER_MS + 60_000 }).req('/api/wiki/me', { cookies }))).editor, true);
});

test('drafts: editors only, re-checked on each request, only drafts the index lists, never cached by browsers', async () => {
  const drafts = {
    'wiki-drafts/index.json': JSON.stringify({ schema: 1, pages: [{ slug: 'how-to-edit', title: 'How to Edit' }], files: [] }),
    'wiki-drafts/how-to-edit.md': '# Draft\n',
    'wiki-drafts/old-draft.md': 'published since',
  };
  let editor = true;
  const t = setup({ editor: () => editor }, { drafts });
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

  // The role taken away: refused on the next request.
  editor = false;
  res = await t.req('/api/wiki/drafts/how-to-edit.md', { cookies });
  assert.deepEqual([res.status, (await j(res)).error], [403, 'not_editor']);
  const stranger = setup({ editor: () => false }, { drafts });
  assert.equal((await stranger.req('/api/wiki/drafts/index.json', { cookies })).status, 403);
  const down = setup({ syncedAt: () => null }, { drafts });
  assert.equal((await down.req('/api/wiki/drafts/index.json', { cookies })).status, 503);
  // Before the vault publishes any drafts: an empty list.
  const none = setup();
  assert.deepEqual((await j(await none.req('/api/wiki/drafts/index.json', { cookies }))).pages, []);
});

test('logout: POST from the site only; clears the session', async () => {
  const t = setup();
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
  const t = setup({}, { secret: '' });
  const res = await t.req('/api/wiki/auth/login?return=/wiki/all');
  assert.equal(res.headers.get('Location'), '/wiki/all?wiki-signin=unavailable');
  assert.equal((await j(await t.req('/api/wiki/me', { cookies: { [SESSION_COOKIE]: await session() } }))).signedIn, false);
  assert.equal((await t.req('/api/wiki/drafts/index.json', { cookies: { [SESSION_COOKIE]: await session() } })).status, 401);
});
