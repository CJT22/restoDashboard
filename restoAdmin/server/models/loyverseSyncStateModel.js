// ============================================
// LOYVERSE SYNC STATE MODEL
// ============================================
// File: models/loyverseSyncStateModel.js
// Description: Persists last processed timestamps for incremental sync
// ============================================

const pool = require('../config/db');

class LoyverseSyncStateModel {
	static async ensureTable() {
		// Create table if it doesn't exist (no migrations needed)
		const sql = `
			CREATE TABLE IF NOT EXISTS loyverse_sync_state (
				branch_id INT NOT NULL,
				last_updated_at DATETIME NULL,
				updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				PRIMARY KEY (branch_id)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
		`;
		await pool.execute(sql);
	}

	static async getLastUpdatedAt(branchId) {
		await this.ensureTable();
		const [rows] = await pool.execute(
			`SELECT last_updated_at FROM loyverse_sync_state WHERE branch_id = ? LIMIT 1`,
			[branchId]
		);
		return rows[0]?.last_updated_at ? new Date(rows[0].last_updated_at) : null;
	}

	static async setLastUpdatedAt(branchId, date) {
		await this.ensureTable();
		const value = date ? new Date(date) : null;
		await pool.execute(
			`
			INSERT INTO loyverse_sync_state (branch_id, last_updated_at)
			VALUES (?, ?)
			ON DUPLICATE KEY UPDATE last_updated_at = VALUES(last_updated_at)
			`,
			[branchId, value]
		);
		return true;
	}

	/**
	 * Reset checkpoint so next incremental sync will process from start.
	 * Use after DB wipe for full re-sync from Loyverse.
	 * @param {number|null} branchId - If null, resets all branches.
	 */
	static async resetLastUpdatedAt(branchId) {
		await this.ensureTable();
		if (branchId != null) {
			await pool.execute(
				`UPDATE loyverse_sync_state SET last_updated_at = NULL WHERE branch_id = ?`,
				[branchId]
			);
		} else {
			await pool.execute(`UPDATE loyverse_sync_state SET last_updated_at = NULL`);
		}
		return true;
	}
}

module.exports = LoyverseSyncStateModel;


