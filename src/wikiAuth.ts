// Wiki sign-in, from the browser's side: who is signed in (GET /api/wiki/me, once per page load
// and shared, like the wiki index), signing in (a full navigation to the Worker, which sends the
// visitor on to Discord), signing out and acknowledging the first-sign-in notice. The session is
// an HttpOnly cookie the page cannot read; everything here goes through the Worker
// (worker/wikiApi.ts).
import { useEffect, useSyncExternalStore } from 'react';

/** What /api/wiki/me answers. */
export interface WikiMe {
  signedIn: boolean;
  editor: boolean;
  userId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  firstSignIn?: boolean;
  /** Editors: whether saving works now ("read-only": paused; "unavailable": not set up). */
  editing?: 'on' | 'read-only' | 'unavailable';
}

export type WikiSession =
  | { status: 'loading' }
  /** Signed out, or the sign-in API could not be reached (then nobody is treated as signed in). */
  | { status: 'signed-out' }
  | { status: 'signed-in'; me: WikiMe }
  /** Signed in, but Discord could not say whether they are an editor. */
  | { status: 'check-failed'; me: WikiMe; message: string };

const ME_URL = '/api/wiki/me';
/** The query parameter the Worker adds when a sign-in did not complete. */
export const SIGNIN_PARAM = 'wiki-signin';

let state: WikiSession = { status: 'loading' };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: WikiSession) {
  state = next;
  for (const l of listeners) l();
}

/** Fetch /api/wiki/me (once, unless `again`). */
export function loadWikiSession(again = false): Promise<void> {
  if (pending && !again) return pending;
  if (again) set({ status: 'loading' });
  pending = fetch(ME_URL, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(async (res) => {
      const body = (await res.json().catch(() => null)) as (WikiMe & { message?: string }) | null;
      if (res.status === 503 && body?.signedIn) {
        set({ status: 'check-failed', me: { ...body, editor: false }, message: body.message ?? "Couldn't check your wiki access." });
      } else if (res.ok && body?.signedIn) {
        set({ status: 'signed-in', me: body });
      } else set({ status: 'signed-out' });
    })
    .catch(() => set({ status: 'signed-out' }));
  return pending;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The visitor's wiki session; starts the shared /api/wiki/me fetch on mount. */
export function useWikiSession(): WikiSession {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void loadWikiSession();
  }, []);
  return s;
}

export const isEditor = (s: WikiSession) => s.status === 'signed-in' && s.me.editor;

/** Where "Maintainer sign-in" goes: the Worker starts the Discord sign-in and returns to `returnTo`. */
export function signInUrl(returnTo: string): string {
  return `/api/wiki/auth/login?return=${encodeURIComponent(returnTo)}`;
}

/** Sign out, then reload the session (drafts disappear with it). */
export async function signOut(): Promise<void> {
  const res = await fetch('/api/wiki/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`sign out: HTTP ${res.status}`);
  await loadWikiSession(true);
}

/** The editor has read the first-sign-in notice. */
export async function acknowledgeFirstSignIn(): Promise<void> {
  const res = await fetch('/api/wiki/ack', { method: 'POST', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`acknowledge: HTTP ${res.status}`);
  if (state.status === 'signed-in') set({ status: 'signed-in', me: { ...state.me, firstSignIn: false } });
}

/** What the Worker's `?wiki-signin=<outcome>` means, for the notice on the page it returned to. */
export const SIGNIN_OUTCOMES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  failed: "Sign-in with Discord didn't work. Try again.",
  expired: 'That sign-in took too long or was started in another tab. Try again.',
  unavailable: "Sign-in isn't available right now. Try again later.",
};
