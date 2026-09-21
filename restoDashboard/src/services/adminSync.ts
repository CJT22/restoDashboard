// Frontend-side bridge to this project's own backend (server/index.ts),
// which in turn holds the restoAdmin credentials and proxies to restoAdmin.
// The browser never talks to restoAdmin directly and never sees its
// credentials — every call here hits our own same-origin /api/admin/* routes.
//
// restoAdmin's STATUS is a 0-3 int enum (0=Not Available, 1=Available,
// 2=Occupied, 3=Reserved — restoAdmin/src/components/users/Tables.tsx); the
// dashboard's TableStatus is the string equivalent. This module is the one
// place that maps between them.

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

const STATUS_TO_ADMIN: Record<TableStatus, 0 | 1 | 2 | 3> = {
  not_available: 0,
  available: 1,
  occupied: 2,
  reserved: 3,
};

const STATUS_FROM_ADMIN: Record<number, TableStatus> = {
  0: 'not_available',
  1: 'available',
  2: 'occupied',
  3: 'reserved',
};

export function statusToAdmin(status: TableStatus): 0 | 1 | 2 | 3 {
  return STATUS_TO_ADMIN[status] ?? 1;
}

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

export async function setLink(zoneId: string, adminTableId: number | null): Promise<void> {
  const res = await fetch('/api/admin/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId, adminTableId }),
  });
  await parseJsonOrThrow(res, 'Failed to update the restoAdmin link');
}

export async function pushStatus(adminTableId: number, status: TableStatus): Promise<void> {
  const res = await fetch(`/api/admin/tables/${adminTableId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: statusToAdmin(status) }),
  });
  await parseJsonOrThrow(res, 'Failed to push status to restoAdmin');
}

export interface RemoteTableUpdate {
  adminTableId: number;
  status: TableStatus;
  dashboardZoneId: string | null;
}

// Opens the SSE stream and calls onUpdate for every restoAdmin table_updated
// event that carries a usable status. Returns an unsubscribe function.
// Failures (backend not running, network hiccup) are swallowed — the
// dashboard should keep working locally even if live sync is unavailable;
// EventSource retries the connection on its own.
export function subscribeToAdminUpdates(onUpdate: (event: RemoteTableUpdate) => void): () => void {
  let source: EventSource | null = null;
  try {
    source = new EventSource('/api/admin/stream');
    source.addEventListener('table_updated', (e: MessageEvent) => {
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
    });
    source.onerror = () => {
      // EventSource auto-reconnects; just log so silent backend outages are visible in devtools.
      console.warn('[adminSync] SSE stream error (will retry)');
    };
  } catch (err) {
    console.warn('[adminSync] could not open SSE stream', err);
  }

  return () => source?.close();
}
