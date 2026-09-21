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
import { getBlueMoonTables, setTableStatus, setDashboardLink } from './adminClient.js';
import { connectSocketBridge, tableEvents, type TableUpdatedEvent } from './socketBridge.js';

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

// Push a status change (from the dashboard's TableDetailModal) to restoAdmin.
app.patch('/api/admin/tables/:id/status', async (req, res) => {
  try {
    const adminTableId = Number(req.params.id);
    const status = Number(req.body?.status);
    if (!Number.isFinite(adminTableId) || ![0, 1, 2, 3].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid table id or status' });
    }
    await setTableStatus(adminTableId, status as 0 | 1 | 2 | 3);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[PATCH /api/admin/tables/:id/status]', err.message || err);
    res.status(502).json({ success: false, error: err.message || 'Failed to reach restoAdmin' });
  }
});

// Server-Sent Events stream: forwards restoAdmin's realtime table_updated
// events (via socketBridge.ts) down to the dashboard's browser tab(s).
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
  tableEvents.on('table_updated', onTableUpdated);

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    tableEvents.off('table_updated', onTableUpdated);
  });
});

connectSocketBridge();

app.listen(PORT, () => {
  console.log(`[restoDashboard server] listening on http://localhost:${PORT}`);
});
