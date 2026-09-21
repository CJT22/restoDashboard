// Bridges restoAdmin's realtime table_updated events (Socket.IO) into this
// backend's own SSE stream for the dashboard's browser (see index.ts).
//
// Connects as an ordinary Socket.IO client — the same way restoAdmin's own
// kitchen/cashier/waiter clients do (server/utils/socketService.js) — and
// joins the Blue Moon branch's role rooms so it receives every table_updated
// emitted for that branch, whether it came from Table Settings, the order
// pipeline's auto status flips, or our own dashboard-link writes.

import { EventEmitter } from 'events';
import { io as ioClient, type Socket } from 'socket.io-client';
import { ADMIN_API_BASE_URL, ADMIN_BRANCH_ID } from './adminClient.js';

export interface TableUpdatedEvent {
  adminTableId: number;
  branchId: number | null;
  status: number | null;
  dashboardZoneId: string | null;
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
  items: any[];
}

export const tableEvents = new EventEmitter();
export const orderEvents = new EventEmitter();

let socket: Socket | null = null;

export function connectSocketBridge(): void {
  if (socket) return;

  socket = ioClient(ADMIN_API_BASE_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  socket.on('connect', () => {
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
      dashboardZoneId: table.dashboard_zone_id || null,
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
      items: Array.isArray(order.items) ? order.items : [],
    };
    orderEvents.emit(emitName, event);
  };
  socket.on('order_created', handleOrderEvent('order_created'));
  socket.on('order_updated', handleOrderEvent('order_updated'));

  socket.on('disconnect', (reason) => {
    console.warn('[socketBridge] disconnected from restoAdmin:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[socketBridge] connection error:', err.message);
  });
}
