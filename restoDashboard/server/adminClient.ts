// Thin authenticated client for restoAdmin's REST API.
//
// Holds the restoAdmin service-account credentials and access/refresh tokens
// entirely server-side — the dashboard's browser never sees them, it only
// ever talks to this backend's own /api/admin/* routes (see index.ts).
//
// Status values below are restoAdmin's own numeric enum (0=Not Available,
// 1=Available, 2=Occupied, 3=Reserved — see src/components/users/Tables.tsx
// in restoAdmin). Mapping to/from the dashboard's string TableStatus happens
// on the frontend (src/services/adminSync.ts), not here — this client just
// passes admin's own shape through.

const ADMIN_API_BASE_URL = (process.env.ADMIN_API_BASE_URL || 'http://localhost:2000').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const ADMIN_BRANCH_ID = Number(process.env.ADMIN_BRANCH_ID || 3);

export interface AdminTable {
  id: number;
  branchId: number | null;
  tableNumber: string;
  floor: 'gf' | '2f' | null;
  capacity: number;
  roomCharge: number | null;
  status: number;
  dashboardZoneId: string | null;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loginPromise: Promise<void> | null = null;

async function login(): Promise<void> {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD are not configured (see .env.example)');
  }
  const res = await fetch(`${ADMIN_API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `restoAdmin login failed (${res.status})`);
  }
  accessToken = json.tokens?.accessToken || json.data?.tokens?.accessToken;
  refreshToken = json.tokens?.refreshToken || json.data?.tokens?.refreshToken;
  if (!accessToken) {
    throw new Error('restoAdmin login response did not include an accessToken');
  }
}

async function refresh(): Promise<void> {
  if (!refreshToken) return login();
  const res = await fetch(`${ADMIN_API_BASE_URL}/api/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    // Refresh token expired/invalid — fall back to a fresh login.
    return login();
  }
  const json: any = await res.json().catch(() => ({}));
  accessToken = json.tokens?.accessToken || accessToken;
  refreshToken = json.tokens?.refreshToken || refreshToken;
}

async function ensureLoggedIn(): Promise<void> {
  if (accessToken) return;
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

// Calls restoAdmin with the current access token, retrying once after a
// refresh (or fresh login) if the token was rejected as expired.
async function authedFetch(path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
  await ensureLoggedIn();
  const res = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401 && !isRetry) {
    await refresh();
    return authedFetch(path, init, true);
  }
  return res;
}

function mapAdminRow(row: any): AdminTable {
  return {
    id: Number(row.IDNo),
    branchId: row.BRANCH_ID != null ? Number(row.BRANCH_ID) : null,
    tableNumber: String(row.TABLE_NUMBER ?? ''),
    floor: row.FLOOR === 'gf' || row.FLOOR === '2f' ? row.FLOOR : null,
    capacity: Number(row.CAPACITY ?? 0),
    roomCharge: row.ROOM_CHARGE != null ? Number(row.ROOM_CHARGE) : null,
    status: Number(row.STATUS ?? 0),
    dashboardZoneId: row.DASHBOARD_ZONE_ID || null,
  };
}

export async function getBlueMoonTables(): Promise<AdminTable[]> {
  const res = await authedFetch(`/restaurant_tables?branch_id=${ADMIN_BRANCH_ID}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin tables (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  return rows.map(mapAdminRow);
}

export async function setTableStatus(adminTableId: number, status: 0 | 1 | 2 | 3): Promise<void> {
  const res = await authedFetch(`/restaurant_table/${adminTableId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to update restoAdmin table status (${res.status})`);
  }
}

export async function setDashboardLink(adminTableId: number, zoneId: string | null): Promise<void> {
  const res = await authedFetch(`/restaurant_table/${adminTableId}/dashboard-link`, {
    method: 'PATCH',
    body: JSON.stringify({ dashboard_zone_id: zoneId }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to update restoAdmin dashboard link (${res.status})`);
  }
}

export { ADMIN_API_BASE_URL };
