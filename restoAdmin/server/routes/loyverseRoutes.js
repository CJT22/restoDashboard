// ============================================
// LOYVERSE ROUTES
// ============================================
// File: routes/loyverseRoutes.js
// Description: Routes for Loyverse sync operations
// ============================================

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/unifiedAuth');
const LoyverseController = require('../controllers/loyverseController');

// NOTE: These routes are registered on the main app (not under routes/apiRoutes.js),
// so we keep the /api prefix here to match the docs.

// GET /api/loyverse/status
router.get('/api/loyverse/status', authenticate, requireAdmin, LoyverseController.getSyncStatus);

// POST /api/loyverse/sync
// Optional query/body:
// - branch_id
// - limit
// - incremental (true/false)
// - since (ISO string/date) -> override incremental checkpoint for backfill
// - max_receipts, max_pages (safety)
router.post('/api/loyverse/sync', authenticate, requireAdmin, LoyverseController.syncReceipts);

// POST /api/loyverse/full-sync — reset checkpoint then sync all from Loyverse (use after DB wipe)
router.post('/api/loyverse/full-sync', authenticate, requireAdmin, LoyverseController.fullSync);

// POST /api/loyverse/purge-imported — delete LOY-* / LOY-R-* orders for branch + reset checkpoint (before clean resync)
router.post('/api/loyverse/purge-imported', authenticate, requireAdmin, LoyverseController.purgeImported);

// POST /api/loyverse/sync-range — sync only receipts in date range (e.g. Feb 1 – today), no checkpoint reset
router.post('/api/loyverse/sync-range', authenticate, requireAdmin, LoyverseController.syncRange);

// POST /api/loyverse/auto-sync/start
router.post('/api/loyverse/auto-sync/start', authenticate, requireAdmin, LoyverseController.startAutoSync);

// POST /api/loyverse/auto-sync/stop
router.post('/api/loyverse/auto-sync/stop', authenticate, requireAdmin, LoyverseController.stopAutoSync);

module.exports = router;


