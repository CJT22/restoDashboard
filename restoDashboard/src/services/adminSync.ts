// Frontend-side bridge to this project's own backend (server/index.ts),
// which in turn holds the restoAdmin credentials and proxies to restoAdmin.
// The browser never talks to restoAdmin directly and never sees its
// credentials — every call here hits our own same-origin /api/admin/* routes.
//
// restoAdmin's STATUS is now a 1-2 int enum (1=Available, 2=Occupied —
// restoAdmin/src/components/users/Tables.tsx); the dashboard's TableStatus is
// the string equivalent. This module is the one place that maps between
// them. Table status is pull-only: it's a pure reflection of restoAdmin's
// order-driven state (already flipped automatically on order lifecycle
// changes), so there's no admin-direction status mapping here anymore.

import { TableStatus } from '../types';

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

const STATUS_FROM_ADMIN: Record<number, TableStatus> = {
  1: 'available',
  2: 'occupied',
};

export function statusFromAdmin(status: number): TableStatus {
  return STATUS_FROM_ADMIN[status] ?? 'available';
}

async function parseJsonOrThrow(res: Response, fallbackMessage: string) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || fallbackMessage);
  }
  return json;
}

export async function getAdminTables(): Promise<AdminTable[]> {
  const res = await fetch('/api/admin/tables');
  const json = await parseJsonOrThrow(res, 'Failed to load Blue Moon tables from restoAdmin');
  return Array.isArray(json.data) ? json.data : [];
}

// Pull-based fallback for a single table's CURRENT status, for callers that
// just triggered an order mutation (create/confirm/cancel/settle) and want
// to be SURE the resulting status lands locally. restoAdmin flips the table's
// status inside that same mutation and emits table_updated at essentially the
// same moment, and App.tsx's live subscription normally applies that already
// — but it depends on this tab's EventSource already being connected at that
// exact instant, which isn't guaranteed right after a fresh page load (or
// during a brief reconnect window). Reuses the existing bulk fetch rather
// than adding a new backend endpoint just for one row.
export async function getAdminTableStatus(adminTableId: number): Promise<TableStatus | null> {
  const tables = await getAdminTables();
  const match = tables.find((t) => t.id === adminTableId);
  return match ? statusFromAdmin(match.status) : null;
}

export async function setLink(zoneId: string, adminTableId: number | null): Promise<void> {
  const res = await fetch('/api/admin/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId, adminTableId }),
  });
  await parseJsonOrThrow(res, 'Failed to update the restoAdmin link');
}

export interface RemoteTableUpdate {
  adminTableId: number;
  status: TableStatus;
  dashboardZoneId: string | null;
}

// Single shared EventSource for /api/admin/stream — table sync (this module)
// and order sync (services/orderSync.ts) both attach listeners to the same
// connection rather than each opening their own. Reference-counted so it
// closes once nothing is subscribed, and reopens if resubscribed later.
let sharedSource: EventSource | null = null;
let sharedSourceRefCount = 0;

export function acquireAdminEventSource(): EventSource | null {
  if (!sharedSource) {
    try {
      sharedSource = new EventSource('/api/admin/stream');
      sharedSource.onerror = () => {
        // EventSource auto-reconnects; just log so silent backend outages are visible in devtools.
        console.warn('[adminSync] SSE stream error (will retry)');
      };
    } catch (err) {
      console.warn('[adminSync] could not open SSE stream', err);
      return null;
    }
  }
  sharedSourceRefCount++;
  return sharedSource;
}

export function releaseAdminEventSource(): void {
  sharedSourceRefCount = Math.max(0, sharedSourceRefCount - 1);
  if (sharedSourceRefCount === 0 && sharedSource) {
    sharedSource.close();
    sharedSource = null;
  }
}

// Subscribes to restoAdmin table_updated events on the shared stream and
// calls onUpdate for every one that carries a usable status. Returns an
// unsubscribe function. Failures (backend not running, network hiccup) are
// swallowed — the dashboard should keep working locally even if live sync
// is unavailable.
export function subscribeToAdminUpdates(onUpdate: (event: RemoteTableUpdate) => void): () => void {
  const source = acquireAdminEventSource();
  if (!source) return () => {};

  const handler = (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.status == null) return;
      onUpdate({
        adminTableId: Number(payload.adminTableId),
        status: statusFromAdmin(Number(payload.status)),
        dashboardZoneId: payload.dashboardZoneId ?? null,
      });
    } catch (err) {
      console.warn('[adminSync] bad table_updated payload', err);
    }
  };
  source.addEventListener('table_updated', handler);

  return () => {
    source.removeEventListener('table_updated', handler);
    releaseAdminEventSource();
  };
}
