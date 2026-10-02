// Dashboard sign-in sessions.
//
// Each session is one browser signed in as one restoAdmin user. It holds that
// user's restoAdmin access/refresh tokens, which never leave this backend —
// the browser only gets an opaque session id in an httpOnly cookie (see
// auth.ts). adminClient.ts refreshes the tokens and ends the session when
// restoAdmin stops accepting them.
//
// Sessions are kept in memory and mirrored to SESSIONS_FILE, so restarting
// this backend doesn't sign everyone out. A session lasts until its user
// signs out, its account signs in on another device (restoAdmin allows one
// session per account), or restoAdmin's refresh token expires.

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface DashboardUser {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
}

export interface AdminSession {
  id: string;
  user: DashboardUser;
  accessToken: string;
  refreshToken: string;
  createdAt: string;
}

// Why a session ended, as reported to the browser:
//   SESSION_REPLACED — the account signed in somewhere else
//   SESSION_EXPIRED  — restoAdmin no longer accepts the session's tokens
//   SIGNED_OUT       — the user signed out
export type SessionEndReason = 'SESSION_REPLACED' | 'SESSION_EXPIRED' | 'SIGNED_OUT';

// Holds refresh tokens, so it's gitignored (.data/) and written owner-only.
const SESSIONS_FILE = path.resolve(process.cwd(), '.data', 'sessions.json');

const sessions = new Map<string, AdminSession>();

// Emits 'ended' (sessionId, reason) so open SSE streams for that session can close.
export const sessionEvents = new EventEmitter();
sessionEvents.setMaxListeners(0);

// A JWT's exp claim in ms, read without verifying it — only used to drop
// sessions whose refresh token has certainly expired.
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions.values()], null, 2), { mode: 0o600 });
  } catch (err: any) {
    console.warn('[sessions] could not save sessions to disk:', err?.message || err);
  }
}

function load(): void {
  let saved: AdminSession[] = [];
  try {
    saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.warn('[sessions] could not read saved sessions:', err?.message || err);
    return;
  }
  const now = Date.now();
  let dropped = 0;
  for (const s of Array.isArray(saved) ? saved : []) {
    const exp = s?.refreshToken ? jwtExpiryMs(s.refreshToken) : null;
    if (!s?.id || !s.accessToken || (exp != null && exp <= now)) {
      dropped++;
      continue;
    }
    sessions.set(s.id, s);
  }
  if (dropped > 0) persist();
  console.log(`[sessions] restored ${sessions.size} signed-in session(s)`);
}

load();

export function createSession(user: DashboardUser, accessToken: string, refreshToken: string): AdminSession {
  const session: AdminSession = {
    id: randomBytes(32).toString('base64url'),
    user,
    accessToken,
    refreshToken,
    createdAt: new Date().toISOString(),
  };
  sessions.set(session.id, session);
  persist();
  return session;
}

export function getSession(id: string | undefined | null): AdminSession | null {
  return (id && sessions.get(id)) || null;
}

// Any signed-in session, for the work this backend does on nobody's behalf
// (socketBridge.ts's order-event lookups). Newest first, since an older one
// is likelier to have been replaced by a sign-in elsewhere.
export function anySessions(): AdminSession[] {
  return [...sessions.values()].reverse();
}

// Call after adminClient.ts refreshes a session's tokens.
export function saveSession(session: AdminSession): void {
  if (sessions.get(session.id) !== session) return;
  persist();
}

export function endSession(id: string, reason: SessionEndReason): void {
  if (!sessions.delete(id)) return;
  persist();
  sessionEvents.emit('ended', id, reason);
}
