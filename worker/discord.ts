// The Discord API calls the wiki's sign-in makes, with `fetch` passed in so tests can stand in for
// Discord. Checked against Discord's developer docs (discord/discord-api-docs, 2026-11-17):
// - OAuth2 authorization-code grant: https://discord.com/oauth2/authorize, token exchange at
//   POST /api/v10/oauth2/token (application/x-www-form-urlencoded only, client credentials by HTTP
//   Basic), then GET /api/v10/users/@me with the Bearer token (`identify` scope).
// - Every request sends a `DiscordBot (url, version)` User-Agent, as the docs require.
// Who holds the Wiki Editor role, and the edit announcements, come from buc-bot (bucBot.ts): the
// site has no bot token.
// Pure apart from `fetch`, so it is unit-tested under Node.

export const DISCORD_API = 'https://discord.com/api/v10';
export const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
export const DISCORD_ISSUER = 'https://discord.com';
const CDN = 'https://cdn.discordapp.com';
const USER_AGENT = 'DiscordBot (https://abucnasty.dev, 1)';
const TIMEOUT_MS = 8000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The fields of a Discord user object the wiki uses. */
export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export class DiscordError extends Error {}

const isId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,25}$/.test(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** Avatar hashes are hex, optionally `a_` for animated; anything else is not put in a URL. */
const hash = (v: unknown): string | null => (typeof v === 'string' && /^(a_)?[0-9a-f]{8,64}$/i.test(v) ? v : null);

function parseUser(raw: unknown): DiscordUser | null {
  const u = raw as Record<string, unknown> | null;
  if (!u || !isId(u.id) || typeof u.username !== 'string') return null;
  return { id: u.id, username: u.username, global_name: str(u.global_name), avatar: hash(u.avatar) };
}

function timed(init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string>) } };
}

/** The authorize URL a sign-in starts at. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'identify', state, redirect_uri: redirectUri });
  return `${DISCORD_AUTHORIZE}?${q}`;
}

/** Exchange an authorization code for an access token. Throws DiscordError on any failure. */
export async function exchangeCode(
  f: Fetch,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<string> {
  let res: Response;
  try {
    res = await f(
      `${DISCORD_API}/oauth2/token`,
      timed({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${opts.clientId}:${opts.clientSecret}`)}`,
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: opts.code, redirect_uri: opts.redirectUri }).toString(),
      }),
    );
  } catch (err) {
    throw new DiscordError(`token exchange: ${err instanceof Error ? err.message : String(err)}`);
  }
  // The body may echo the request on error; only the status is reported.
  if (!res.ok) {
    await res.body?.cancel();
    throw new DiscordError(`token exchange: HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const token = data?.access_token;
  if (typeof token !== 'string' || token === '' || String(data?.token_type).toLowerCase() !== 'bearer') {
    throw new DiscordError('token exchange: no bearer token in the answer');
  }
  return token;
}

/** The signed-in user (`identify` scope). Throws DiscordError on any failure. */
export async function currentUser(f: Fetch, accessToken: string): Promise<DiscordUser> {
  let res: Response;
  try {
    res = await f(`${DISCORD_API}/users/@me`, timed({ headers: { Authorization: `Bearer ${accessToken}` } }));
  } catch (err) {
    throw new DiscordError(`users/@me: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new DiscordError(`users/@me: HTTP ${res.status}`);
  }
  const user = parseUser(await res.json().catch(() => null));
  if (!user) throw new DiscordError('users/@me: not a user object');
  return user;
}

/** Server nickname, else global display name, else username. */
export function displayName(nick: string | null, user: Pick<DiscordUser, 'username' | 'global_name'>): string {
  return nick ?? user.global_name ?? user.username;
}

/** The avatar shown: the server avatar, else the user's, else Discord's default for the id. */
export function avatarUrl(opts: { userId: string; guildId: string; memberAvatar: string | null; avatar: string | null }): string {
  const ext = (h: string) => (h.startsWith('a_') ? 'gif' : 'png');
  if (opts.memberAvatar) return `${CDN}/guilds/${opts.guildId}/users/${opts.userId}/avatars/${opts.memberAvatar}.${ext(opts.memberAvatar)}?size=64`;
  if (opts.avatar) return `${CDN}/avatars/${opts.userId}/${opts.avatar}.${ext(opts.avatar)}?size=64`;
  // New-style usernames: (user_id >> 22) % 6.
  const index = Number((BigInt(opts.userId) >> 22n) % 6n);
  return `${CDN}/embed/avatars/${index}.png`;
}
