// The dashboard's sign-in state, against this app's own backend
// (server/auth.ts). Staff sign in with their restoAdmin account; the backend
// keeps the restoAdmin tokens and gives this browser only an httpOnly
// session cookie, so there's nothing to store here.
//
// adminFetch wraps every /api/admin call: a 401 from any of them means the
// session is gone (signed out elsewhere, expired, or the account signed in
// on another device), and AuthGate.tsx returns to the login page.

export interface DashboardUser {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
}

// Why the dashboard went back to the login page, shown above the form.
export type SignedOutReason = 'SESSION_REPLACED' | 'SESSION_EXPIRED' | 'UNAUTHENTICATED';

export const SIGNED_OUT_MESSAGES: Record<SignedOutReason, string> = {
  SESSION_REPLACED: 'This account signed in on another device, so it was signed out here.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  UNAUTHENTICATED: 'You were signed out. Please sign in again.',
};

type SignedOutListener = (reason: SignedOutReason) => void;
const signedOutListeners = new Set<SignedOutListener>();

export function onSignedOut(listener: SignedOutListener): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

function notifySignedOut(reason: SignedOutReason) {
  signedOutListeners.forEach((listener) => listener(reason));
}

async function reasonFrom(res: Response): Promise<SignedOutReason> {
  const json = await res.clone().json().catch(() => ({}));
  return json?.code === 'SESSION_REPLACED' || json?.code === 'SESSION_EXPIRED' ? json.code : 'UNAUTHENTICATED';
}

// fetch, for /api/admin/* calls: reports a 401 as a sign-out, then returns
// the response as usual so the caller's own error handling still runs.
export async function adminFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) notifySignedOut(await reasonFrom(res));
  return res;
}

// The signed-in user, or null if this browser isn't signed in. Throws if
// the backend can't be reached.
export async function getCurrentUser(): Promise<DashboardUser | null> {
  const res = await fetch('/api/auth/me');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) throw new Error(json?.error || "Can't reach the dashboard server.");
  return json.data ?? null;
}

// Checks the session after the live stream dropped for good (its reconnect
// was refused), which is how a sign-out shows up when no other call is made.
export async function checkSession(): Promise<void> {
  const user = await getCurrentUser().catch(() => undefined);
  if (user === null) notifySignedOut('UNAUTHENTICATED');
}

export async function signIn(username: string, password: string): Promise<DashboardUser> {
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error("Can't reach the dashboard server. Check the connection and try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) throw new Error(json?.error || 'Sign-in failed. Please try again.');
  return json.data;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export function displayName(user: DashboardUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
}
