// Thin authenticated client for restoAdmin's REST API.
//
// Holds the restoAdmin service-account credentials and access/refresh tokens
// entirely server-side — the dashboard's browser never sees them, it only
// ever talks to this backend's own /api/admin/* routes (see index.ts).
//
// Table status is restoAdmin's own numeric enum, now just 1=Available,
// 2=Occupied (see src/components/users/Tables.tsx in restoAdmin) — table
// status is a pure reflection of order lifecycle (restoAdmin already flips
// it automatically on order create/confirm/settle/cancel) and is never
// written by this client. Mapping to/from the dashboard's string TableStatus
// happens on the frontend (src/services/adminSync.ts).

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
  createdAt: string | null;
  // The linked table's hourly ROOM_CHARGE (null/0 = not an hourly room).
  roomRate: number | null;
  items: AdminOrderItem[];
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
    items,
  };
}

// Order statuses that count as "active" for the one-order-per-table
// invariant restoAdmin's own OrderController.create enforces (2=Confirmed,
// 3=Pending). Mirrors restoAdmin's ORDER_STATUS constants.
const ACTIVE_ORDER_STATUSES = [2, 3];

export async function getMenuForBranch(): Promise<AdminMenuItem[]> {
  const res = await authedFetch(`/menus?branch_id=${ADMIN_BRANCH_ID}&include_description=0`);
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

// There's no direct "active order for table" endpoint, so we fetch the
// branch's order list and filter client-side — the same data OrderModel's
// own 409-guard query resolves server-side, just without a dedicated route.
export async function getActiveOrderForTable(tableId: number): Promise<AdminOrder | null> {
  const res = await authedFetch(`/orders/data?branch_id=${ADMIN_BRANCH_ID}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin orders (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  const match = rows.find(
    (row: any) => Number(row.TABLE_ID) === tableId && ACTIVE_ORDER_STATUSES.includes(Number(row.STATUS))
  );
  if (!match) return null;
  return getOrderById(Number(match.IDNo));
}

// Batched equivalent of calling getActiveOrderForTable once per table: fetches
// the branch's order list ONCE, filters to Pending/Confirmed rows, then fetches
// items only for those (in parallel) — used for the once-on-load reconciliation
// in restoDashboard's App.tsx so "Active Orders" and each table's order detail
// are already populated on a fresh load, not just their Available/Occupied
// status. Each row from /orders/data already has everything mapAdminOrder
// needs except items, so this skips the redundant GET /orders/:id per order.
export async function getActiveOrdersForBranch(): Promise<AdminOrder[]> {
  const res = await authedFetch(`/orders/data?branch_id=${ADMIN_BRANCH_ID}`);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch restoAdmin orders (${res.status})`);
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  const activeRows = rows.filter((row: any) => ACTIVE_ORDER_STATUSES.includes(Number(row.STATUS)));

  return Promise.all(
    activeRows.map(async (row: any) => {
      const itemsRes = await authedFetch(`/orders/${row.IDNo}/items`);
      const itemsJson: any = await itemsRes.json().catch(() => ({}));
      const itemRows = Array.isArray(itemsJson.data) ? itemsJson.data : [];
      return mapAdminOrder(row, itemRows.map(mapAdminOrderItem));
    })
  );
}

export async function getOrderById(orderId: number): Promise<AdminOrder | null> {
  const [orderRes, itemsRes] = await Promise.all([
    authedFetch(`/orders/${orderId}`),
    authedFetch(`/orders/${orderId}/items`),
  ]);
  const orderJson: any = await orderRes.json().catch(() => ({}));
  if (!orderRes.ok || orderJson?.success === false) {
    if (orderRes.status === 404) return null;
    throw new Error(orderJson?.error || orderJson?.message || `Failed to fetch restoAdmin order (${orderRes.status})`);
  }
  const itemsJson: any = await itemsRes.json().catch(() => ({}));
  const itemRows = Array.isArray(itemsJson.data) ? itemsJson.data : [];
  return mapAdminOrder(orderJson.data, itemRows.map(mapAdminOrderItem));
}

export async function createOrder(params: {
  tableId: number;
  orderType: string;
  orderNo: string;
  items: CreateOrderItemInput[];
  // Hours the room is booked for (1 = the base hour restoAdmin always adds
  // automatically for a table with a ROOM_CHARGE — see resolveServiceChargeWithRoomCharge).
  // Anything beyond 1 is billed as additional SERVICE_CHARGE here. Omit/1 for
  // a table with no room charge, or when the caller doesn't need to adjust it.
  roomChargeQty?: number;
}): Promise<CreateOrderResult> {
  const subtotal = params.items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
  const orderItems = params.items.map((it) => ({
    menu_id: it.menuId,
    qty: it.qty,
    unit_price: it.unitPrice,
    line_total: it.qty * it.unitPrice,
    status: 3,
  }));

  let serviceCharge = 0;
  const roomChargeQty = Math.max(1, Number(params.roomChargeQty) || 1);
  if (roomChargeQty > 1) {
    const tables = await getBlueMoonTables();
    const rate = tables.find((t) => t.id === params.tableId)?.roomCharge || 0;
    serviceCharge = (roomChargeQty - 1) * rate;
  }

  // OrderController.create ignores BRANCH_ID in the body for a non-admin
  // caller (our service account) and instead resolves the branch from
  // req.session/req.user, then req.query.branch_id as a last resort. Our
  // service account's JWT doesn't carry a branch_id claim, so — same as
  // every GET here — the query param is what actually gets it through.
  const res = await authedFetch(`/orders?branch_id=${ADMIN_BRANCH_ID}`, {
    method: 'POST',
    body: JSON.stringify({
      ORDER_NO: params.orderNo,
      BRANCH_ID: ADMIN_BRANCH_ID,
      TABLE_ID: params.tableId,
      ORDER_TYPE: params.orderType,
      STATUS: 3,
      SUBTOTAL: subtotal,
      TAX_AMOUNT: 0,
      SERVICE_CHARGE: serviceCharge,
      DISCOUNT_AMOUNT: 0,
      GRAND_TOTAL: subtotal + serviceCharge,
      ORDER_ITEMS: orderItems,
    }),
  });
  const json: any = await res.json().catch(() => ({}));

  if (res.ok && json?.success !== false) {
    return { ok: true, id: Number(json.data.id), orderNo: String(json.data.order_no) };
  }
  if (res.status === 409 && json?.code === 'ACTIVE_ORDER_EXISTS') {
    return {
      ok: false,
      kind: 'conflict',
      existingOrderId: Number(json.existing_order_id),
      existingOrderNo: String(json.existing_order_no),
      message: json.error || 'This table already has an active order.',
    };
  }
  if (Array.isArray(json?.insufficient) && json.insufficient.length) {
    return { ok: false, kind: 'insufficient', insufficient: json.insufficient, message: json.error || 'Insufficient inventory' };
  }
  return { ok: false, kind: 'error', message: json?.error || json?.message || `Failed to create order (${res.status})` };
}

export async function addItemsToOrder(orderId: number, items: CreateOrderItemInput[]): Promise<AddItemsResult> {
  const res = await authedFetch(`/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((it) => ({ menu_id: it.menuId, qty: it.qty, unit_price: it.unitPrice })),
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

// Confirm (2) or Cancel (-1) an order — restoAdmin already flips the table
// to Available on cancel, and emits order_updated either way, which the
// existing socketBridge -> SSE -> App.tsx chain already relays.
export async function updateOrderStatus(orderId: number, status: 2 | -1): Promise<{ ok: boolean; message?: string }> {
  const res = await authedFetch(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to update order status (${res.status})` };
}

// Adjusts how many hours a room's booking is billed for, on an already-open
// (Pending/Confirmed) order — the dashboard equivalent of restoAdmin's own
// order-detail room-charge stepper (Orders.tsx's saveDetailRoomChargeQty).
// Re-fetches the order for its current TABLE_ID/ORDER_TYPE/STATUS/SUBTOTAL/
// TAX_AMOUNT/DISCOUNT_AMOUNT since restoAdmin's PUT /orders/:id replaces the
// whole payload rather than patching just SERVICE_CHARGE.
export async function updateOrderRoomCharge(orderId: number, roomChargeQty: number): Promise<{ ok: boolean; message?: string }> {
  const order = await getOrderById(orderId);
  if (!order) {
    return { ok: false, message: 'Order not found' };
  }
  if (order.tableId == null) {
    return { ok: false, message: 'This order has no table assigned' };
  }
  const tables = await getBlueMoonTables();
  const rate = tables.find((t) => t.id === order.tableId)?.roomCharge || 0;
  if (rate <= 0) {
    return { ok: false, message: 'This table has no room charge' };
  }

  const clampedQty = Math.max(1, roomChargeQty);
  const explicitServiceCharge = (clampedQty - 1) * rate;
  const grandTotal = order.subtotal + order.taxAmount + explicitServiceCharge - order.discountAmount;

  const res = await authedFetch(`/orders/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({
      TABLE_ID: order.tableId,
      ORDER_TYPE: order.orderType,
      STATUS: order.status,
      SUBTOTAL: order.subtotal,
      TAX_AMOUNT: order.taxAmount,
      SERVICE_CHARGE: explicitServiceCharge,
      DISCOUNT_AMOUNT: order.discountAmount,
      GRAND_TOTAL: grandTotal,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to update room charge (${res.status})` };
}

export async function updateOrderItemQty(itemId: number, qty: number): Promise<UpdateItemResult> {
  const res = await authedFetch(`/order_items/${itemId}`, {
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

export async function deleteOrderItem(itemId: number): Promise<{ ok: boolean; message?: string }> {
  const res = await authedFetch(`/order_items/${itemId}`, { method: 'DELETE' });
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.success !== false) {
    return { ok: true };
  }
  return { ok: false, message: json?.error || json?.message || `Failed to delete item (${res.status})` };
}

export async function getBilling(orderId: number): Promise<AdminBilling | null> {
  const res = await authedFetch(`/billing/${orderId}`);
  if (res.status === 404) return null;
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Failed to fetch billing record (${res.status})`);
  }
  const row = json.data;
  return {
    orderId: Number(row.ORDER_ID),
    paymentMethod: String(row.PAYMENT_METHOD ?? 'CASH'),
    amountDue: Number(row.AMOUNT_DUE ?? 0),
    amountPaid: Number(row.AMOUNT_PAID ?? 0),
    status: Number(row.STATUS ?? 3),
  };
}

// Same call restoAdmin's own Billing.tsx "Process Payment" modal makes —
// additive (server adds amountPaid to whatever's already on file), so the
// caller must compute the remaining balance itself (getBilling first) rather
// than assume the full grand total, since a partial payment may already
// exist from restoAdmin's side.
export async function settleOrder(
  orderId: number,
  params: { paymentMethod: string; amountPaid: number; paymentRef: string | null }
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const res = await authedFetch(`/billing/${orderId}`, {
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

export { ADMIN_API_BASE_URL };
