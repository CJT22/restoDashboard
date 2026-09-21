// ============================================
// LOYVERSE BRANCH TOKEN MODEL
// ============================================
// File: models/loyverseTokenModel.js
// Description: Per-branch Loyverse POS API access tokens (DB-backed,
// replaces the LOYVERSE_BRANCH_<id>_ACCESS_TOKEN / LOYVERSE_ACCESS_TOKEN
// env vars). BRANCH_ID = NULL row is the global/default fallback token.
// ============================================

const pool = require('../config/db');

class LoyverseTokenModel {
	static _schemaReady = false;
	static _schemaPromise = null;

	static async ensureSchema() {
		if (LoyverseTokenModel._schemaReady) return;
		if (LoyverseTokenModel._schemaPromise) return LoyverseTokenModel._schemaPromise;

		LoyverseTokenModel._schemaPromise = (async () => {
			await pool.execute(`
				CREATE TABLE IF NOT EXISTS loyverse_branch_tokens (
					ID INT NOT NULL AUTO_INCREMENT,
					BRANCH_ID INT NULL,
					ACCESS_TOKEN VARCHAR(255) NOT NULL,
					CREATED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
					UPDATED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
					PRIMARY KEY (ID),
					UNIQUE KEY uq_loyverse_branch_tokens_branch_id (BRANCH_ID),
					CONSTRAINT fk_loyverse_branch_tokens_branch
						FOREIGN KEY (BRANCH_ID) REFERENCES branches (IDNo) ON DELETE CASCADE
				) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
			`);

			LoyverseTokenModel._schemaReady = true;
			LoyverseTokenModel._schemaPromise = null;
		})().catch((error) => {
			LoyverseTokenModel._schemaPromise = null;
			LoyverseTokenModel._schemaReady = false;
			throw error;
		});

		return LoyverseTokenModel._schemaPromise;
	}

	static async listTokens() {
		await LoyverseTokenModel.ensureSchema();
		const [rows] = await pool.execute(`
			SELECT t.ID, t.BRANCH_ID, t.ACCESS_TOKEN, t.CREATED_DT, t.UPDATED_DT,
			       b.BRANCH_NAME, b.BRANCH_CODE
			FROM loyverse_branch_tokens t
			LEFT JOIN branches b ON b.IDNo = t.BRANCH_ID
			ORDER BY (t.BRANCH_ID IS NULL) DESC, b.BRANCH_NAME ASC
		`);
		return rows;
	}

	static async getTokenById(id) {
		await LoyverseTokenModel.ensureSchema();
		const [rows] = await pool.execute(
			`SELECT ID, BRANCH_ID, ACCESS_TOKEN, CREATED_DT, UPDATED_DT FROM loyverse_branch_tokens WHERE ID = ? LIMIT 1`,
			[id]
		);
		return rows[0] || null;
	}

	static async getTokenByBranch(branchId) {
		await LoyverseTokenModel.ensureSchema();
		const [rows] = branchId == null
			? await pool.execute(
				`SELECT ID, BRANCH_ID, ACCESS_TOKEN, CREATED_DT, UPDATED_DT FROM loyverse_branch_tokens WHERE BRANCH_ID IS NULL LIMIT 1`
			)
			: await pool.execute(
				`SELECT ID, BRANCH_ID, ACCESS_TOKEN, CREATED_DT, UPDATED_DT FROM loyverse_branch_tokens WHERE BRANCH_ID = ? LIMIT 1`,
				[branchId]
			);
		return rows[0] || null;
	}

	/**
	 * Insert or update the token for a branch (or the global row when branchId is null).
	 * The global row can't rely on `ON DUPLICATE KEY UPDATE` because MySQL treats every
	 * NULL in a UNIQUE index as distinct, so a plain upsert would insert a new NULL row
	 * each time instead of updating the existing one — select-then-insert/update instead,
	 * same approach telegramSettingsModel uses for its single-row singleton.
	 */
	static async upsertToken(branchId, accessToken) {
		await LoyverseTokenModel.ensureSchema();
		if (branchId != null) {
			await pool.execute(
				`INSERT INTO loyverse_branch_tokens (BRANCH_ID, ACCESS_TOKEN) VALUES (?, ?)
				 ON DUPLICATE KEY UPDATE ACCESS_TOKEN = VALUES(ACCESS_TOKEN)`,
				[branchId, accessToken]
			);
			return LoyverseTokenModel.getTokenByBranch(branchId);
		}

		const existing = await LoyverseTokenModel.getTokenByBranch(null);
		if (existing) {
			await pool.execute(`UPDATE loyverse_branch_tokens SET ACCESS_TOKEN = ? WHERE ID = ?`, [accessToken, existing.ID]);
		} else {
			await pool.execute(`INSERT INTO loyverse_branch_tokens (BRANCH_ID, ACCESS_TOKEN) VALUES (NULL, ?)`, [accessToken]);
		}
		return LoyverseTokenModel.getTokenByBranch(null);
	}

	static async updateTokenById(id, accessToken) {
		await LoyverseTokenModel.ensureSchema();
		await pool.execute(`UPDATE loyverse_branch_tokens SET ACCESS_TOKEN = ? WHERE ID = ?`, [accessToken, id]);
		return LoyverseTokenModel.getTokenById(id);
	}
}

module.exports = LoyverseTokenModel;
