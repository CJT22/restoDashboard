// ============================================
// LOYVERSE TOKEN CONTROLLER
// ============================================
// File: controllers/loyverseTokenController.js
// Description: CRUD for per-branch Loyverse access tokens (3coredev-only,
// enforced by require3core middleware on the routes).
// ============================================

const LoyverseTokenModel = require('../models/loyverseTokenModel');
const ApiResponse = require('../utils/apiResponse');

const normalizeBranchId = (value) => {
	if (value === undefined || value === null || value === '') return null;
	const parsed = parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error('branch_id must be a positive integer, or omitted for the global/default token');
	}
	return parsed;
};

class LoyverseTokenController {
	/**
	 * List all branch tokens (+ the global/default row).
	 * GET /api/loyverse/tokens
	 */
	static async list(req, res) {
		try {
			const rows = await LoyverseTokenModel.listTokens();
			return ApiResponse.success(res, rows, 'Loyverse tokens retrieved successfully');
		} catch (error) {
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Create/replace the token for a branch (or the global row when branch_id is omitted).
	 * POST /api/loyverse/tokens
	 */
	static async create(req, res) {
		try {
			const accessToken = String(req.body.access_token || '').trim();
			if (!accessToken) {
				return ApiResponse.badRequest(res, 'access_token is required');
			}

			let branchId;
			try {
				branchId = normalizeBranchId(req.body.branch_id);
			} catch (e) {
				return ApiResponse.badRequest(res, e.message);
			}

			const row = await LoyverseTokenModel.upsertToken(branchId, accessToken);
			return ApiResponse.created(res, row, 'Loyverse token saved successfully');
		} catch (error) {
			if (error.code === 'ER_NO_REFERENCED_ROW_2') {
				return ApiResponse.badRequest(res, 'That branch does not exist');
			}
			return ApiResponse.error(res, error.message, 500);
		}
	}

	/**
	 * Update the token value for an existing row (branch reassignment isn't supported —
	 * delete and re-create instead).
	 * PUT /api/loyverse/tokens/:id
	 */
	static async update(req, res) {
		try {
			const accessToken = String(req.body.access_token || '').trim();
			if (!accessToken) {
				return ApiResponse.badRequest(res, 'access_token is required');
			}

			const existing = await LoyverseTokenModel.getTokenById(req.params.id);
			if (!existing) {
				return ApiResponse.notFound(res, 'Loyverse token');
			}

			const row = await LoyverseTokenModel.updateTokenById(req.params.id, accessToken);
			return ApiResponse.success(res, row, 'Loyverse token updated successfully');
		} catch (error) {
			return ApiResponse.error(res, error.message, 500);
		}
	}

}

module.exports = LoyverseTokenController;
