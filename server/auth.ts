// Dashboard sign-in: every device signs in with one shared restoAdmin
// account (the login page's quick login button), and everything done on the
// dashboard is recorded by restoAdmin as that account.
//
//   POST /api/auth/login   (no body) → { success, data: user }
//   GET  /api/auth/me      → { success, data: user | null }
//   POST /api/auth/logout  → { success }
//
// The browser holds only an opaque session id in an httpOnly cookie; the
// restoAdmin tokens stay in sessions.ts. requireSession guards /api/admin/*.

import express, { type Request, type Response, type NextFunction } from 'express';
import { ADMIN_BRANCH_ID, loginToAdmin, SessionEndedError } from './adminClient.js';
import { createSession, endedReason, endOtherSessions, endSession, getSession, type AdminSession } from './sessions.js';

// Only Blue Moon staff with this restoAdmin user_role (users.PERMISSIONS)
// may use the dashboard. Admins and other roles are turned away.
const DASHBOARD_PERMISSION_ID = 3;

// The shared dashboard account. Kept here rather than in the clients, so the
// password never ships in the web bundle or the tablet app. .env can
// override it if the account ever changes.
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'bm_dash';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '12348765';

const COOKIE_NAME = 'rd_session';
// The cookie only carries the session id; the session itself lasts until
// sign-out or until restoAdmin stops accepting its tokens. Renewed on every
// /api/auth/me (each page load), so it never runs out first.
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

function readSessionId(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Secure when the request came in over https (directly, or via a proxy that
// sets X-Forwarded-Proto — see `trust proxy` in index.ts), so it still works
// over plain http in local development.
function setSessionCookie(req: Request, res: Response, sessionId: string, maxAgeS: number): void {
  const attrs = [`${COOKIE_NAME}=${encodeURIComponent(sessionId)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeS}`];
  if (req.secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// The signed-in session behind a request that passed requireSession.
export function sessionOf(res: Response): AdminSession {
  return res.locals.session;
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const sessionId = readSessionId(req);
  const session = getSession(sessionId);
  if (!session) {
    // Say why, if this device's session was replaced or expired recently.
    const ended = endedReason(sessionId);
    if (ended === 'SESSION_REPLACED' || ended === 'SESSION_EXPIRED') {
      const message = ended === 'SESSION_REPLACED' ? 'This account was signed in on another device.' : 'Your session has expired.';
      res.status(401).json({ success: false, ok: false, code: ended, error: message, message });
      return;
    }
    res.status(401).json({ success: false, ok: false, code: 'UNAUTHENTICATED', error: 'Please sign in.', message: 'Please sign in.' });
    return;
  }
  res.locals.session = session;
  next();
}

// For a route's catch: answers 401 when restoAdmin ended the session, so the
// browser returns to its login page. Returns false for any other error.
export function sendIfSessionEnded(res: Response, err: unknown): boolean {
  if (!(err instanceof SessionEndedError)) return false;
  res.status(401).json({ success: false, ok: false, code: err.code, error: err.message, message: err.message });
  return true;
}

export const authRouter = express.Router();

authRouter.post('/login', async (req, res) => {
  const username = DASHBOARD_USERNAME;
  try {
    const login = await loginToAdmin(username, DASHBOARD_PASSWORD);
    if (login.permissions !== DASHBOARD_PERMISSION_ID || login.branchId !== ADMIN_BRANCH_ID) {
      console.warn(
        `[auth] refused ${username}: permissions=${login.permissions}, branch=${login.branchId} (needs ${DASHBOARD_PERMISSION_ID}, ${ADMIN_BRANCH_ID})`
      );
      return res.status(403).json({
        success: false,
        error: `The dashboard account (${username}) isn't allowed to use the Blue Moon dashboard. Ask a manager to check its role and branch in restoAdmin.`,
      });
    }
    // Signing in again from the same browser replaces its old session.
    const previous = readSessionId(req);
    if (previous) endSession(previous, 'SIGNED_OUT');

    const session = createSession(login.user, login.accessToken, login.refreshToken);
    // One device per account: sign the account out everywhere else now.
    endOtherSessions(session.user.id, session.id);
    setSessionCookie(req, res, session.id, COOKIE_MAX_AGE_S);
    console.log(`[auth] ${username} signed in`);
    res.json({ success: true, data: session.user });
  } catch (err: any) {
    // restoAdmin's own reasons ("Incorrect password", "User not found or
    // inactive", …) are safe and useful to show as-is.
    const message = err?.message || 'Sign-in failed';
    const unreachable = err?.cause || /fetch failed/i.test(message);
    res.status(unreachable ? 502 : 401).json({
      success: false,
      error: unreachable ? "Can't reach restoAdmin right now. Try again in a moment." : message,
    });
  }
});

// Signed out is an ordinary answer here (data: null), not an error, so the
// login page doesn't log a failed request on every visit.
authRouter.get('/me', (req, res) => {
  const session = getSession(readSessionId(req));
  if (!session) {
    return res.json({ success: true, data: null });
  }
  setSessionCookie(req, res, session.id, COOKIE_MAX_AGE_S);
  res.json({ success: true, data: session.user });
});

// restoAdmin has no JWT sign-out endpoint, so this just forgets the tokens.
authRouter.post('/logout', (req, res) => {
  const sessionId = readSessionId(req);
  if (sessionId) endSession(sessionId, 'SIGNED_OUT');
  setSessionCookie(req, res, '', 0);
  res.json({ success: true });
});
