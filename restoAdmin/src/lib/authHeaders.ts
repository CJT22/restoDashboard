/**
 * Request headers for authenticated restoAdmin API calls.
 *
 * Authorization is only sent when a token is stored — an empty `Bearer ` would
 * fail JWT verification server-side instead of falling back to the session
 * (see server/middleware/unifiedAuth.js).
 */
export function authHeaders({ accept = false, json = false }: { accept?: boolean; json?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accept) headers.Accept = 'application/json';
  if (json) headers['Content-Type'] = 'application/json';
  try {
    const token = (localStorage.getItem('token') || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // localStorage unavailable — send unauthenticated
  }
  return headers;
}
