// Thin authenticated client for restoAdmin's REST API.
//
// Every call runs as a signed-in dashboard user (an AdminSession from
// sessions.ts), with that user's restoAdmin tokens, which stay server-side —
// the dashboard's browser never sees them, it only ever talks to this
// backend's own /api/* routes (see index.ts and auth.ts). restoAdmin records
// that user as whoever created, confirmed or settled an order.
//
// Table status is restoAdmin's own numeric enum (0=Not Available,
// 1=Available, 2=Occupied, 3=Reserved — see src/components/users/Tables.tsx
// in restoAdmin). It's never written by this client: restoAdmin flips
// Available/Occupied itself on order create/confirm/settle/cancel, and
// Reserved/Not Available are set only from restoAdmin's Table Settings.
// Mapping to the dashboard's string TableStatus happens on the frontend
// (src/services/adminSync.ts).
//
// Works against restoAdmin exactly as it ships — no restoAdmin changes are
// needed. Which dashboard zone is which restoAdmin table lives only on this
// side, in src/data/floorLayout.json's adminTableId.

import { endSession, saveSession, type AdminSession, type DashboardUser, type SessionEndReason } from './sessions.js';

const ADMIN_API_BASE_URL = (process.env.ADMIN_API_BASE_URL || 'http://localhost:2000').replace(/\/+$/, '');
export const ADMIN_BRANCH_ID = Number(process.env.ADMIN_BRANCH_ID || 3);

export interface AdminTable {
  id: number;
  branchId: number | null;
  tableNumber: string;
  floor: 'gf' | '2f' | null;
  roomCharge: number | null;
  status: number;
}

export interface AdminOrderItem {
  id: number;
  orderId: number;
  menuId: number;
  menuName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

// orders.STATUS: 3=Pending, 2=Confirmed, 1=Settled, -1=Cancelled — restoAdmin's
// real order lifecycle enum (restoAdmin/src/services/orderService.ts
// ORDER_STATUS). This is what table Occupied/Available is derived from.
export interface AdminOrder {
  id: number;
  orderNo: string;
  tableId: number | null;
  orderType: string | null;
  status: number;
  subtotal: number;
  taxAmount: number;
  // Includes the linked table's room charge — see resolveServiceChargeWithRoomCharge
  // in restoAdmin's OrderModel. Never a line item in `items`.
  serviceCharge: number;
  discountAmount: number;
  grandTotal: number;
  // orders.ENCODED_DT as an ISO instant (see encodedDtToIso) — when the order
  // was created, which is when a room's booked hours start counting down.
  // Only GET /orders/data rows carry it; null from getOrderById.
  createdAt: string | null;
  // The linked table's hourly ROOM_CHARGE (null/0 = not an hourly room).
  // Only GET /orders/data rows carry it; null from getOrderById.
  roomRate: number | null;
  // The room the order is billed in now, from restoAdmin's room-charge
  // history (order_room_charges): its hours and when its clock started.
  // That's what the staff app's room timer and hours stepper read, and what
  // extend-room-charge changes. Differs from serviceCharge / roomRate once an
  // order has moved rooms (serviceCharge then also holds the earlier rooms).
  // Null when the history doesn't cover the order (see getCurrentRooms).
  roomHours: number | null;
  roomStartedAt: string | null;
  items: AdminOrderItem[];
}

export interface CurrentRoom {
  rate: number;
  hours: number;
  startedAt: string | null;
}

// The room an order is in now, from a staff-API `room_charges` list (GET
// /api/waiter/orders rows and order_updated events both carry one). The
// open row is the current room; null for a table with no room charge.
export function currentRoomOf(roomCharges: unknown): CurrentRoom | null {
  if (!Array.isArray(roomCharges)) return null;
  const active = roomCharges.filter((r: any) => r?.active).pop();
  if (!active) return null;
  return {
    rate: Number(active.rate) || 0,
    hours: Math.max(0, Number(active.hours) || 0),
    // started_at is Manila wall-clock time, like ENCODED_DT.
    startedAt: encodedDtToIso(active.started_at),
  };
}

// Normalizes orders.ENCODED_DT to an ISO instant the same way restoAdmin's own
// UI reads it (src/utils/manilaDateTime.ts parseEncodedDtToUtcMs): a Date or a
// string with Z/offset is already an instant, while a naive
// "YYYY-MM-DD HH:mm:ss" string is Asia/Manila wall-clock time.
export function encodedDtToIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const str = String(value).trim();
  const naive = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?$/);
  const d = naive ? new Date(`${naive[1]}T${naive[2]}${naive[3] ?? ''}+08:00`) : new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface AdminMenuItem {
  id: number;
  name: string;
  price: number;
  categoryName: string;
}

export interface CreateOrderItemInput {
  menuId: number;
  qty: number;
  unitPrice: number;
}

// billing.STATUS: 1=Paid, 2=Partial, 3=Unpaid (a distinct enum from
// orders.STATUS, despite overlapping numbers) — restoAdmin/server/models/billingModel.js.
export interface AdminBilling {
  orderId: number;
  paymentMethod: string;
  amountDue: number;
  amountPaid: number;
  status: number;
}

// Flat, all-fields-optional result shapes rather than a discriminated union:
// this repo's tsconfig doesn't enable strictNullChecks, which TS's narrowing
// of tagged unions (`if (result.ok) {...}` / `result.kind === 'x'`) depends
// on — without it, unions like this silently fail to narrow. A flat shape
// with optional fields needs no narrowing to use safely.
export interface CreateOrderResult {
  ok: boolean;
  id?: number;
  orderNo?: string;
  kind?: 'conflict' | 'insufficient' | 'error';
  existingOrderId?: number;
  existingOrderNo?: string;
  insufficient?: any[];
  message?: string;
}

export interface AddItemsResult {
  ok: boolean;
  orderId?: number;
  orderNo?: string;
  newSubtotal?: number;
  newGrandTotal?: number;
  kind?: 'insufficient' | 'error';
  insufficient?: any[];
  message?: string;
}

// Thrown when restoAdmin stops accepting a session's tokens. The session is
// already ended by then; index.ts turns this into a 401 so the browser goes
// back to its login page.
export class SessionEndedError extends Error {
  constructor(public code: Exclude<SessionEndReason, 'SIGNED_OUT'>) {
    super(code === 'SESSION_REPLACED' ? 'This account was signed in on another device.' : 'Your session has expired.');
  }
}

export interface AdminLoginResult {
  user: DashboardUser;
  // restoAdmin's user_role id (users.PERMISSIONS) and users.BRANCH_ID, for
  // auth.ts to decide whether this account may use the dashboard.
  permissions: number | null;
  branchId: number | null;
  accessToken: string;
  refreshToken: string;
}

// Signs a user in to restoAdmin (POST /api/login, the same call its staff app
// makes). Throws with restoAdmin's own message ("Incorrect password", …).
// restoAdmin makes this the account's only valid session as soon as it
// accepts the password, signing it out on any other device.
export async function loginToAdmin(username: string, password: string): Promise<AdminLoginResult> {
  const res = await fetch(`${ADMIN_API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `restoAdmin login failed (${res.status})`);
  }
  const data = json.data || {};
  const accessToken = json.tokens?.accessToken;
  const refreshToken = json.tokens?.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error('restoAdmin login response did not include tokens');
  }
  const toNumberOrNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    user: {
      id: Number(data.user_id),
      username: String(data.username ?? username),
      firstName: String(data.firstname ?? ''),
      lastName: String(data.lastname ?? ''),
    },
    permissions: toNumberOrNull(data.permissions),
    branchId: toNumberOrNull(data.branch_id),
    accessToken,
    refreshToken,
  };
}

// The session's 401 code from restoAdmin, if it said why.
async function authErrorCode(res: Response): Promise<string | null> {
  const json: any = await res.clone().json().catch(() => ({}));
  return typeof json?.code === 'string' ? json.code : null;
}

// One refresh at a time per session, shared by every request that hit an
// expired access token at once.
const refreshing = new Map<string, Promise<void>>();

function refresh(session: AdminSession): Promise<void> {
  let pending = refreshing.get(session.id);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${ADMIN_API_BASE_URL}/api/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || !json?.tokens?.accessToken) {
        const code = json?.code === 'SESSION_REPLACED' ? 'SESSION_REPLACED' : 'SESSION_EXPIRED';
        endSession(session.id, code);
        throw new SessionEndedError(code);
      }
      session.accessToken = json.tokens.accessToken;
      session.refreshToken = json.tokens.refreshToken || session.refreshToken;
      saveSession(session);
    })().finally(() => refreshing.delete(session.id));
    refreshing.set(session.id, pending);
  }
  return pending;
}

// Calls restoAdmin as the session's user, refreshing the access token once
// if it was rejected. Ends the session (and throws SessionEndedError) if the
// account signed in elsewhere or the refresh token is no longer valid.
async function authedFetch(session: AdminSession, path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
  const res = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      Authorization: `Bearer ${session.accessToken}`,
    },
  });
  if (res.status !== 401) return res;

  const code = await authErrorCode(res);
  if (code === 'SESSION_REPLACED' || isRetry) {
    const reason = code === 'SESSION_REPLACED' ? 'SESSION_REPLACED' : 'SESSION_EXPIRED';
    endSession(session.id, reason);
    throw new SessionEndedError(reason);
  }
  await refresh(session);
  return authedFetch(session, path, init, true);
}

function mapAdminRow(row: any): AdminTable {
  return {
    id: Number(row.IDNo),
    branchId: row.BRANCH_ID != null ? Number(row.BRANCH_ID) : null,
    tableNumber: String(row.TABLE_NUMBER ?? ''),
    floor: row.FLOOR === 'gf' || row.FLOOR === '2f' ? row.FLOOR : null,
    roomCharge: row.ROOM_CHARGE != null ? Number(row.ROOM_CHARGE) : null,
    status: Number(row.STATUS ?? 0),
  };
}

export async function getBlueMoonTables(session: AdminSession): Promise<AdminTable[]> {
  const res = await authedFetch(session, `/restaurant_tables?branch_id=${ADMIN_BRANCH_ID}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin tables (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  return rows.map(mapAdminRow);
}

function mapAdminOrderItem(row: any): AdminOrderItem {
  return {
    id: Number(row.IDNo),
    orderId: Number(row.ORDER_ID),
    menuId: Number(row.MENU_ID),
    menuName: String(row.MENU_NAME ?? ''),
    qty: Number(row.QTY ?? 0),
    unitPrice: Number(row.UNIT_PRICE ?? 0),
    lineTotal: Number(row.LINE_TOTAL ?? 0),
  };
}

function mapAdminOrder(row: any, items: AdminOrderItem[]): AdminOrder {
  return {
    id: Number(row.IDNo),
    orderNo: String(row.ORDER_NO ?? ''),
    tableId: row.TABLE_ID != null ? Number(row.TABLE_ID) : null,
    orderType: row.ORDER_TYPE ?? null,
    status: Number(row.STATUS ?? 0),
    subtotal: Number(row.SUBTOTAL ?? 0),
    taxAmount: Number(row.TAX_AMOUNT ?? 0),
    serviceCharge: Number(row.SERVICE_CHARGE ?? 0),
    discountAmount: Number(row.DISCOUNT_AMOUNT ?? 0),
    grandTotal: Number(row.GRAND_TOTAL ?? 0),
    createdAt: encodedDtToIso(row.ENCODED_DT),
    roomRate: row.ROOM_CHARGE != null ? Number(row.ROOM_CHARGE) : null,
    roomHours: null,
    roomStartedAt: null,
    items,
  };
}

function withCurrentRoom(order: AdminOrder, room: CurrentRoom | undefined): AdminOrder {
  if (!room) return order;
  return { ...order, roomHours: room.hours, roomStartedAt: room.startedAt, roomRate: room.rate || order.roomRate };
}

// Each open order's current room, keyed by order id, from the staff app's own
// order list (GET /api/waiter/orders: the business day's orders with their
// room history; restoAdmin exposes the history nowhere else). Best-effort:
// an order it doesn't cover (none yet for a room no staff-app action has
// touched, or one opened before the business day) keeps roomHours null.
async function getCurrentRooms(session: AdminSession): Promise<Map<number, CurrentRoom>> {
  const rooms = new Map<number, CurrentRoom>();
  try {
    const res = await authedFetch(session, `/api/waiter/orders?branch_id=${ADMIN_BRANCH_ID}`);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) return rooms;
    for (const row of Array.isArray(json.data) ? json.data : []) {
      const room = currentRoomOf(row?.room_charges);
      if (room) rooms.set(Number(row.order_id), room);
    }
  } catch (err: any) {
    if (err instanceof SessionEndedError) throw err;
    console.warn('[adminClient] room history unavailable', err?.message || err);
  }
  return rooms;
}

// Order statuses that count as "active" for the one-order-per-table
// invariant restoAdmin's own OrderController.create enforces (2=Confirmed,
// 3=Pending). Mirrors restoAdmin's ORDER_STATUS constants.
const ACTIVE_ORDER_STATUSES = [2, 3];

export async function getMenuForBranch(session: AdminSession): Promise<AdminMenuItem[]> {
  const res = await authedFetch(session, `/menus?branch_id=${ADMIN_BRANCH_ID}&include_description=0`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin menu (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .filter((row: any) => {
      const active = Boolean(row.ACTIVE);
      const available = row.EFFECTIVE_AVAILABLE === undefined ? Boolean(row.IS_AVAILABLE) : Boolean(row.EFFECTIVE_AVAILABLE);
      return active && available;
    })
    .map((row: any) => ({
      id: Number(row.IDNo),
      name: String(row.MENU_NAME ?? ''),
      price: Number(row.MENU_PRICE ?? 0),
      categoryName: String(row.CATEGORY_NAME ?? 'Uncategorized'),
    }));
}

export interface MenuPopularity {
  menuId: number;
  qty: number;
  revenue: number;
}

// How many items to ask GET /api/menu/top-revenue for. Above the branch's
// whole menu (~300), so every item that has ever sold comes back ranked, not
// just the top few.
const POPULARITY_LIMIT = 1000;

// All-time units sold and revenue per menu item, ranked by revenue — the
// same endpoint the staff app's "Top Revenue Items" uses. Feeds the order
// screen's Top Revenue section and Quick Add Drinks ranking. Returns [] if
// this restoAdmin doesn't have the route, so the order screen still works,
// just unranked.
export async function getMenuPopularity(session: AdminSession): Promise<MenuPopularity[]> {
  const res = await authedFetch(session, `/api/menu/top-revenue?branch_id=${ADMIN_BRANCH_ID}&limit=${POPULARITY_LIMIT}`);
  if (res.status === 404 || res.status === 501) return [];
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin top revenue items (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((row: any) => ({
    menuId: Number(row.id),
    qty: Number(row.sales_qty ?? 0),
    revenue: Number(row.total_revenue ?? 0),
  }));
}

// The branch's Pending/Confirmed order rows, straight from GET /orders/data —
// restoAdmin has no "active orders" filter, so this pulls the branch's
// latest orders (restoAdmin caps an undated list at 2000) and filters here.
// These rows, unlike GET /orders/:id, carry ENCODED_DT and the table's
// ROOM_CHARGE, which the room timer needs.
async function getActiveOrderRows(session: AdminSession): Promise<any[]> {
  const res = await authedFetch(session, `/orders/data?branch_id=${ADMIN_BRANCH_ID}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin orders (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.filter((row: any) => ACTIVE_ORDER_STATUSES.includes(Number(row.STATUS)));
}

async function getOrderItems(session: AdminSession, orderId: number): Promise<AdminOrderItem[]> {
  const res = await authedFetch(session, `/orders/${orderId}/items`);
  const json: any = await res.json().catch(() => ({}));
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map(mapAdminOrderItem);
}

// There's no direct "active order for table" endpoint, so this filters the
// branch's order list — the same data OrderModel's own 409-guard query
// resolves server-side, just without a dedicated route.
export async function getActiveOrderForTable(session: AdminSession, tableId: number): Promise<AdminOrder | null> {
  const [rows, rooms] = await Promise.all([getActiveOrderRows(session), getCurrentRooms(session)]);
  const match = rows.find((row: any) => Number(row.TABLE_ID) === tableId);
  if (!match) return null;
  const order = mapAdminOrder(match, await getOrderItems(session, Number(match.IDNo)));
  return withCurrentRoom(order, rooms.get(order.id));
}

// Batched equivalent of calling getActiveOrderForTable once per table: one
// order-list fetch, then items only for the active orders (in parallel) —
// used for the once-on-load reconciliation in App.tsx so "Active Orders" and
// each table's order detail are already populated on a fresh load, not just
// their Available/Occupied status.
export async function getActiveOrdersForBranch(session: AdminSession): Promise<AdminOrder[]> {
  const [rows, rooms] = await Promise.all([getActiveOrderRows(session), getCurrentRooms(session)]);
  return Promise.all(
    rows.map(async (row: any) =>
      withCurrentRoom(mapAdminOrder(row, await getOrderItems(session, Number(row.IDNo))), rooms.get(Number(row.IDNo)))
    )
  );
}

// The order's current row (without createdAt/roomRate — GET /orders/:id
// doesn't return them) and items.
export async function getOrderById(session: AdminSession, orderId: number): Promise<AdminOrder | null> {
  const [orderRes, items] = await Promise.all([authedFetch(session, `/orders/${orderId}`), getOrderItems(session, orderId)]);
  const orderJson: any = await orderRes.json().catch(() => ({}));
  if (!orderRes.ok || orderJson?.success === false) {
    if (orderRes.status === 404) return null;
    throw new Error(orderJson?.error || orderJson?.message || `Failed to fetch restoAdmin order (${orderRes.status})`);
  }
  return mapAdminOrder(orderJson.data, items);
}

// How many later seconds to try when the generated number is already taken
// (two orders created in the same second). Staff can't edit the number, so a
// collision has to be resolved here instead of surfacing as an error.
const ORDER_NO_ATTEMPTS = 5;

export interface CreateOrderParams {
  tableId: number;
  orderType: string;
  items: CreateOrderItemInput[];
  // Hours the room is booked for (1 = the base hour restoAdmin always adds
  // automatically for a table with a ROOM_CHARGE — see resolveServiceChargeWithRoomCharge).
  // Anything beyond 1 is billed as additional SERVICE_CHARGE here, and 0
  // waives it (-rate cancels the base hour, as the staff app does). Omit for
  // a table with no room charge, or when the caller doesn't need to adjust it.
  roomChargeQty?: number;
}

// The SERVICE_CHARGE to send on top of the base hour restoAdmin adds by
// itself: (hours - 1) x rate, so -rate when the room charge is waived.
async function extraRoomCharge(session: AdminSession, tableId: number, roomChargeQty: number | undefined): Promise<number> {
  const qty = roomChargeQty == null || !Number.isFinite(Number(roomChargeQty)) ? 1 : Math.max(0, Number(roomChargeQty));
  if (qty === 1) return 0;
  const tables = await getBlueMoonTables(session);
  const rate = tables.find((t) => t.id === tableId)?.roomCharge || 0;
  return (qty - 1) * rate;
}

// Dashboard orders skip the Pending step and go straight to Confirmed, the
// same create-then-confirm the staff app does, so restoAdmin's Activity tab
// shows "Confirmed order" after the new order like it does for a tablet's.
// If the confirm fails, cancel the just-created order so the table isn't
// left holding a half-made one.
async function confirmNewOrder(session: AdminSession, id: number, orderNo: string): Promise<CreateOrderResult> {
  const confirmed = await updateOrderStatus(session, id, 2).catch((err: any) => ({ ok: false, message: err?.message }));
  if (!confirmed.ok) {
    await updateOrderStatus(session, id, -1).catch(() => undefined);
    return { ok: false, kind: 'error', message: confirmed.message || 'Order was created but could not be confirmed, so it was cancelled.' };
  }
  return { ok: true, id, orderNo };
}

// An instant as Asia/Manila wall-clock parts, the time zone restoAdmin reads
// a naive ENCODED_DT in (see encodedDtToIso).
function manilaParts(date: Date) {
  const d = new Date(date.getTime() + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    ymd: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hms: `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

export interface CreateOrderAtResult extends CreateOrderResult {
  // The items went onto the table's already-open order instead (mergeOnConflict).
  merged?: boolean;
}

// Creates an order taken at `createdAt` (the web passes "now"), safely
// repeatable, so one the tablet saved while offline (or whose answer was
// lost) can be sent again without making a second order.
//
// It goes through restoAdmin's staff-app endpoint, POST /api/orders, the one
// the staff app (restoapp) uses: restoAdmin logs it in the Activity tab
// ("New order"), starts the room's clock in its room history, keeps the given
// ENCODED_DT (so the room timer starts when the order was really taken) and
// answers a repeated ORDER_NO with the order it already made
// (`already_exists`) instead of an error. The number is derived from
// `createdAt`, so every retry of one order sends the same number. If that
// number belongs to another table's order (two orders in the same second),
// it steps a second forward.
//
// Like the staff app, nothing here deducts ingredient stock: only restoAdmin's
// admin endpoints do, and Blue Moon has no recipes set up.
//
// With `mergeOnConflict`, a table that already has an open order (someone
// opened one while this order waited offline) gets these items added to it
// instead; the room hours are left as that order has them.
export async function createOrderAt(
  session: AdminSession,
  params: CreateOrderParams & { createdAt: string; mergeOnConflict?: boolean }
): Promise<CreateOrderAtResult> {
  const createdAt = new Date(params.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    return { ok: false, kind: 'error', message: 'Invalid order time' };
  }
  const subtotal = params.items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
  const serviceCharge = await extraRoomCharge(session, params.tableId, params.roomChargeQty);
  const { date, time } = manilaParts(createdAt);

  const postOrder = (orderNo: string) =>
    authedFetch(session, '/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        branch_id: ADMIN_BRANCH_ID,
        order_no: orderNo,
        table_id: params.tableId,
        order_type: params.orderType,
        subtotal,
        tax_amount: 0,
        service_charge: serviceCharge,
        discount_amount: 0,
        grand_total: subtotal + serviceCharge,
        items: params.items.map((it) => ({ menu_id: it.menuId, qty: it.qty, unit_price: it.unitPrice, status: 3 })),
        encoded_dt: `${date} ${time}`,
      }),
    });

  let res!: Response;
  let json: any;
  for (let attempt = 0; attempt < ORDER_NO_ATTEMPTS; attempt++) {
    const { ymd, hms } = manilaParts(new Date(createdAt.getTime() + attempt * 1000));
    res = await postOrder(`ORD-${ymd}-${hms}`);
    json = await res.json().catch(() => ({}));
    const takenByAnotherTable =
      res.ok && json?.data?.already_exists === true && Number(json.data.table_id) !== params.tableId;
    if (!takenByAnotherTable) break;
  }

  if (res.ok && json?.success !== false && json?.data?.order_id != null) {
    const id = Number(json.data.order_id);
    const orderNo = String(json.data.order_no);
    // Already made by an earlier try: confirm it only if that try stopped
    // short of it. Settled or cancelled since then also counts as done.
    if (json.data.already_exists === true && Number(json.data.status) !== 3) {
      return { ok: true, id, orderNo };
    }
    return confirmNewOrder(session, id, orderNo);
  }
  if (res.status === 409 && json?.code === 'ACTIVE_ORDER_EXISTS') {
    const existingOrderId = Number(json.existing_order_id);
    if (params.mergeOnConflict) {
      if (params.items.length === 0) {
        // Nothing to add: the open order already bills the room.
        return { ok: true, id: existingOrderId, orderNo: String(json.existing_order_no), merged: true };
      }
      const added = await addItemsToOrder(session, existingOrderId, params.items, params.createdAt);
      if (!added.ok) return { ok: false, kind: added.kind, insufficient: added.insufficient, message: added.message };
      return { ok: true, id: existingOrderId, orderNo: String(json.existing_order_no), merged: true };
    }
    return {
      ok: false,
      kind: 'conflict',
      existingOrderId,
      existingOrderNo: String(json.existing_order_no),
      message: 'This table already has an active order.',
    };
  }
  if (Array.isArray(json?.insufficient) && json.insufficient.length) {
    return { ok: false, kind: 'insufficient', insufficient: json.insufficient, message: json.error || 'Insufficient inventory' };
  }
  return { ok: false, kind: 'error', message: json?.error || json?.message || `Failed to create order (${res.status})` };
}

// When something was really done, as restoAdmin's staff endpoints take it
// (`client_at`, Manila 'YYYY-MM-DD HH:MM:SS'): a change the tablet saved while
// offline and sends later is logged at the time it was made, not when it
// synced. Undefined when not given, or not a valid time.
function clientAt(at: string | undefined): string | undefined {
  if (!at) return undefined;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return undefined;
  const { date, time } = manilaParts(d);
  return `${date} ${time}`;
}

// Adds items to an open order through the staff app's endpoint, so restoAdmin
// logs it ("Added: …") and the staff app's cashier is alerted as for a
// tablet's. `at` is when it was really done (see clientAt).
export async function addItemsToOrder(
  session: AdminSession,
  orderId: number,
  items: CreateOrderItemInput[],
  at?: string
): Promise<AddItemsResult> {
  const res = await authedFetch(session, `/api/orders/${orderId}/items?branch_id=${ADMIN_BRANCH_ID}`, {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((it) => ({ menu_id: it.menuId, qty: it.qty, unit_price: it.unitPrice })),
      client_at: clientAt(at),
    }),
  });
  const json: any = await res.json().catch(() => ({}));

  if (res.ok && json?.success !== false) {
    return {
      ok: true,
      orderId: Number(json.data.order_id),
      orderNo: String(json.data.order_no),
      newSubtotal: Number(json.data.new_subtotal),
      newGrandTotal: Number(json.data.new_grand_total),
    };
  }
  if (Array.isArray(json?.insufficient) && json.insufficient.length) {
    return { ok: false, kind: 'insufficient', insufficient: json.insufficient, message: json.error || 'Insufficient inventory' };
  }
  return { ok: false, kind: 'error', message: json?.error || json?.message || `Failed to add items (${res.status})` };
}

export interface UpdateItemResult {
  ok: boolean;
  newSubtotal?: number;
  newGrandTotal?: number;
  kind?: 'insufficient' | 'error';
  insufficient?: any[];
  message?: string;
}

// Confirm (2) or Cancel (-1) an order through the staff app's endpoint, so
// restoAdmin logs it ("Confirmed order" / "Cancelled order") like a tablet's.
// On cancel it also frees the table and stops the room's clock in the room
// history. It emits order_updated either way, which socketBridge relays.
export async function updateOrderStatus(session: AdminSession, orderId: number, status: 2 | -1): Promise<{ ok: boolean; message?: string }> {
  const res = await authedFetch(session, `/api/waiter/orders/${orderId}/status?branch_id=${ADMIN_BRANCH_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to update order status (${res.status})` };
}

// Sets how many hours the room an open (Pending/Confirmed) order is in now is
// billed for: 0 waives it. Goes through the staff app's own endpoint, which
// keeps restoAdmin's room-charge history (order_room_charges) in step,
// recomputes SERVICE_CHARGE from it (earlier rooms of a moved order stay as
// they were), logs it in the Activity tab and broadcasts the change. A plain
// PUT /orders/:id would change SERVICE_CHARGE behind the history's back: the
// staff app would keep timing the old hours, and its next extend would bill
// the difference a second time.
// `at` is when it was really done (see clientAt).
export async function updateOrderRoomCharge(
  session: AdminSession,
  orderId: number,
  roomChargeQty: number,
  at?: string
): Promise<{ ok: boolean; message?: string }> {
  const sessions = Math.round(Math.max(0, roomChargeQty) * 2) / 2;
  const res = await authedFetch(session, `/api/waiter/orders/${orderId}/extend-room-charge?branch_id=${ADMIN_BRANCH_ID}`, {
    method: 'POST',
    body: JSON.stringify({ sessions, client_at: clientAt(at) }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to update room charge (${res.status})` };
}

// An order's item rows as restoAdmin stores them (order_items: IDNo, MENU_ID,
// QTY, UNIT_PRICE, STATUS, REMARKS, ENCODED_DT), oldest first.
async function getOrderItemRows(session: AdminSession, orderId: number): Promise<any[]> {
  const res = await authedFetch(session, `/orders/${orderId}/items`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch the order's items (${res.status})`);
  }
  const timeOf = (row: any) => Date.parse(encodedDtToIso(row.ENCODED_DT) ?? '') || 0;
  return (Array.isArray(json.data) ? json.data : []).sort(
    (a: any, b: any) => timeOf(a) - timeOf(b) || Number(a.IDNo) - Number(b.IDNo)
  );
}

// Changes item lines of an open order: `changes` maps an order_items IDNo to
// its new qty, 0 removing the line. Goes through the staff app's edit-order
// endpoint, so restoAdmin logs it ("Edited: …") and alerts the staff app's
// cashier like a tablet's edit. That endpoint replaces the order's whole item
// list, so this sends every current line with only these changed, each
// keeping its price and kitchen status; restoAdmin carries the lines' notes
// and order times over by menu item. It refuses an empty list, so removing an
// order's last items goes through the admin delete instead (not logged).
export async function editOrderItems(
  session: AdminSession,
  orderId: number,
  changes: Map<number, number>
): Promise<UpdateItemResult> {
  const rows = await getOrderItemRows(session, orderId);
  const ids = new Set(rows.map((r) => Number(r.IDNo)));
  if (![...changes.keys()].every((id) => ids.has(id))) {
    return { ok: false, kind: 'error', message: 'That item is no longer on this order. Refresh and try again.' };
  }
  const next = rows.flatMap((row) => {
    const qty = changes.get(Number(row.IDNo));
    if (qty == null) return [row];
    return qty > 0 ? [{ ...row, QTY: qty }] : [];
  });

  if (next.length === 0) {
    for (const id of changes.keys()) {
      const removed = await deleteOrderItem(session, id);
      if (!removed.ok) return { ok: false, kind: 'error', message: removed.message };
    }
    return { ok: true };
  }

  const res = await authedFetch(session, `/api/orders/${orderId}/items?branch_id=${ADMIN_BRANCH_ID}`, {
    method: 'PUT',
    body: JSON.stringify({
      items: next.map((row) => ({
        menu_id: Number(row.MENU_ID),
        qty: Number(row.QTY),
        unit_price: Number(row.UNIT_PRICE),
        status: Number(row.STATUS) || 3,
      })),
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true, newGrandTotal: Number(json.data?.new_grand_total) };
  }
  return { ok: false, kind: 'error', message: json?.error || json?.message || `Failed to update the order's items (${res.status})` };
}

// The admin endpoints for one line, for tablets on an app older than 0.5.3,
// which don't send the order id editOrderItems needs. Not logged in the staff
// app's Activity tab.
export async function updateOrderItemQty(session: AdminSession, itemId: number, qty: number): Promise<UpdateItemResult> {
  const res = await authedFetch(session, `/order_items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ qty }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true, newSubtotal: Number(json.data?.new_subtotal), newGrandTotal: Number(json.data?.new_grand_total) };
  }
  if (Array.isArray(json?.insufficient) && json.insufficient.length) {
    return { ok: false, kind: 'insufficient', insufficient: json.insufficient, message: json.error || 'Insufficient inventory' };
  }
  return { ok: false, kind: 'error', message: json?.error || json?.message || `Failed to update item (${res.status})` };
}

export async function deleteOrderItem(session: AdminSession, itemId: number): Promise<{ ok: boolean; message?: string }> {
  const res = await authedFetch(session, `/order_items/${itemId}`, { method: 'DELETE' });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to delete item (${res.status})` };
}

async function getBillingRow(session: AdminSession, orderId: number): Promise<any | null> {
  const res = await authedFetch(session, `/billing/${orderId}`);
  if (res.status === 404) return null;
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch billing record (${res.status})`);
  }
  return json.data ?? null;
}

// The order's billing, with amountDue the order's current GRAND_TOTAL rather
// than billing.AMOUNT_DUE. restoAdmin doesn't keep the two in step: the staff
// app's room-hours change (extend-room-charge) updates only the order, so
// after one, AMOUNT_DUE still holds the old total, and a settle reading it
// would ask for too little.
export async function getBilling(session: AdminSession, orderId: number): Promise<AdminBilling | null> {
  const [row, order] = await Promise.all([getBillingRow(session, orderId), getOrderById(session, orderId)]);
  if (!row) return null;
  return {
    orderId: Number(row.ORDER_ID),
    paymentMethod: String(row.PAYMENT_METHOD ?? 'CASH'),
    amountDue: order ? order.grandTotal : Number(row.AMOUNT_DUE ?? 0),
    amountPaid: Number(row.AMOUNT_PAID ?? 0),
    status: Number(row.STATUS ?? 3),
  };
}

// Brings billing.AMOUNT_DUE up to the order's GRAND_TOTAL (see getBilling)
// before a payment goes through restoAdmin's billing endpoint, which decides
// Partial vs Paid from AMOUNT_DUE. restoAdmin has no billing-only update, so
// this re-saves the order as it is through PUT /orders/:id, which rewrites
// AMOUNT_DUE. That endpoint adds the table's room rate to the SERVICE_CHARGE
// it's given, so it's sent the charge minus that rate to keep it unchanged.
async function syncAmountDue(session: AdminSession, orderId: number): Promise<void> {
  const [row, order] = await Promise.all([getBillingRow(session, orderId), getOrderById(session, orderId)]);
  if (!row || !order || Math.abs(order.grandTotal - Number(row.AMOUNT_DUE ?? 0)) < 0.005) return;
  const tables = order.tableId != null ? await getBlueMoonTables(session) : [];
  const rate = tables.find((t) => t.id === order.tableId)?.roomCharge || 0;
  const res = await authedFetch(session, `/orders/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({
      TABLE_ID: order.tableId,
      ORDER_TYPE: order.orderType,
      STATUS: order.status,
      SUBTOTAL: order.subtotal,
      TAX_AMOUNT: order.taxAmount,
      SERVICE_CHARGE: order.serviceCharge - rate,
      DISCOUNT_AMOUNT: order.discountAmount,
      GRAND_TOTAL: order.grandTotal,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to update the order's amount due (${res.status})`);
  }
}

// Takes a payment. Paying the whole balance of an order nothing has been paid
// on yet goes through the staff app's settle (the cashier app's), so
// restoAdmin logs it in the Activity tab ("Settled ₱… · CASH"), stops the
// room's clock in the room history and writes the billing record from the
// order's current total. A partial payment, or the rest of a partly paid
// bill, goes through restoAdmin's billing endpoint (its Billing screen's
// "Process Payment"): the staff settle only settles in full, and it would
// record the earlier payment a second time. That endpoint adds amountPaid to
// what's already paid and settles the order once the total is covered; it's
// not logged in the Activity tab.
export async function settleOrder(
  session: AdminSession,
  orderId: number,
  params: { paymentMethod: string; amountPaid: number; paymentRef: string | null }
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const billing = await getBilling(session, orderId);
  if (!billing) return { ok: false, message: 'This order has no billing record in restoAdmin.' };
  const remaining = billing.amountDue - billing.amountPaid;

  if (billing.amountPaid <= 0 && params.amountPaid >= remaining - 0.005) {
    const res = await authedFetch(session, `/api/waiter/orders/${orderId}/status?branch_id=${ADMIN_BRANCH_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 1,
        payment_method: params.paymentMethod,
        amount_paid: params.amountPaid,
        // restoAdmin fills a cash payment's empty reference with "Settled via
        // Cashier App"; say where it really came from instead.
        payment_ref: params.paymentRef || (params.paymentMethod === 'CASH' ? 'Settled via Dashboard' : null),
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok && json?.success !== false) return { ok: true, status: 1 };
    return { ok: false, message: json?.error || json?.message || `Failed to settle order (${res.status})` };
  }

  await syncAmountDue(session, orderId);
  const res = await authedFetch(session, `/billing/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({
      payment_method: params.paymentMethod,
      amount_paid: params.amountPaid,
      payment_ref: params.paymentRef,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true, status: Number(json.data?.status) };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to settle order (${res.status})` };
}

export interface SalesTotal {
  // Sum of billing.AMOUNT_PAID — money actually taken, so a partially paid
  // order counts only what's been paid so far.
  totalPaid: number;
  paidCount: number;
}

// Branch-wide paid sales for an inclusive Manila-local date range
// (YYYY-MM-DD). Reuses restoAdmin's own Billing page stats (billing rows on
// confirmed/settled orders, dated by billing.ENCODED_DT), so the figure
// matches what restoAdmin shows for the same range. limit=1 because only
// the stats are wanted, not the rows.
export async function getSalesTotal(session: AdminSession, startDate: string, endDate: string): Promise<SalesTotal> {
  const qs = new URLSearchParams({
    branch_id: String(ADMIN_BRANCH_ID),
    start_date: startDate,
    end_date: endDate,
    include_stats: '1',
    limit: '1',
  });
  const res = await authedFetch(session, `/billing/data?${qs}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch sales from restoAdmin (${res.status})`);
  }
  const stats = json?.meta?.stats || {};
  return {
    totalPaid: Number(stats.totalPaid ?? 0),
    paidCount: Number(stats.paidCount ?? 0),
  };
}

export { ADMIN_API_BASE_URL };
