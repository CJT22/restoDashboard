// restoDashboard's own backend.
//
// Holds the restoAdmin service-account credentials (adminClient.ts) and
// proxies/bridges everything the browser needs, so the browser bundle never
// sees an restoAdmin credential and never talks to restoAdmin directly.
// Stateless by design — restoAdmin's `restaurant_tables.DASHBOARD_ZONE_ID`
// column is the single source of truth for which zone is linked to which
// admin table; this process just relays reads/writes and realtime events.

import 'dotenv/config';
import express from 'express';
import {
  getBlueMoonTables,
  setDashboardLink,
  getMenuForBranch,
  getActiveOrderForTable,
  getActiveOrdersForBranch,
  createOrder,
  addItemsToOrder,
  updateOrderStatus,
  updateOrderRoomCharge,
  updateOrderItemQty,
  deleteOrderItem,
  getBilling,
  settleOrder,
  getSalesTotal,
} from './adminClient.js';
import { connectSocketBridge, tableEvents, orderEvents, bridgeEvents, isBridgeConnected, type TableUpdatedEvent, type OrderEvent } from './socketBridge.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3510);

// GET all Blue Moon admin tables + their current dashboard link, for the
// startup link check in App.tsx and the (dormant) layout editor's "Link to
// Blue Moon Table" picker in src/layoutEditor/EditTableModal.tsx.
app.get('/api/admin/tables', async (_req, res) => {
  try {
    const tables = await getBlueMoonTables();
    res.json({ success: true, data: tables });
  } catch (err: any) {
    console.error('[GET /api/admin/tables]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// Link (adminTableId set) or unlink (adminTableId null) a dashboard zone.
// Keeps the mapping 1:1 by clearing any other admin table already linked to
// this zoneId before setting the new link.
app.post('/api/admin/link', async (req, res) => {
  try {
    const { zoneId, adminTableId } = req.body || {};
    if (!zoneId || typeof zoneId !== 'string') {
      return res.status(400).json({ success: false, error: 'zoneId is required' });
    }

    const tables = await getBlueMoonTables();
    const previouslyLinked = tables.find((t) => t.dashboardZoneId === zoneId);
    if (previouslyLinked && previouslyLinked.id !== adminTableId) {
      await setDashboardLink(previouslyLinked.id, null);
    }

    if (adminTableId != null) {
      await setDashboardLink(Number(adminTableId), zoneId);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[POST /api/admin/link]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// GET the branch's available menu, for the New Order item picker.
app.get('/api/admin/menu', async (_req, res) => {
  try {
    const menu = await getMenuForBranch();
    res.json({ success: true, data: menu });
  } catch (err: any) {
    console.error('[GET /api/admin/menu]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// GET the active (pending/confirmed) order for a linked admin table, if any.
app.get('/api/admin/orders/by-table/:adminTableId', async (req, res) => {
  try {
    const adminTableId = Number(req.params.adminTableId);
    if (!Number.isFinite(adminTableId)) {
      return res.status(400).json({ success: false, error: 'Invalid table id' });
    }
    const order = await getActiveOrderForTable(adminTableId);
    res.json({ success: true, data: order });
  } catch (err: any) {
    console.error('[GET /api/admin/orders/by-table/:adminTableId]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// Manila (UTC+8, no DST) calendar date for a UTC instant, as YYYY-MM-DD.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const manilaDate = (ms: number) => new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10);

type SalesPeriod = 'today' | 'yesterday' | 'week' | 'month';

// Inclusive Manila-local date range for a sales period. Worked out here
// rather than in the browser so a tablet with a wrong clock or time zone
// can't shift the range. Days roll over at midnight; weeks start Monday.
function salesPeriodRange(period: SalesPeriod, nowMs = Date.now()): { startDate: string; endDate: string } {
  const today = manilaDate(nowMs);
  if (period === 'yesterday') {
    const yesterday = manilaDate(nowMs - DAY_MS);
    return { startDate: yesterday, endDate: yesterday };
  }
  if (period === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const daysSinceMonday = (weekday + 6) % 7;
    return { startDate: manilaDate(nowMs - daysSinceMonday * DAY_MS), endDate: today };
  }
  if (period === 'month') {
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  }
  return { startDate: today, endDate: today };
}

function parseSalesPeriod(raw: unknown): SalesPeriod {
  const value = String(raw || 'today');
  return ['today', 'yesterday', 'week', 'month'].includes(value) ? (value as SalesPeriod) : 'today';
}

// GET branch-wide paid sales (both floors) for the Total Sales info-panel
// widget. ?period=today|yesterday|week|month (default today).
app.get('/api/admin/sales', async (req, res) => {
  const period = parseSalesPeriod(req.query.period);
  try {
    const { startDate, endDate } = salesPeriodRange(period);
    const total = await getSalesTotal(startDate, endDate);
    res.json({ success: true, data: { period, startDate, endDate, ...total } });
  } catch (err: any) {
    console.error('[GET /api/admin/sales]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// GET every Pending/Confirmed order for the branch in one batch, keyed by
// table — used for the once-on-load reconciliation so a fresh load/reset
// already has full order details (not just table status) for every table
// that has one, without a per-table round trip.
app.get('/api/admin/orders/active', async (_req, res) => {
  try {
    const orders = await getActiveOrdersForBranch();
    res.json({ success: true, data: orders });
  } catch (err: any) {
    console.error('[GET /api/admin/orders/active]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// Create a New Order for a linked table. Returns 200 with a typed result
// (success / conflict / insufficient) rather than a generic error status, so
// the frontend can render each case distinctly.
app.post('/api/admin/orders', async (req, res) => {
  try {
    const { tableId, orderType, items, roomChargeQty } = req.body || {};
    const hasItems = Array.isArray(items) && items.length > 0;
    const hasRoomCharge = Number.isFinite(Number(roomChargeQty)) && Number(roomChargeQty) > 0;
    if (!Number.isFinite(Number(tableId)) || (!hasItems && !hasRoomCharge)) {
      return res.status(400).json({ success: false, error: 'tableId and at least one item or a room charge are required' });
    }
    // The order number itself is generated by createOrder — see adminClient.ts.
    const result = await createOrder({
      tableId: Number(tableId),
      orderType,
      items: hasItems ? items : [],
      roomChargeQty: hasRoomCharge ? Number(roomChargeQty) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    console.error('[POST /api/admin/orders]', err.message || err);
    res.status(502).json({ ok: false, kind: 'error', message: err.message || 'Failed to reach restoAdmin' });
  }
});

// Add items to an already-open order (the "active order exists" conflict path).
app.post('/api/admin/orders/:id/items', async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isFinite(orderId) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid order id or empty items' });
    }
    const result = await addItemsToOrder(orderId, items);
    res.json(result);
  } catch (err: any) {
    console.error('[POST /api/admin/orders/:id/items]', err.message || err);
    res.status(502).json({ ok: false, kind: 'error', message: err.message || 'Failed to reach restoAdmin' });
  }
});

// Confirm (2) or Cancel (-1) an order.
app.patch('/api/admin/orders/:id/status', async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const status = Number(req.body?.status);
    if (!Number.isFinite(orderId) || (status !== 2 && status !== -1)) {
      return res.status(400).json({ ok: false, message: 'Invalid order id or status' });
    }
    const result = await updateOrderStatus(orderId, status);
    res.json(result);
  } catch (err: any) {
    console.error('[PATCH /api/admin/orders/:id/status]', err.message || err);
    res.status(502).json({ ok: false, message: err.message || 'Failed to reach restoAdmin' });
  }
});

// Adjust the room-charge hours on an already-open order (Pending/Confirmed).
app.patch('/api/admin/orders/:id/room-charge', async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const roomChargeQty = Number(req.body?.roomChargeQty);
    if (!Number.isFinite(orderId) || !Number.isFinite(roomChargeQty) || roomChargeQty <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid order id or room charge qty' });
    }
    const result = await updateOrderRoomCharge(orderId, roomChargeQty);
    res.json(result);
  } catch (err: any) {
    console.error('[PATCH /api/admin/orders/:id/room-charge]', err.message || err);
    res.status(502).json({ ok: false, message: err.message || 'Failed to reach restoAdmin' });
  }
});

// Edit an order item's quantity.
app.put('/api/admin/order-items/:id', async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const qty = Number(req.body?.qty);
    if (!Number.isFinite(itemId) || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid item id or qty' });
    }
    const result = await updateOrderItemQty(itemId, qty);
    res.json(result);
  } catch (err: any) {
    console.error('[PUT /api/admin/order-items/:id]', err.message || err);
    res.status(502).json({ ok: false, kind: 'error', message: err.message || 'Failed to reach restoAdmin' });
  }
});

// Delete an order item.
app.delete('/api/admin/order-items/:id', async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId)) {
      return res.status(400).json({ ok: false, message: 'Invalid item id' });
    }
    const result = await deleteOrderItem(itemId);
    res.json(result);
  } catch (err: any) {
    console.error('[DELETE /api/admin/order-items/:id]', err.message || err);
    res.status(502).json({ ok: false, message: err.message || 'Failed to reach restoAdmin' });
  }
});

// GET the order's current billing record (amount due/paid), for computing
// the remaining balance before settling.
app.get('/api/admin/orders/:id/billing', async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order id' });
    }
    const billing = await getBilling(orderId);
    res.json({ success: true, data: billing });
  } catch (err: any) {
    console.error('[GET /api/admin/orders/:id/billing]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// Settle an order — same call restoAdmin's own Billing screen makes.
app.put('/api/admin/orders/:id/settle', async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { paymentMethod, amountPaid, paymentRef } = req.body || {};
    if (!Number.isFinite(orderId) || !Number.isFinite(Number(amountPaid)) || Number(amountPaid) <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid order id or amount' });
    }
    const result = await settleOrder(orderId, {
      paymentMethod: paymentMethod || 'CASH',
      amountPaid: Number(amountPaid),
      paymentRef: paymentRef || null,
    });
    res.json(result);
  } catch (err: any) {
    console.error('[PUT /api/admin/orders/:id/settle]', err.message || err);
    res.status(502).json({ ok: false, message: err.message || 'Failed to reach restoAdmin' });
  }
});

// Server-Sent Events stream: forwards restoAdmin's realtime table_updated
// and order_created/order_updated events (via socketBridge.ts) down to the
// dashboard's browser tab(s). One connection carries every event type.
// bridge_status ({ connected }) is sent on connect and whenever this
// backend's own link to restoAdmin drops or comes back.
app.get('/api/admin/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  const writeBridgeStatus = (connected: boolean) => {
    res.write(`event: bridge_status\ndata: ${JSON.stringify({ connected })}\n\n`);
  };
  writeBridgeStatus(isBridgeConnected());
  bridgeEvents.on('status', writeBridgeStatus);

  const onTableUpdated = (event: TableUpdatedEvent) => {
    res.write(`event: table_updated\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const onOrderCreated = (event: OrderEvent) => {
    res.write(`event: order_created\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const onOrderUpdated = (event: OrderEvent) => {
    res.write(`event: order_updated\ndata: ${JSON.stringify(event)}\n\n`);
  };
  tableEvents.on('table_updated', onTableUpdated);
  orderEvents.on('order_created', onOrderCreated);
  orderEvents.on('order_updated', onOrderUpdated);

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bridgeEvents.off('status', writeBridgeStatus);
    tableEvents.off('table_updated', onTableUpdated);
    orderEvents.off('order_created', onOrderCreated);
    orderEvents.off('order_updated', onOrderUpdated);
  });
});

connectSocketBridge();

app.listen(PORT, () => {
  console.log(`[restoDashboard server] listening on http://localhost:${PORT}`);
});
