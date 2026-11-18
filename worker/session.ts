// Signed cookies for the wiki's sign-in: the session (30 days per device), the OAuth2 `state`
// cookie of a sign-in in progress (10 minutes) and the first-sign-in acknowledgement. Each value is
// `<base64url JSON>.<base64url HMAC-SHA-256>` under WIKI_SESSION_SECRET, checked with
// crypto.subtle.verify (constant time). No server-side store: what a cookie says is all there is,
// and a cookie whose signature, purpose or expiry does not check out counts as absent.
// Pure (Web Crypto only), so it is unit-tested under Node (wikiApi.test.ts).

/** The session cookie. `__Host-`: Secure, Path=/ and no Domain, so no subdomain can set or read it. */
export const SESSION_COOKIE = '__Host-wiki-session';
/** A sign-in in progress: the `state` sent to Discord and where to return afterwards. */
export const STATE_COOKIE = '__Host-wiki-oauth';
/** Set when an editor has read the first-sign-in notice; kept across sign-outs on that device. */
export const ACK_COOKIE = '__Host-wiki-ack';

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const STATE_SECONDS = 10 * 60;
/** About 400 days, the longest a browser keeps a cookie. */
export const ACK_SECONDS = 400 * 24 * 60 * 60;

/** What a signed-in visitor's cookie holds. Profile fields are Discord's at sign-in, for display only. */
export interface Session {
  /** Discord user id. */
  sub: string;
  /** Issued and expires, in seconds since the epoch. */
  iat: number;
  exp: number;
  /** Discord username, global display name and avatar hash at sign-in. */
  name: string;
  gname: string | null;
  avatar: string | null;
}

export interface OAuthState {
  state: string;
  /** A same-site path (see safeReturnPath). */
  ret: string;
  exp: number;
}

export interface Ack {
  sub: string;
  iat: number;
  exp: number;
}

/** Which cookie a signed value was made for, so one kind can never pass for another. */
type Purpose = 'session' | 'state' | 'ack';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const keys = new Map<string, Promise<Key>>();
function hmacKey(secret: string): Promise<Key> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, key);
  }
  return key;
}

/** A secret long enough to sign with; shorter ones are treated as not configured. */
export const usableSecret = (secret: string | undefined): secret is string => typeof secret === 'string' && secret.length >= 32;

async function sign(purpose: Purpose, payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, p: purpose })));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(mac)}`;
}

/** The payload of a value signed for `purpose`, if the signature checks out and it has not expired. */
async function verify(purpose: Purpose, value: string | undefined, secret: string, now: number): Promise<Record<string, unknown> | null> {
  if (!value || value.length > 4096) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot !== value.lastIndexOf('.')) return null;
  const body = value.slice(0, dot);
  const mac = fromB64url(value.slice(dot + 1));
  if (!mac || mac.length !== 32) return null;
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), mac, enc.encode(body));
  if (!ok) return null;
  const raw = fromB64url(body);
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(dec.decode(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.p !== purpose || typeof d.exp !== 'number' || d.exp <= now) return null;
  return d;
}

const nowSeconds = (ms: number) => Math.floor(ms / 1000);
const isId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,25}$/.test(v);
const optString = (v: unknown) => (typeof v === 'string' ? v : null);

export function signSession(s: Omit<Session, 'iat' | 'exp'>, secret: string, nowMs: number): Promise<string> {
  const iat = nowSeconds(nowMs);
  return sign('session', { ...s, iat, exp: iat + SESSION_SECONDS }, secret);
}

export async function verifySession(value: string | undefined, secret: string, nowMs: number): Promise<Session | null> {
  const d = await verify('session', value, secret, nowSeconds(nowMs));
  if (!d || !isId(d.sub) || typeof d.iat !== 'number' || typeof d.name !== 'string') return null;
  // A session never outlives SESSION_SECONDS from its issue, whatever its exp says.
  if ((d.exp as number) - d.iat > SESSION_SECONDS) return null;
  return { sub: d.sub, iat: d.iat, exp: d.exp as number, name: d.name, gname: optString(d.gname), avatar: optString(d.avatar) };
}

export function signState(state: string, ret: string, secret: string, nowMs: number): Promise<string> {
  return sign('state', { state, ret, exp: nowSeconds(nowMs) + STATE_SECONDS }, secret);
}

export async function verifyState(value: string | undefined, secret: string, nowMs: number): Promise<OAuthState | null> {
  const d = await verify('state', value, secret, nowSeconds(nowMs));
  if (!d || typeof d.state !== 'string' || typeof d.ret !== 'string') return null;
  return { state: d.state, ret: d.ret, exp: d.exp as number };
}

export function signAck(sub: string, secret: string, nowMs: number): Promise<string> {
  const iat = nowSeconds(nowMs);
  return sign('ack', { sub, iat, exp: iat + ACK_SECONDS }, secret);
}

export async function verifyAck(value: string | undefined, secret: string, nowMs: number): Promise<Ack | null> {
  const d = await verify('ack', value, secret, nowSeconds(nowMs));
  if (!d || !isId(d.sub) || typeof d.iat !== 'number') return null;
  return { sub: d.sub, iat: d.iat, exp: d.exp as number };
}

/** A random `state`: 32 bytes, base64url. */
export function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Equal strings, compared in time that does not depend on where they differ. */
export function sameString(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A request's cookies by name (the first of a repeated name wins). */
export function readCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name && !out.has(name)) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

/** A Set-Cookie value: HttpOnly, Secure, SameSite=Lax, Path=/ (as `__Host-` requires); maxAge 0 deletes it. */
export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${maxAge > 0 ? value : ''}; Max-Age=${Math.max(0, maxAge)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
