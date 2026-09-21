// ============================================
// LOYVERSE CONTROLLER
// ============================================
// File: controllers/loyverseController.js
// Description: Controller for Loyverse sync operations
// ============================================

const loyverseService = require('../utils/loyverseService');
const ApiResponse = require('../utils/apiResponse');

class LoyverseController {
	static isSyncInProgressError(error) {
		return String(error?.message || '').toLowerCase().includes('sync already in progress');
	}

	/**
	 * Get sync status
	 * GET /api/loyverse/status
	 */
	static async getSyncStatus(req, res) {
		try {
			const status = loyverseService.getSyncStatus();
			return ApiResponse.success(res, status, 'Sync status retrieved successfully');
		} catch (error) {
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Manually trigger sync
	 * POST /api/loyverse/sync
	 */
	static async syncReceipts(req, res) {
		try {
			const branchId = req.body.branch_id || req.query.branch_id || null;
			const limit = parseInt(req.body.limit) || 50;
			// Optional safety limits (0 = unlimited)
			const maxReceipts = req.body.max_receipts ?? req.body.maxReceipts ?? req.query.max_receipts ?? req.query.maxReceipts;
			const maxPages = req.body.max_pages ?? req.body.maxPages ?? req.query.max_pages ?? req.query.maxPages;
			const incremental = req.body.incremental ?? req.body.realtime ?? req.query.incremental ?? req.query.realtime;
			const since = req.body.since ?? req.body.from ?? req.query.since ?? req.query.from;

			const stats = await loyverseService.syncAllReceipts(branchId, limit, { maxReceipts, maxPages, incremental, since });
			
			return ApiResponse.success(res, {
				stats,
				message: `Sync completed: ${stats.totalInserted} inserted, ${stats.totalUpdated} updated, ${stats.totalErrors} errors`
			}, 'Sync completed successfully');
		} catch (error) {
			if (LoyverseController.isSyncInProgressError(error)) {
				// Common case (auto-sync/manual sync overlap): don't treat as server failure
				console.log('[LoyverseController] Sync request received but sync already running.', {
					path: req.originalUrl,
					branchId: req.body.branch_id || req.query.branch_id || null,
				});
				const status = loyverseService.getSyncStatus();
				return ApiResponse.success(res, {
					alreadyRunning: true,
					status,
					message: 'Sync already in progress. Please wait for it to finish.'
				}, 'Sync already running');
			}
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Full re-sync from Loyverse (resets checkpoint, then syncs all receipts).
	 * Use after DB wipe to re-import everything.
	 * POST /api/loyverse/full-sync
	 */
	static async fullSync(req, res) {
		try {
			const branchId = req.body.branch_id || req.query.branch_id || null;
			const limit = parseInt(req.body.limit) || 50;
			const maxReceipts = req.body.max_receipts ?? req.body.maxReceipts ?? req.query.max_receipts ?? 0;
			const maxPages = req.body.max_pages ?? req.body.maxPages ?? req.query.max_pages ?? 0;

			const stats = await loyverseService.fullResync(branchId, limit, { maxReceipts, maxPages });
			
			return ApiResponse.success(res, {
				stats,
				message: `Full sync completed: ${stats.totalInserted} inserted, ${stats.totalUpdated} updated, ${stats.totalErrors} errors`
			}, 'Full sync completed successfully');
		} catch (error) {
			if (LoyverseController.isSyncInProgressError(error)) {
				const status = loyverseService.getSyncStatus();
				return ApiResponse.success(res, {
					alreadyRunning: true,
					status,
					message: 'Sync already in progress. Please wait for it to finish.'
				}, 'Sync already running');
			}
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Sync only a date range (e.g. Feb 1 – today). Does not reset checkpoint.
	 * POST /api/loyverse/sync-range
	 * Body: { created_at_min?, created_at_max?, branch_id?, limit? }
	 * When client aborts the request (e.g. Stop button), server stops the sync loop.
	 */
	static async syncRange(req, res) {
		try {
			const branchId = req.body.branch_id || req.query.branch_id || null;
			const limit = parseInt(req.body.limit) || 250;
			const created_at_min = req.body.created_at_min || req.query.created_at_min || null;
			const created_at_max = req.body.created_at_max || req.query.created_at_max || null;

			if (!created_at_min || !created_at_max) {
				return ApiResponse.error(res, 'created_at_min and created_at_max are required', 400);
			}

			console.log('[Loyverse Sync] sync-range HTTP accepted', {
				branchId: branchId ?? '(default from env)',
				limit,
				created_at_min,
				created_at_max,
			});

			let cancelled = false;
			const onAborted = () => { cancelled = true; };
			req.on('aborted', onAborted);
			req.on('close', onAborted);

			const stats = await loyverseService.syncDateRange(branchId, limit, {
				created_at_min,
				created_at_max,
				abortedCheck: () => cancelled
			});

			req.removeListener('aborted', onAborted);
			req.removeListener('close', onAborted);

			if (stats.cancelled) {
				return ApiResponse.success(res, {
					stats,
					message: 'Sync cancelled by user.'
				}, 'Sync cancelled');
			}

			return ApiResponse.success(res, {
				stats,
				message: `Sync completed: ${stats.totalInserted} inserted, ${stats.totalUpdated} updated, ${stats.totalErrors} errors`
			}, 'Sync range completed successfully');
		} catch (error) {
			if (LoyverseController.isSyncInProgressError(error)) {
				console.log('[Loyverse Sync] sync-range skipped: sync already in progress for this branch', {
					branchId: req.body.branch_id || req.query.branch_id || null,
				});
				const status = loyverseService.getSyncStatus();
				return ApiResponse.success(res, {
					alreadyRunning: true,
					status,
					message: 'Sync already in progress. Please wait for it to finish.'
				}, 'Sync already running');
			}
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Start auto-sync
	 * POST /api/loyverse/auto-sync/start
	 */
	static async startAutoSync(req, res) {
		try {
			const branchId = req.body.branch_id || req.query.branch_id || null;
			const branchIdsRaw = req.body.branch_ids ?? req.body.branchIds ?? req.query.branch_ids ?? req.query.branchIds ?? null;
			const interval = parseInt(req.body.interval) || null;
			console.log('[LoyverseController] startAutoSync request', { branchId, branchIdsRaw, interval });

			const branchIds = Array.isArray(branchIdsRaw)
				? branchIdsRaw
				: (typeof branchIdsRaw === 'string'
					? branchIdsRaw.split(',').map((s) => parseInt(String(s).trim(), 10))
					: []);

			const cleanIds = (branchIds || []).filter((n) => Number.isFinite(n));
			if (cleanIds.length > 1) {
				loyverseService.startAutoSyncMulti(cleanIds, interval);
			} else {
				loyverseService.startAutoSync(branchId ?? (cleanIds.length === 1 ? cleanIds[0] : null), interval);
			}
			
			return ApiResponse.success(res, {
				message: 'Auto-sync started successfully',
				interval: interval || loyverseService.syncInterval
			}, 'Auto-sync started');
		} catch (error) {
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Stop auto-sync
	 * POST /api/loyverse/auto-sync/stop
	 */
	static async stopAutoSync(req, res) {
		try {
			const branchId = req.body.branch_id || req.query.branch_id || null;
			const branchIdsRaw = req.body.branch_ids ?? req.body.branchIds ?? req.query.branch_ids ?? req.query.branchIds ?? null;
			const branchIds = Array.isArray(branchIdsRaw)
				? branchIdsRaw
				: (typeof branchIdsRaw === 'string'
					? branchIdsRaw.split(',').map((s) => parseInt(String(s).trim(), 10))
					: []);
			const cleanIds = (branchIds || []).filter((n) => Number.isFinite(n));
			console.log('[LoyverseController] stopAutoSync request', { branchId, cleanIds });

			if (cleanIds.length > 0) {
				for (const bid of cleanIds) {
					loyverseService.stopAutoSync(bid);
				}
			} else {
				loyverseService.stopAutoSync(branchId);
			}
			return ApiResponse.success(res, { message: 'Auto-sync stopped successfully' }, 'Auto-sync stopped');
		} catch (error) {
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Delete all Loyverse-imported orders for a branch (LOY-*, LOY-R-*), related rows, refund trackers, reset checkpoint.
	 * POST /api/loyverse/purge-imported  body: { branch_id }
	 */
	static async purgeImported(req, res) {
		try {
			const branchId = req.body.branch_id ?? req.query.branch_id ?? null;
			if (branchId == null || branchId === '') {
				return ApiResponse.error(res, 'branch_id is required', 400);
			}
			const result = await loyverseService.purgeLoyverseImportedOrdersForBranch(branchId);
			return ApiResponse.success(
				res,
				result,
				`Removed ${result.deletedOrders} Loyverse-imported order(s); checkpoint reset. Run date-range or full sync next.`
			);
		} catch (error) {
			return ApiResponse.error(res, error.message, 500);
		}
	}
}

module.exports = LoyverseController;

