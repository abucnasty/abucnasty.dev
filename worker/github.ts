// GitHub, as the wiki's GitHub App: the app's JWT (RS256, signed with GITHUB_APP_PRIVATE_KEY), an
// installation token for the vault repository (cached until shortly before it expires), and the
// REST calls the save makes. Checked against GitHub's REST docs (API version 2022-11-28):
// - App JWT: iat (60 s in the past, for clock drift), exp (at most 10 minutes; 9 here), iss = app id.
// - POST /app/installations/{id}/access_tokens → { token, expires_at } (an hour), narrowed here to
//   the vault repository and Contents: write.
// - Git Data API: refs, commits, trees (an entry with `sha: null` deletes that path), blobs.
// - For history (wikiHistory.ts): GET /repos/{repo}/commits?sha=&path=&since=&per_page=&page= (a
//   path's commits, newest first; it does not follow renames), GET /repos/{repo}/commits/{sha}
//   (the files a commit changed, with status "added" | "removed" | "renamed" (+ previous_filename)
//   | "modified" ...; up to 300 files) and GET /repos/{repo}/contents/{path}?ref= with the raw
//   media type (a file's bytes at a commit; 404 when it is not there).
// The private key may be PKCS#8 (BEGIN PRIVATE KEY) or the PKCS#1 GitHub hands out (BEGIN RSA
// PRIVATE KEY): Web Crypto only imports PKCS#8, so a PKCS#1 key is wrapped first.
// Pure apart from `fetch` and Web Crypto, so it is unit-tested under Node.
import type { Fetch } from './discord.ts';

export const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'abucnasty.dev-wiki';
const TIMEOUT_MS = 10000;
/** A cached installation token is used until this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

export interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKey: string;
  /** owner/name of the repository the token is for. */
  repo: string;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** True when the app's settings are all present (ids numeric, a PEM key). */
export function appConfigured(c: Partial<GitHubAppConfig>): c is GitHubAppConfig {
  return /^\d+$/.test(c.appId ?? '') && /^\d+$/.test(c.installationId ?? '') && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(c.privateKey ?? '');
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** DER length bytes. */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v >>= 8) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
}

/** A PKCS#1 RSAPrivateKey wrapped as PKCS#8 PrivateKeyInfo (version 0, rsaEncryption, NULL params). */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  const seq = [0x30, ...derLength(body.length + pkcs1.length)];
  const out = new Uint8Array(seq.length + body.length + pkcs1.length);
  out.set(seq, 0);
  out.set(body, seq.length);
  out.set(pkcs1, seq.length + body.length);
  return out;
}

/** The PEM key as PKCS#8 DER. */
export function pemToPkcs8(pem: string): Uint8Array {
  const m = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]*?)-----END (?:RSA )?PRIVATE KEY-----/.exec(pem.replace(/\\n/g, '\n'));
  if (!m) throw new GitHubError('GITHUB_APP_PRIVATE_KEY is not a PEM private key', 0);
  const der = base64ToBytes(m[2]);
  return m[1] ? pkcs1ToPkcs8(der) : der;
}

const keys = new Map<string, ReturnType<typeof crypto.subtle.importKey>>();

function signingKey(pem: string): ReturnType<typeof crypto.subtle.importKey> {
  let key = keys.get(pem);
  if (!key) {
    key = crypto.subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    key.catch(() => keys.delete(pem));
    keys.set(pem, key);
  }
  return key;
}

/** The app's JWT, good for 9 minutes from `now` (ms). */
export async function appJwt(appId: string, pem: string, now: number): Promise<string> {
  const iat = Math.floor(now / 1000) - 60;
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ iat, exp: iat + 600, iss: appId })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(pem), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

/** Installation tokens by installation id, kept for the isolate's life. */
export type TokenCache = Map<string, { token: string; expires: number }>;

function headers(auth: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
    Authorization: auth,
    ...extra,
  };
}

/** An installation token for the repository: the cached one, or a new one. */
export async function installationToken(f: Fetch, c: GitHubAppConfig, cache: TokenCache, now: number): Promise<string> {
  const hit = cache.get(c.installationId);
  if (hit && hit.expires - TOKEN_MARGIN_MS > now) return hit.token;
  const jwt = await appJwt(c.appId, c.privateKey, now);
  const res = await f(`${GITHUB_API}/app/installations/${c.installationId}/access_tokens`, {
    method: 'POST',
    headers: headers(`Bearer ${jwt}`, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ repositories: [c.repo.split('/')[1]], permissions: { contents: 'write' } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new GitHubError(`installation token: HTTP ${res.status}`, res.status);
  }
  const data = (await res.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof data.token !== 'string' || typeof data.expires_at !== 'string') throw new GitHubError('installation token: no token in the answer', 502);
  const expires = Date.parse(data.expires_at);
  cache.set(c.installationId, { token: data.token, expires: Number.isFinite(expires) ? expires : now + 50 * 60 * 1000 });
  return data.token;
}

/** A commit as the commits list gives it, reduced to what the history shows. */
export interface ListedCommit {
  sha: string;
  parents: string[];
  message: string;
  /** The git author's name (for a site edit, the editor's display name); the email is never kept. */
  author: string;
  /** The author date, ISO 8601. */
  date: string;
}

/** A file a commit changed. */
export interface CommitFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

/** The Git Data API calls of a save, against one repository with one token. */
export function gitData(f: Fetch, repo: string, token: string) {
  const base = `${GITHUB_API}/repos/${repo}`;
  async function send(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
    return f(`${base}${path}`, {
      method,
      headers: headers(`Bearer ${token}`, { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await send(method, path, body);
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { message?: unknown } | null;
      const msg = typeof detail?.message === 'string' ? `: ${detail.message.slice(0, 200)}` : '';
      throw new GitHubError(`${method} ${path.split('?')[0]}: HTTP ${res.status}${msg}`, res.status);
    }
    return (await res.json()) as T;
  }
  return {
    headOf: async (branch: string) => (await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`)).object.sha,
    commitTree: async (commit: string) => (await call<{ tree: { sha: string } }>('GET', `/git/commits/${commit}`)).tree.sha,
    tree: async (sha: string, recursive = false) => {
      const t = await call<{ tree: TreeEntry[]; truncated?: boolean }>('GET', `/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);
      if (t.truncated) throw new GitHubError('the wiki tree is too large to list', 502);
      return t.tree;
    },
    blob: async (sha: string) => {
      const b = await call<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
      return b.encoding === 'base64' ? base64ToBytes(b.content) : enc.encode(b.content);
    },
    createBlob: async (bytes: Uint8Array) => (await call<{ sha: string }>('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' })).sha,
    /** A commit's tree, parents, message and author (Git Data API). */
    commit: async (sha: string) => {
      const c = await call<{ tree: { sha: string }; parents: Array<{ sha: string }>; message: string; author: { name: string; date: string } }>('GET', `/git/commits/${sha}`);
      return { tree: c.tree.sha, parents: c.parents.map((p) => p.sha), message: c.message, author: c.author.name, date: c.author.date };
    },
    /** Commits on `sha` (a branch or commit), newest first, optionally only those touching `path` or after `since`. */
    commits: async (q: { sha: string; path?: string; since?: string; perPage: number; page?: number }): Promise<ListedCommit[]> => {
      const params = new URLSearchParams({ sha: q.sha, per_page: String(q.perPage) });
      if (q.path !== undefined) params.set('path', q.path);
      if (q.since !== undefined) params.set('since', q.since);
      if (q.page !== undefined) params.set('page', String(q.page));
      type Raw = { sha: string; parents: Array<{ sha: string }>; commit: { message: string; author: { name: string; date: string } | null } };
      const list = await call<Raw[]>('GET', `/commits?${params}`);
      return list.map((c) => ({ sha: c.sha, parents: c.parents.map((p) => p.sha), message: c.commit.message, author: c.commit.author?.name ?? '', date: c.commit.author?.date ?? '' }));
    },
    /** The files a commit changed (the first 300, as GitHub lists them). */
    commitFiles: async (sha: string): Promise<CommitFile[]> => {
      const c = await call<{ files?: CommitFile[] }>('GET', `/commits/${sha}`);
      return (c.files ?? []).map((x) => ({ filename: x.filename, status: x.status, ...(x.previous_filename ? { previous_filename: x.previous_filename } : {}) }));
    },
    /** A file's bytes at a commit, or null when the file is not there. */
    fileAt: async (path: string, ref: string): Promise<Uint8Array | null> => {
      const res = await send('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, { Accept: 'application/vnd.github.raw+json' });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new GitHubError(`GET /contents: HTTP ${res.status}`, res.status);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    createTree: async (baseTree: string, entries: Array<{ path: string; sha: string | null }>) =>
      (await call<{ sha: string }>('POST', '/git/trees', { base_tree: baseTree, tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })) })).sha,
    createCommit: async (c: { message: string; tree: string; parent: string; author: { name: string; email: string; date: string } }) =>
      (await call<{ sha: string }>('POST', '/git/commits', { message: c.message, tree: c.tree, parents: [c.parent], author: c.author })).sha,
    /** Move the branch to `sha`; false when it is no fast-forward (the branch moved meanwhile). */
    updateRef: async (branch: string, sha: string): Promise<boolean> => {
      try {
        await call('PATCH', `/git/refs/heads/${branch}`, { sha, force: false });
        return true;
      } catch (err) {
        // "Update is not a fast forward"; anything else (a rule refusing the push) is a real failure.
        if (err instanceof GitHubError && err.status === 422 && /fast[ -]forward/i.test(err.message)) return false;
        throw err;
      }
    },
  };
}

export type GitData = ReturnType<typeof gitData>;
