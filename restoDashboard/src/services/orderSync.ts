// Frontend-side bridge to this project's own backend for real, restoAdmin-
// sourced orders — the New Order equivalent of src/services/adminSync.ts.
// Same rule applies: the browser never talks to restoAdmin directly, only
// this app's own same-origin /api/admin/* routes.

import { AdminOrderLineItem, AdminOrderSummary } from '../types';
import { listenToAdminStream } from './adminSync';

export interface AdminMenuItem {
  id: number;
  name: string;
  price: number;
  categoryName: string;
}

export interface NewOrderItemInput {
  menuId: number;
  qty: number;
  unitPrice: number;
}

// Flat, all-fields-optional result shapes rather than a discriminated union:
// this repo's tsconfig doesn't enable strictNullChecks, which TS's narrowing
// of tagged unions depends on — without it, unions like `{ok:true,...} |
// {ok:false, kind:'x', ...}` silently fail to narrow. See server/adminClient.ts,
// whose /api/admin/orders* routes return exactly this shape.
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

export interface UpdateItemResult {
  ok: boolean;
  newSubtotal?: number;
  newGrandTotal?: number;
  kind?: 'insufficient' | 'error';
  insufficient?: any[];
  message?: string;
}

export interface AdminBilling {
  orderId: number;
  paymentMethod: string;
  amountDue: number;
  amountPaid: number;
  status: number; // 1=Paid, 2=Partial, 3=Unpaid
}

// orders.STATUS: 3=Pending, 2=Confirmed, 1=Settled, -1=Cancelled — mirrors
// restoAdmin's own ORDER_STATUS/getOrderStatusLabel (src/services/orderService.ts).
export function getOrderStatusLabel(status: number): string {
  switch (status) {
    case 3: return 'Pending';
    case 2: return 'Confirmed';
    case 1: return 'Settled';
    case -1: return 'Cancelled';
    default: return 'Unknown';
  }
}

// Order items listed before the rest collapse to "+N more", wherever a
// fixed-length item list is shown (a zone's hover card, the Active Orders
// widget), so an order reads the same in both.
export const MAX_LISTED_ORDER_ITEMS = 5;

// Compact order number for tight spots on the map: restoAdmin's generated
// numbers look like "ORD-20260924-144956", whose last segment is enough to
// tell today's orders apart. Anything without dashes is kept as-is.
export function shortOrderNo(orderNo: string): string {
  const parts = orderNo.split('-').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : orderNo;
}

export function getOrderStatusColorClass(status: number): string {
  switch (status) {
    case 3: return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 2: return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
    case 1: return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case -1: return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
    default: return 'bg-white/10 text-slate-300 border-white/20';
  }
}

async function parseJsonOrThrow(res: Response, fallbackMessage: string) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || fallbackMessage);
  }
  return json;
}

function mapAdminOrderItem(row: any): AdminOrderLineItem {
  return {
    id: Number(row.id),
    menuId: Number(row.menuId),
    name: String(row.menuName ?? ''),
    quantity: Number(row.qty ?? 0),
    unitPrice: Number(row.unitPrice ?? 0),
    lineTotal: Number(row.lineTotal ?? 0),
  };
}

export function mapAdminOrder(row: any): AdminOrderSummary {
  return {
    id: Number(row.id),
    orderNo: String(row.orderNo ?? ''),
    orderType: row.orderType ?? null,
    status: Number(row.status ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    serviceCharge: row.serviceCharge != null ? Number(row.serviceCharge) : undefined,
    createdAt: row.createdAt ?? undefined,
    roomRate: row.roomRate != null ? Number(row.roomRate) : undefined,
    grandTotal: Number(row.grandTotal ?? 0),
    items: Array.isArray(row.items) ? row.items.map(mapAdminOrderItem) : [],
  };
}

export async function getMenu(): Promise<AdminMenuItem[]> {
  const res = await fetch('/api/admin/menu');
  const json = await parseJsonOrThrow(res, 'Failed to load the menu from restoAdmin');
  return Array.isArray(json.data) ? json.data : [];
}

export async function getActiveOrderForTable(adminTableId: number): Promise<AdminOrderSummary | null> {
  const res = await fetch(`/api/admin/orders/by-table/${adminTableId}`);
  const json = await parseJsonOrThrow(res, 'Failed to load the active order from restoAdmin');
  return json.data ? mapAdminOrder(json.data) : null;
}

export interface ActiveOrderEntry {
  adminTableId: number;
  order: AdminOrderSummary;
}

// Batched equivalent of calling getActiveOrderForTable once per linked
// table — used for the once-on-load reconciliation in App.tsx so every
// table's order details (not just its Available/Occupied status) are
// already populated on a fresh load, without a round trip per table.
export async function getActiveOrders(): Promise<ActiveOrderEntry[]> {
  const res = await fetch('/api/admin/orders/active');
  const json = await parseJsonOrThrow(res, 'Failed to load active orders from restoAdmin');
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .filter((row: any) => row.tableId != null)
    .map((row: any) => ({ adminTableId: Number(row.tableId), order: mapAdminOrder(row) }));
}

export async function createOrder(
  adminTableId: number,
  orderType: string,
  orderNo: string,
  items: NewOrderItemInput[],
  roomChargeQty?: number
): Promise<CreateOrderResult> {
  const res = await fetch('/api/admin/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: adminTableId, orderType, orderNo, items, roomChargeQty }),
  });
  return res.json();
}

// Adjusts the room-charge hours (1 = the base hour restoAdmin always bills
// automatically) on an already-open Pending/Confirmed order — the dashboard
// equivalent of restoAdmin's own order-detail room-charge stepper.
export async function updateOrderRoomCharge(
  orderId: number,
  roomChargeQty: number
): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`/api/admin/orders/${orderId}/room-charge`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomChargeQty }),
  });
  return res.json();
}

export async function addItemsToOrder(orderId: number, items: NewOrderItemInput[]): Promise<AddItemsResult> {
  const res = await fetch(`/api/admin/orders/${orderId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return res.json();
}

export async function confirmOrder(orderId: number): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 2 }),
  });
  return res.json();
}

export async function cancelOrder(orderId: number): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: -1 }),
  });
  return res.json();
}

export async function updateItemQty(orderItemId: number, qty: number): Promise<UpdateItemResult> {
  const res = await fetch(`/api/admin/order-items/${orderItemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qty }),
  });
  return res.json();
}

export async function deleteItem(orderItemId: number): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`/api/admin/order-items/${orderItemId}`, { method: 'DELETE' });
  return res.json();
}

export async function getBilling(orderId: number): Promise<AdminBilling | null> {
  const res = await fetch(`/api/admin/orders/${orderId}/billing`);
  const json = await parseJsonOrThrow(res, 'Failed to load the billing record from restoAdmin');
  return json.data ?? null;
}

export async function settleOrder(
  orderId: number,
  params: { paymentMethod: string; amountPaid: number; paymentRef: string | null }
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const res = await fetch(`/api/admin/orders/${orderId}/settle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export interface RemoteOrderUpdate {
  orderId: number;
  tableId: number | null;
  status: number | null;
  orderNo: string | null;
  grandTotal: number | null;
  // Null unless the event came from restoAdmin's order create/full-update
  // path — see server/socketBridge.ts OrderEvent.
  serviceCharge: number | null;
  roomRate: number | null;
  createdAt: string | null;
  items: AdminOrderLineItem[];
}

// Subscribes to order_created/order_updated on the SAME shared SSE
// connection adminSync.ts's subscribeToAdminUpdates uses for table_updated —
// one EventSource, multiple event listeners, rather than a second connection.
export function subscribeToOrderUpdates(onUpdate: (event: RemoteOrderUpdate) => void): () => void {
  const handle = (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data);
      onUpdate({
        orderId: Number(payload.orderId),
        tableId: payload.tableId != null ? Number(payload.tableId) : null,
        status: payload.status != null ? Number(payload.status) : null,
        orderNo: payload.orderNo ?? null,
        grandTotal: payload.grandTotal != null ? Number(payload.grandTotal) : null,
        serviceCharge: payload.serviceCharge != null ? Number(payload.serviceCharge) : null,
        roomRate: payload.roomRate != null ? Number(payload.roomRate) : null,
        createdAt: payload.createdAt ?? null,
        items: Array.isArray(payload.items)
          ? payload.items.map((row: any) => ({
              id: Number(row.IDNo),
              menuId: Number(row.MENU_ID),
              name: String(row.MENU_NAME ?? ''),
              quantity: Number(row.QTY ?? 0),
              unitPrice: Number(row.UNIT_PRICE ?? 0),
              lineTotal: Number(row.LINE_TOTAL ?? 0),
            }))
          : [],
      });
    } catch (err) {
      console.warn('[orderSync] bad order event payload', err);
    }
  };
  const stopCreated = listenToAdminStream('order_created', handle);
  const stopUpdated = listenToAdminStream('order_updated', handle);
  return () => {
    stopCreated();
    stopUpdated();
  };
}
