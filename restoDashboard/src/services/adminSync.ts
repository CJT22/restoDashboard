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

// Single shared EventSource for /api/admin/stream. Table sync (this module),
// order sync (services/orderSync.ts) and the connection badge all register
// listeners here rather than each opening their own connection. The stream
// opens with the first listener and closes when the last one goes.
//
// EventSource retries a dropped connection by itself, but gives up for good
// if a retry gets an HTTP error — e.g. the dev proxy's 502 while this
// backend restarts — which used to stop live updates until a page reload.
// So a stream that ends up closed is recreated here after a short delay,
// with every registered listener re-attached.
type StreamHandler = (e: MessageEvent) => void;

const REOPEN_DELAY_MS = 3000;

const streamListeners = new Map<string, Set<StreamHandler>>();
let sharedSource: EventSource | null = null;
let attachedEvents = new Set<string>();
let reopenTimer: ReturnType<typeof setTimeout> | null = null;

// Connection state, for the sidebar badge (see subscribeToConnectionStatus).
type StreamState = 'connecting' | 'open' | 'down';
let streamState: StreamState = 'connecting';
// This backend's own link to restoAdmin, from the stream's bridge_status
// event; null until the (possibly restarted) backend has reported it.
let bridgeConnected: boolean | null = null;

const hasListeners = () => [...streamListeners.values()].some((set) => set.size > 0);

function attachEvent(source: EventSource, eventName: string) {
  if (attachedEvents.has(eventName)) return;
  attachedEvents.add(eventName);
  source.addEventListener(eventName, (e) => {
    streamListeners.get(eventName)?.forEach((handler) => handler(e as MessageEvent));
  });
}

function openStream() {
  if (sharedSource) return;
  let source: EventSource;
  try {
    source = new EventSource('/api/admin/stream');
  } catch (err) {
    console.warn('[adminSync] could not open SSE stream', err);
    setStreamState('down');
    scheduleReopen();
    return;
  }
  sharedSource = source;
  attachedEvents = new Set();
  streamListeners.forEach((_, eventName) => attachEvent(source, eventName));

  source.onopen = () => {
    bridgeConnected = null;
    setStreamState('open');
  };
  source.onerror = () => {
    console.warn('[adminSync] SSE stream error (will retry)');
    setStreamState('down');
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      if (sharedSource === source) sharedSource = null;
      scheduleReopen();
    }
  };
}

function scheduleReopen() {
  if (reopenTimer) return;
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    if (hasListeners()) openStream();
  }, REOPEN_DELAY_MS);
}

function closeStreamIfUnused() {
  if (hasListeners()) return;
  if (reopenTimer) {
    clearTimeout(reopenTimer);
    reopenTimer = null;
  }
  sharedSource?.close();
  sharedSource = null;
  streamState = 'connecting';
  bridgeConnected = null;
}

// Registers a handler for one SSE event type on the shared stream (opening
// it if needed). Returns the matching unsubscribe.
export function listenToAdminStream(eventName: string, handler: StreamHandler): () => void {
  let handlers = streamListeners.get(eventName);
  if (!handlers) {
    handlers = new Set();
    streamListeners.set(eventName, handlers);
  }
  handlers.add(handler);
  if (sharedSource) attachEvent(sharedSource, eventName);
  else openStream();

  return () => {
    handlers!.delete(handler);
    closeStreamIfUnused();
  };
}

// What the sidebar's connection badge shows:
//   connecting   — first connection attempt still in progress
//   live         — stream up and this backend is connected to restoAdmin
//   adminOffline — stream up, but this backend can't reach restoAdmin, so
//                  no live updates arrive
//   offline      — this dashboard's own backend is unreachable (retrying)
export type ConnectionStatus = 'connecting' | 'live' | 'adminOffline' | 'offline';

const statusSubscribers = new Set<(status: ConnectionStatus) => void>();

export function getConnectionStatus(): ConnectionStatus {
  if (streamState === 'connecting') return 'connecting';
  if (streamState === 'down') return 'offline';
  return bridgeConnected === false ? 'adminOffline' : 'live';
}

function notifyStatus() {
  const status = getConnectionStatus();
  statusSubscribers.forEach((cb) => cb(status));
}

function setStreamState(next: StreamState) {
  streamState = next;
  notifyStatus();
}

// Calls onChange with the current status now and on every change after.
// Keeps the shared stream open while subscribed.
export function subscribeToConnectionStatus(onChange: (status: ConnectionStatus) => void): () => void {
  statusSubscribers.add(onChange);
  const stopListening = listenToAdminStream('bridge_status', (e) => {
    try {
      bridgeConnected = Boolean(JSON.parse(e.data).connected);
      notifyStatus();
    } catch (err) {
      console.warn('[adminSync] bad bridge_status payload', err);
    }
  });
  onChange(getConnectionStatus());
  return () => {
    statusSubscribers.delete(onChange);
    stopListening();
  };
}

// Subscribes to restoAdmin table_updated events on the shared stream and
// calls onUpdate for every one that carries a usable status. Returns an
// unsubscribe function. Failures (backend not running, network hiccup) are
// swallowed — the dashboard should keep working locally even if live sync
// is unavailable.
export function subscribeToAdminUpdates(onUpdate: (event: RemoteTableUpdate) => void): () => void {
  return listenToAdminStream('table_updated', (e) => {
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
}

// Startup sanity check for the fixed layout (src/data/floorLayout.json):
// warns in the browser console — never to staff — when a zone's restoAdmin
// link has drifted, e.g. a table was deleted or renamed in restoAdmin's Table
// Settings, or a Blue Moon table was added that has no zone. Fixing any of
// these means re-enabling the layout editor (docs/layout-editor.md).
export function warnOnLayoutLinkDrift(
  zones: { id: string; name: string; adminTableId?: number; adminTableName?: string }[],
  adminTables: AdminTable[]
): void {
  const byId = new Map(adminTables.map((t) => [t.id, t]));
  const problems: string[] = [];

  for (const zone of zones) {
    if (zone.adminTableId == null) {
      problems.push(`Zone "${zone.name}" (${zone.id}) isn't linked to any restoAdmin table.`);
      continue;
    }
    const table = byId.get(zone.adminTableId);
    if (!table) {
      problems.push(`Zone "${zone.name}" is linked to restoAdmin table #${zone.adminTableId}, which no longer exists.`);
      continue;
    }
    if (zone.adminTableName != null && table.tableNumber !== zone.adminTableName) {
      problems.push(
        `restoAdmin table #${table.id} was renamed from "${zone.adminTableName}" to "${table.tableNumber}" (zone "${zone.name}").`
      );
    }
    if (table.dashboardZoneId !== zone.id) {
      problems.push(
        `restoAdmin table #${table.id} ("${table.tableNumber}") points at zone ${table.dashboardZoneId ?? 'none'}, not "${zone.name}" (${zone.id}).`
      );
    }
  }

  const linkedIds = new Set(zones.map((z) => z.adminTableId));
  for (const table of adminTables) {
    if (!linkedIds.has(table.id)) {
      problems.push(`restoAdmin table #${table.id} ("${table.tableNumber}") has no zone on the floor plan.`);
    }
  }

  if (problems.length > 0) {
    console.warn(
      `[layout] Floor plan and restoAdmin tables are out of step (see docs/layout-editor.md):\n- ${problems.join('\n- ')}`
    );
  }
}
