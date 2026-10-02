// Bridges restoAdmin's realtime table_updated events (Socket.IO) into this
// backend's own SSE stream for the dashboard's browser (see index.ts).
//
// Connects as an ordinary Socket.IO client — the same way restoAdmin's own
// kitchen/cashier/waiter clients do (server/utils/socketService.js) — and
// joins the Blue Moon branch's role rooms so it receives every table_updated
// emitted for that branch, whether it came from Table Settings or the order
// pipeline's auto status flips.

import { EventEmitter } from 'events';
import { io as ioClient, type Socket } from 'socket.io-client';
import { ADMIN_API_BASE_URL, ADMIN_BRANCH_ID, encodedDtToIso, getBlueMoonTables, getOrderById } from './adminClient.js';

// Socket.IO's default path. Only needs overriding when restoAdmin sits behind
// a reverse proxy that serves it under a prefix (e.g. /resto/socket.io).
const ADMIN_SOCKET_PATH = process.env.ADMIN_SOCKET_PATH || '/socket.io';

export interface TableUpdatedEvent {
  adminTableId: number;
  branchId: number | null;
  status: number | null;
  action: string;
}

// order_created/order_updated payloads (server/utils/socketService.js
// emitOrderEvent) nest the order data under `order`; both events carry the
// same shape (table_id, status, grand_total, items), so one event type
// covers both — the SSE `event:` name is what tells the browser which fired.
export interface OrderEvent {
  orderId: number;
  branchId: number | null;
  tableId: number | null;
  orderNo: string | null;
  status: number | null;
  grandTotal: number | null;
  // What the dashboard's room countdown needs to follow an hours change made
  // in restoAdmin. restoAdmin's events don't carry these, so serviceCharge
  // and roomRate are looked up per event (see withRoomTimerFields); createdAt
  // stays null unless restoAdmin ever adds encoded_dt to its events — the
  // browser keeps the value it already has, or refetches the order once.
  serviceCharge: number | null;
  roomRate: number | null;
  createdAt: string | null;
  items: any[];
}

export const tableEvents = new EventEmitter();
export const orderEvents = new EventEmitter();

// Whether this backend currently has a live Socket.IO connection to
// restoAdmin. The browser's SSE stream can be up while this is down (then no
// realtime events arrive), so index.ts forwards it as `bridge_status` for
// the sidebar's connection badge. Emits 'status' (boolean) on every change.
export const bridgeEvents = new EventEmitter();
let bridgeConnected = false;
export const isBridgeConnected = () => bridgeConnected;

function setBridgeConnected(connected: boolean) {
  if (bridgeConnected === connected) return;
  bridgeConnected = connected;
  bridgeEvents.emit('status', connected);
}

let socket: Socket | null = null;

// Fills in serviceCharge/roomRate when restoAdmin's event didn't carry them,
// from the order's current row and its table's ROOM_CHARGE. Best-effort: on
// failure the event goes out as-is, and the browser falls back to what it
// already knew about the order.
async function withRoomTimerFields(event: OrderEvent): Promise<OrderEvent> {
  if (event.serviceCharge != null && event.roomRate != null) return event;
  try {
    const [order, tables] = await Promise.all([
      event.serviceCharge == null ? getOrderById(event.orderId) : Promise.resolve(null),
      event.roomRate == null && event.tableId != null ? getBlueMoonTables() : Promise.resolve([]),
    ]);
    return {
      ...event,
      serviceCharge: event.serviceCharge ?? order?.serviceCharge ?? null,
      roomRate: event.roomRate ?? tables.find((t) => t.id === event.tableId)?.roomCharge ?? null,
    };
  } catch (err: any) {
    console.warn('[socketBridge] could not look up room-timer fields for order', event.orderId, err?.message || err);
    return event;
  }
}

// Order events are enriched one at a time, in arrival order, so a slow
// lookup can't let an older event overtake a newer one for the same order
// (e.g. a stale Pending landing after Confirmed).
let orderEventQueue: Promise<void> = Promise.resolve();

export function connectSocketBridge(): void {
  if (socket) return;

  socket = ioClient(ADMIN_API_BASE_URL, {
    path: ADMIN_SOCKET_PATH,
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  socket.on('connect', () => {
    setBridgeConnected(true);
    console.log('[socketBridge] connected to restoAdmin, joining branch', ADMIN_BRANCH_ID, 'rooms');
    socket!.emit('join_kitchen', ADMIN_BRANCH_ID);
    socket!.emit('join_cashier', ADMIN_BRANCH_ID);
    socket!.emit('join_waiter', ADMIN_BRANCH_ID);
  });

  socket.on('table_updated', (payload: any) => {
    const table = payload?.table || {};
    const adminTableId = Number(payload?.table_id ?? table.id ?? table.IDNo);
    if (!Number.isFinite(adminTableId)) return;

    const event: TableUpdatedEvent = {
      adminTableId,
      branchId: payload?.branch_id != null ? Number(payload.branch_id) : null,
      status: table.status != null ? Number(table.status) : null,
      action: payload?.action || 'updated',
    };
    tableEvents.emit('table_updated', event);
  });

  const handleOrderEvent = (emitName: 'order_created' | 'order_updated') => (payload: any) => {
    const order = payload?.order || {};
    const orderId = Number(payload?.order_id ?? order.order_id);
    if (!Number.isFinite(orderId)) return;

    const event: OrderEvent = {
      orderId,
      branchId: payload?.branch_id != null ? Number(payload.branch_id) : null,
      tableId: order.table_id != null ? Number(order.table_id) : null,
      orderNo: order.order_no || null,
      status: order.status != null ? Number(order.status) : null,
      grandTotal: order.grand_total != null ? Number(order.grand_total) : null,
      serviceCharge: order.service_charge != null ? Number(order.service_charge) : null,
      roomRate: order.room_charge != null ? Number(order.room_charge) : null,
      createdAt: encodedDtToIso(order.encoded_dt),
      items: Array.isArray(order.items) ? order.items : [],
    };
    orderEventQueue = orderEventQueue
      .then(() => withRoomTimerFields(event))
      .then((enriched) => {
        orderEvents.emit(emitName, enriched);
      });
  };
  socket.on('order_created', handleOrderEvent('order_created'));
  socket.on('order_updated', handleOrderEvent('order_updated'));

  socket.on('disconnect', (reason) => {
    setBridgeConnected(false);
    console.warn('[socketBridge] disconnected from restoAdmin:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[socketBridge] connection error:', err.message);
  });
}
