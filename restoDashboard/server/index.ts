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
  updateOrderItemQty,
  deleteOrderItem,
  getBilling,
  settleOrder,
} from './adminClient.js';
import { connectSocketBridge, tableEvents, orderEvents, type TableUpdatedEvent, type OrderEvent } from './socketBridge.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3510);

// GET all Blue Moon admin tables + their current dashboard link, for the
// "Link to Blue Moon Table" picker in EditTableModal.
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
    const { tableId, orderType, orderNo, items } = req.body || {};
    if (!Number.isFinite(Number(tableId)) || !orderNo || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'tableId, orderNo, and at least one item are required' });
    }
    const result = await createOrder({ tableId: Number(tableId), orderType, orderNo, items });
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
app.get('/api/admin/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

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
    tableEvents.off('table_updated', onTableUpdated);
    orderEvents.off('order_created', onOrderCreated);
    orderEvents.off('order_updated', onOrderUpdated);
  });
});

connectSocketBridge();

app.listen(PORT, () => {
  console.log(`[restoDashboard server] listening on http://localhost:${PORT}`);
});
