// /api/wiki/...: sign-in with Discord, who is a wiki editor, and the draft pages editors see.
//
//   GET  /api/wiki/auth/login[?return=<path>]  start a sign-in: a `state` cookie, then Discord's authorize page
//   GET  /api/wiki/auth/callback               Discord's redirect: check `state`, exchange the code, set the session
//   POST /api/wiki/auth/logout                 clear the session (same-origin requests only)
//   GET  /api/wiki/me                          who is signed in and whether they are an editor (no-store)
//   POST /api/wiki/ack                         an editor has read the first-sign-in notice (same-origin only)
//   GET  /api/wiki/drafts/index.json           the drafts index (editors only)
//   GET  /api/wiki/drafts/<slug>.md            a draft's markdown (editors only)
//   GET  /api/wiki/source?slug=<slug>          a page's file on the vault's main branch, to edit (editors only)
//   POST /api/wiki/save                        save a page and its new images (editors only, same-origin;
//                                              the role is looked up live, never cached; see wikiSave.ts)
//   GET  /api/wiki/image/<oid>                 an image just saved, from the LFS bucket, until the vault
//                                              publishes it (editors only)
//
// Sessions are signed cookies (session.ts), 30 days per device, with no server-side store. The
// Discord access token is used once in the callback (to read who signed in) and then dropped.
// An editor is a member of DISCORD_GUILD_ID holding WIKI_EDITOR_ROLE_ID, looked up with the bot
// token (discord.ts) on each request that needs it; reads (`me`, drafts) may use an answer up to
// ACCESS_CACHE_SECONDS old; a save always asks Discord (access() with cached=false). When Discord
// cannot answer, the answer is a 503 "couldn't check", never a yes and never a silent no.
//
// Everything outside Workers globals is passed in (fetch, a cache, the bucket, the clock), so the
// whole flow is unit-tested under Node (wikiApi.test.ts).
import {
  avatarUrl,
  authorizeUrl,
  currentUser,
  DISCORD_ISSUER,
  displayName,
  exchangeCode,
  guildMember,
  type Fetch,
} from './discord.ts';
import {
  ACK_COOKIE,
  ACK_SECONDS,
  readCookies,
  randomState,
  sameString,
  SESSION_COOKIE,
  SESSION_SECONDS,
  setCookie,
  signAck,
  signSession,
  signState,
  STATE_COOKIE,
  STATE_SECONDS,
  usableSecret,
  verifyAck,
  verifySession,
  verifyState,
  type Session,
} from './session.ts';
import { editingState, lfsKey, readSource, save, type EditingState, type SaveDeps, type SaveEnv } from './wikiSave.ts';

export const WIKI_API = '/api/wiki/';
/** R2 keys of the drafts in the catalog bucket (written by the vault's CI; the vault host never serves them). */
export const DRAFTS_INDEX_KEY = 'wiki-drafts/index.json';
const draftKey = (slug: string) => `wiki-drafts/${slug}.md`;
export const ACCESS_CACHE_SECONDS = 300;
const DEFAULT_RETURN = '/wiki';
/** Query parameter the site reads after a sign-in that did not complete (see src/wikiAuth.ts). */
export const SIGNIN_PARAM = 'wiki-signin';

/** The bindings and vars this file reads (a subset of Env, so tests can build one). */
export interface WikiEnv extends SaveEnv {
  SITE_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_GUILD_ID: string;
  WIKI_EDITOR_ROLE_ID: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  WIKI_SESSION_SECRET?: string;
  VAULT_CATALOG: { get(key: string): Promise<{ text(): Promise<string> } | null> };
}

export interface AccessCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

export interface WikiDeps {
  fetch: Fetch;
  cache: AccessCache | null;
  now: () => number;
  log?: (message: string) => void;
  /** For saving (wikiSave.ts): GitHub installation tokens kept between requests, the rate limit, ctx.waitUntil. */
  tokens?: SaveDeps['tokens'];
  takeSlot?: SaveDeps['takeSlot'];
  waitUntil?: SaveDeps['waitUntil'];
}

/** What `me` answers. No secrets: ids, a name and a CDN URL. */
export interface Me {
  signedIn: boolean;
  editor: boolean;
  userId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Editors only: true until they have acknowledged the first-sign-in notice on this device. */
  firstSignIn?: boolean;
  /** Editors only: whether saving works now ("read-only": paused; "unavailable": not set up). */
  editing?: EditingState;
}

/** A user's access, as the role check found it. */
export interface Access {
  editor: boolean;
  member: boolean;
  displayName: string;
  avatarUrl: string;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const PRIVATE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };

function json(status: number, body: unknown, headers: Record<string, string> = NO_STORE): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

const failure = (status: number, error: string, message: string, extra: object = {}, headers = NO_STORE) =>
  json(status, { error, message, ...extra }, headers);

const CHECK_FAILED = "Couldn't check your wiki access with Discord. Try again in a minute.";

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/**
 * A `return` value that is safe to redirect to: a path on this site (not /api/), as
 * `/path?query#hash`. Anything else (absolute URLs, `//host`, backslashes, control characters,
 * over-long values) is null.
 */
export function safeReturnPath(raw: string | null | undefined, siteUrl: string): string | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > 1024) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const origin = new URL(siteUrl).origin;
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return null;
  }
  if (u.origin !== origin || u.pathname === '/api' || u.pathname.startsWith('/api/')) return null;
  return `${u.pathname}${u.search}${u.hash}`;
}

/** `path` with `?wiki-signin=<outcome>` added, for a sign-in that did not complete. */
function withOutcome(path: string, outcome: string, siteUrl: string): string {
  const u = new URL(path, new URL(siteUrl).origin);
  u.searchParams.set(SIGNIN_PARAM, outcome);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** A wiki address's slug as the vault makes them: lowercase letters and digits in runs joined by "-". */
export function isDraftSlug(slug: string): boolean {
  return slug.length <= 200 && /^[\p{Ll}\p{Lo}\p{Lm}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{Lm}\p{N}]+)*$/u.test(slug);
}

/**
 * A state-changing request from this site's own pages: its Origin is this origin, or, when a
 * browser sends no Origin, Sec-Fetch-Site says same-origin. With SameSite=Lax cookies this stops
 * cross-site forms and scripts.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

const redirectUri = (env: WikiEnv) => `${env.SITE_URL.replace(/\/+$/, '')}/api/wiki/auth/callback`;

export function createWikiApi(env: WikiEnv, deps: WikiDeps) {
  const log = deps.log ?? ((m: string) => console.error(m));
  const secret = usableSecret(env.WIKI_SESSION_SECRET) ? env.WIKI_SESSION_SECRET : null;
  const signInConfigured = secret !== null && !!env.DISCORD_CLIENT_SECRET && !!env.DISCORD_CLIENT_ID;

  async function sessionOf(request: Request): Promise<{ session: Session | null; stale: boolean }> {
    const raw = readCookies(request.headers.get('Cookie')).get(SESSION_COOKIE);
    // Without a secret nobody is signed in, but cookies are left alone until it is back.
    if (!raw || !secret) return { session: null, stale: false };
    const session = await verifySession(raw, secret, deps.now());
    return { session, stale: !session };
  }

  /**
   * Whether the session's user is an editor, from Discord (or, with `cached`, an answer at most
   * ACCESS_CACHE_SECONDS old). Null when Discord could not say.
   */
  async function access(session: Session, cached: boolean): Promise<Access | null> {
    const key = `${new URL(env.SITE_URL).origin}/api/wiki/__access/${session.sub}`;
    if (cached && deps.cache) {
      const hit = await deps.cache.match(key).catch(() => undefined);
      if (hit) {
        const a = (await hit.json().catch(() => null)) as Access | null;
        if (a && typeof a.editor === 'boolean') return a;
      }
    }
    if (!env.DISCORD_BOT_TOKEN) {
      log('wiki access: DISCORD_BOT_TOKEN is not set');
      return null;
    }
    const m = await guildMember(deps.fetch, { botToken: env.DISCORD_BOT_TOKEN, guildId: env.DISCORD_GUILD_ID, userId: session.sub });
    if (m.kind === 'error') {
      log(`wiki access: ${m.reason}`);
      return null;
    }
    const profile = { username: session.name, global_name: session.gname };
    let result: Access;
    if (m.kind === 'not-member') {
      result = {
        editor: false,
        member: false,
        displayName: displayName(null, profile),
        avatarUrl: avatarUrl({ userId: session.sub, guildId: env.DISCORD_GUILD_ID, memberAvatar: null, avatar: session.avatar }),
      };
    } else {
      const user = m.user ?? { ...profile, avatar: session.avatar };
      result = {
        editor: m.roles.includes(env.WIKI_EDITOR_ROLE_ID),
        member: true,
        displayName: displayName(m.nick, user),
        avatarUrl: avatarUrl({ userId: session.sub, guildId: env.DISCORD_GUILD_ID, memberAvatar: m.memberAvatar, avatar: user.avatar }),
      };
    }
    if (deps.cache) {
      const res = new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ACCESS_CACHE_SECONDS}` } });
      await deps.cache.put(key, res).catch(() => {});
    }
    return result;
  }

  async function login(url: URL): Promise<Response> {
    const site = new URL(env.SITE_URL);
    // The callback is on SITE_URL, so the state cookie must be set there too.
    if (url.origin !== site.origin) return redirect(`${site.origin}${url.pathname}${url.search}`);
    const ret = safeReturnPath(url.searchParams.get('return'), env.SITE_URL) ?? DEFAULT_RETURN;
    if (!signInConfigured || !secret) {
      log('wiki sign-in: DISCORD_CLIENT_SECRET or WIKI_SESSION_SECRET is not set');
      return redirect(withOutcome(ret, 'unavailable', env.SITE_URL));
    }
    const state = randomState();
    const cookie = await signState(state, ret, secret, deps.now());
    return redirect(authorizeUrl(env.DISCORD_CLIENT_ID, redirectUri(env), state), [setCookie(STATE_COOKIE, cookie, STATE_SECONDS)]);
  }

  async function callback(request: Request, url: URL): Promise<Response> {
    const clearState = setCookie(STATE_COOKIE, '', 0);
    const fail = (ret: string, outcome: string, why: string) => {
      log(`wiki sign-in: ${why}`);
      return redirect(withOutcome(ret, outcome, env.SITE_URL), [clearState]);
    };
    if (!signInConfigured || !secret) return fail(DEFAULT_RETURN, 'unavailable', 'not configured');
    const st = await verifyState(readCookies(request.headers.get('Cookie')).get(STATE_COOKIE), secret, deps.now());
    // No (valid) state cookie: started elsewhere, too long ago, or a forged callback.
    if (!st) return fail(DEFAULT_RETURN, 'expired', 'no valid state cookie');
    const ret = safeReturnPath(st.ret, env.SITE_URL) ?? DEFAULT_RETURN;
    const q = url.searchParams;
    if (!sameString(q.get('state') ?? '', st.state)) return fail(ret, 'failed', 'state does not match');
    const iss = q.get('iss');
    if (iss !== null && iss !== DISCORD_ISSUER) return fail(ret, 'failed', 'unexpected iss');
    const error = q.get('error');
    if (error !== null) return fail(ret, error === 'access_denied' ? 'cancelled' : 'failed', `Discord answered error=${error.slice(0, 64)}`);
    const code = q.get('code');
    if (!code || code.length > 512) return fail(ret, 'failed', 'no code');

    let user;
    try {
      const token = await exchangeCode(deps.fetch, {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET!,
        code,
        redirectUri: redirectUri(env),
      });
      user = await currentUser(deps.fetch, token);
      // The token goes out of scope here: it is not stored anywhere.
    } catch (err) {
      return fail(ret, 'failed', err instanceof Error ? err.message : String(err));
    }
    const session = await signSession({ sub: user.id, name: user.username, gname: user.global_name, avatar: user.avatar }, secret, deps.now());
    return redirect(ret, [clearState, setCookie(SESSION_COOKIE, session, SESSION_SECONDS)]);
  }

  function logout(request: Request): Response {
    if (!sameOrigin(request)) return failure(403, 'cross_origin', 'Sign out from the site itself.');
    const headers = new Headers(NO_STORE);
    headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0));
    return new Response(null, { status: 204, headers });
  }

  async function me(request: Request): Promise<Response> {
    const { session, stale } = await sessionOf(request);
    const headers: Record<string, string> = { ...NO_STORE };
    if (!session) {
      const out: Me = { signedIn: false, editor: false, userId: null, displayName: null, avatarUrl: null };
      const res = json(200, out, headers);
      if (stale) res.headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0));
      return res;
    }
    const a = await access(session, true);
    if (!a) {
      return failure(503, 'access_check_failed', CHECK_FAILED, {
        signedIn: true,
        userId: session.sub,
        displayName: displayName(null, { username: session.name, global_name: session.gname }),
        avatarUrl: avatarUrl({ userId: session.sub, guildId: env.DISCORD_GUILD_ID, memberAvatar: null, avatar: session.avatar }),
      });
    }
    const out: Me = { signedIn: true, editor: a.editor, userId: session.sub, displayName: a.displayName, avatarUrl: a.avatarUrl };
    if (a.editor) {
      out.editing = editingState(env);
      const ack = await verifyAck(readCookies(request.headers.get('Cookie')).get(ACK_COOKIE), secret!, deps.now());
      out.firstSignIn = ack?.sub !== session.sub;
    }
    return json(200, out, headers);
  }

  async function acknowledge(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return failure(403, 'cross_origin', 'Acknowledge from the site itself.');
    const { session } = await sessionOf(request);
    if (!session) return failure(401, 'signed_out', 'Sign in first.');
    const headers = new Headers(NO_STORE);
    headers.append('Set-Cookie', setCookie(ACK_COOKIE, await signAck(session.sub, secret!, deps.now()), ACK_SECONDS));
    return new Response(null, { status: 204, headers });
  }

  /** The editor's session and access, or the response refusing the request. A save passes cached=false. */
  async function requireEditor(request: Request, cached = true, what = 'to see drafts'): Promise<{ session: Session; access: Access } | Response> {
    const { session } = await sessionOf(request);
    if (!session) return failure(401, 'signed_out', `Sign in as a wiki editor ${what}.`, {}, PRIVATE);
    const a = await access(session, cached);
    if (!a) return failure(503, 'access_check_failed', CHECK_FAILED, {}, PRIVATE);
    if (!a.editor) return failure(403, 'not_editor', "You're signed in, but you don't have wiki access.", {}, PRIVATE);
    return { session, access: a };
  }

  const saveDeps: SaveDeps = {
    fetch: deps.fetch,
    now: deps.now,
    tokens: deps.tokens ?? new Map(),
    takeSlot: deps.takeSlot ?? (() => Promise.reject(new Error('no rate limiter'))),
    waitUntil: deps.waitUntil,
    log,
  };

  async function source(request: Request, url: URL): Promise<Response> {
    const who = await requireEditor(request, true, 'to edit pages');
    if (who instanceof Response) return who;
    const slug = url.searchParams.get('slug') ?? '';
    if (!isDraftSlug(slug)) return failure(404, 'not_found', 'No such page.', {}, PRIVATE);
    return readSource(env, saveDeps, slug);
  }

  /** An image saved with a page, shown to its editor before the vault publishes it. */
  async function image(request: Request, oid: string): Promise<Response> {
    const who = await requireEditor(request, true, 'to see this image');
    if (who instanceof Response) return who;
    const obj = /^[0-9a-f]{64}$/.test(oid) && env.LFS_BUCKET ? await env.LFS_BUCKET.get(lfsKey(oid)) : null;
    const type = obj?.httpMetadata?.contentType ?? '';
    if (!obj || !/^image\/(webp|gif|jpeg)$/.test(type)) return failure(404, 'not_found', 'No such image.', {}, PRIVATE);
    return new Response(obj.body, { headers: { 'Content-Type': type, 'Content-Length': String(obj.size), ...PRIVATE } });
  }

  async function saveRequest(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return failure(403, 'cross_origin', 'Save from the site itself.');
    // The emergency stop answers before anything else, signed in or not.
    if (editingState(env) === 'read-only') return save(env, saveDeps, request, { id: '', displayName: '' });
    const who = await requireEditor(request, false, 'to save');
    if (who instanceof Response) return who;
    return save(env, saveDeps, request, { id: who.session.sub, displayName: who.access.displayName });
  }

  async function draftsIndexText(): Promise<string | null> {
    const obj = await env.VAULT_CATALOG.get(DRAFTS_INDEX_KEY);
    return obj ? obj.text() : null;
  }

  async function drafts(request: Request, rest: string): Promise<Response> {
    const who = await requireEditor(request);
    if (who instanceof Response) return who;
    if (rest === 'index.json') {
      const text = await draftsIndexText();
      // Before the vault's first publish with drafts: an empty list.
      const body = text ?? JSON.stringify({ schema: 1, generatedAt: '', commit: '', pages: [], files: [] });
      return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE } });
    }
    const m = /^(.+)\.md$/.exec(rest);
    let slug = '';
    try {
      slug = m ? decodeURIComponent(m[1]) : '';
    } catch {
      /* not a slug */
    }
    if (!isDraftSlug(slug)) return failure(404, 'not_found', 'No such draft.', {}, PRIVATE);
    // Only drafts the index lists: a page published since keeps a stale object here.
    const text = await draftsIndexText();
    let listed = false;
    try {
      const index = text ? (JSON.parse(text) as { pages?: Array<{ slug?: unknown }> }) : null;
      listed = !!index?.pages?.some((p) => p.slug === slug);
    } catch {
      /* unreadable index: nothing is listed */
    }
    const obj = listed ? await env.VAULT_CATALOG.get(draftKey(slug)) : null;
    if (!obj) return failure(404, 'not_found', 'No such draft.', {}, PRIVATE);
    return new Response(await obj.text(), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...PRIVATE } });
  }

  /** Answer a request under /api/wiki/. */
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(WIKI_API.length);
    const method = request.method;
    const only = (allowed: string) => new Response(null, { status: 405, headers: { Allow: allowed, ...NO_STORE } });
    switch (path) {
      case 'auth/login':
        return method === 'GET' ? login(url) : only('GET');
      case 'auth/callback':
        return method === 'GET' ? callback(request, url) : only('GET');
      case 'auth/logout':
        return method === 'POST' ? logout(request) : only('POST');
      case 'me':
        return method === 'GET' ? me(request) : only('GET');
      case 'ack':
        return method === 'POST' ? acknowledge(request) : only('POST');
      case 'source':
        return method === 'GET' ? source(request, url) : only('GET');
      case 'save':
        return method === 'POST' ? saveRequest(request) : only('POST');
    }
    if (path.startsWith('image/')) return method === 'GET' ? image(request, path.slice('image/'.length)) : only('GET');
    if (path.startsWith('drafts/')) return method === 'GET' ? drafts(request, path.slice('drafts/'.length)) : only('GET');
    return failure(404, 'not_found', 'No such wiki API.');
  };
}

