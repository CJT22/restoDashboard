// ============================================
// BILLING MODEL
// ============================================
// File: models/billingModel.js
// Description: Database queries for billing records
// ============================================

const pool = require('../config/db');
const { phLocalDayRangeFilter } = require('../utils/phDateRange');

class BillingModel {
	static _loyverseRefundsSchemaReady = false;

	static async ensureLoyverseRefundsTable() {
		// Stores which Loyverse refund receipts have already been applied, to keep refund sync idempotent.
		// Without this, auto-sync/manual refresh will keep adding the same refund repeatedly.
		const sql = `
			CREATE TABLE IF NOT EXISTS loyverse_refund_receipts (
				refund_receipt_number VARCHAR(64) NOT NULL,
				order_id INT NOT NULL,
				branch_id INT NULL,
				refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
				refund_dt DATETIME NULL,
				refund_reason VARCHAR(255) NULL,
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (refund_receipt_number),
				KEY idx_loyverse_refund_order (order_id)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
		`;
		await pool.execute(sql);

		if (BillingModel._loyverseRefundsSchemaReady) return;

		try {
			const [pkRows] = await pool.execute(
				`SELECT COUNT(*) AS c
				 FROM information_schema.table_constraints
				 WHERE table_schema = DATABASE()
				   AND table_name = 'loyverse_refund_receipts'
				   AND constraint_type = 'PRIMARY KEY'`
			);
			const hasPk = Number(pkRows[0]?.c || 0) > 0;
			if (!hasPk) {
				console.warn('[BillingModel] Migrating loyverse_refund_receipts: dedupe rows and add PRIMARY KEY');
				await pool.execute(`
					CREATE TEMPORARY TABLE IF NOT EXISTS loyverse_refund_receipts_dedup AS
					SELECT
						refund_receipt_number,
						MAX(order_id) AS order_id,
						MAX(branch_id) AS branch_id,
						MAX(refund_amount) AS refund_amount,
						MAX(refund_dt) AS refund_dt,
						MAX(refund_reason) AS refund_reason,
						MAX(created_at) AS created_at
					FROM loyverse_refund_receipts
					GROUP BY refund_receipt_number
				`);
				await pool.execute(`DELETE FROM loyverse_refund_receipts`);
				await pool.execute(`
					INSERT INTO loyverse_refund_receipts
						(refund_receipt_number, order_id, branch_id, refund_amount, refund_dt, refund_reason, created_at)
					SELECT
						refund_receipt_number, order_id, branch_id, refund_amount, refund_dt, refund_reason, created_at
					FROM loyverse_refund_receipts_dedup
				`);
				await pool.execute(`DROP TEMPORARY TABLE IF EXISTS loyverse_refund_receipts_dedup`);
				await pool.execute(
					`ALTER TABLE loyverse_refund_receipts ADD PRIMARY KEY (refund_receipt_number)`
				);
				await BillingModel.rebuildBillingRefundsFromTracker();
				console.warn('[BillingModel] loyverse_refund_receipts migration complete; billing refunds rebuilt');
			}
		} catch (e) {
			console.warn('[BillingModel.ensureLoyverseRefundsTable] migration skipped:', e?.message || e);
		}

		BillingModel._loyverseRefundsSchemaReady = true;
	}

	/** Recompute billing.REFUND from one row per Loyverse refund receipt (fixes duplicate sync totals). */
	static async rebuildBillingRefundsFromTracker(branchId = null) {
		await BillingModel.ensureLoyverseRefundsTable();
		const params = [];
		let branchSql = '';
		if (branchId != null && branchId !== '') {
			branchSql = ' AND branch_id = ?';
			params.push(Number(branchId));
		}

		await pool.execute(
			`UPDATE billing SET REFUND = 0, REFUND_DT = NULL, REFUND_REASON = NULL
			 WHERE REFUND IS NOT NULL AND REFUND > 0
			 ${branchId != null && branchId !== '' ? ' AND BRANCH_ID = ?' : ''}`,
			branchId != null && branchId !== '' ? [Number(branchId)] : []
		);

		await pool.execute(
			`
			UPDATE billing b
			INNER JOIN (
				SELECT
					order_id,
					SUM(refund_amount) AS total_refund,
					MAX(refund_dt) AS refund_dt,
					MAX(refund_reason) AS refund_reason
				FROM loyverse_refund_receipts
				WHERE refund_amount > 0
				${branchSql}
				GROUP BY order_id
			) agg ON agg.order_id = b.ORDER_ID
			SET
				b.REFUND = agg.total_refund,
				b.REFUND_DT = agg.refund_dt,
				b.REFUND_REASON = agg.refund_reason
			`,
			params
		);
	}
	static async getAll(branchId = null, options = {}) {
		const {
			start_date: startDate = null,
			end_date: endDate = null,
			limit = null,
		} = options;

		let query = `
			SELECT 
				b.IDNo,
				b.BRANCH_ID,
				br.BRANCH_NAME,
				br.BRANCH_CODE,
				br.BRANCH_NAME AS BRANCH_LABEL,
				b.ORDER_ID,
				o.ORDER_NO,
				o.TABLE_ID,
				t.TABLE_NUMBER,
				b.PAYMENT_METHOD,
				b.AMOUNT_DUE,
				b.AMOUNT_PAID,
				b.PAYMENT_REF,
				b.STATUS,
				b.ENCODED_BY,
				ui.FIRSTNAME AS ENCODED_BY_NAME,
				ui.FIRSTNAME AS ENCODED_BY_USERNAME,
				b.ENCODED_DT
			FROM billing b
			LEFT JOIN orders o ON o.IDNo = b.ORDER_ID
			LEFT JOIN restaurant_tables t ON t.IDNo = o.TABLE_ID
			LEFT JOIN branches br ON br.IDNo = b.BRANCH_ID
			LEFT JOIN user_info ui ON ui.IDNo = b.ENCODED_BY
			WHERE o.STATUS IN (2, 1)
		`;

		const params = [];
		if (branchId != null && branchId !== '' && String(branchId) !== 'all') {
			query += ` AND b.BRANCH_ID = ?`;
			params.push(branchId);
		}
		const range = phLocalDayRangeFilter('b.ENCODED_DT', startDate, endDate);
		if (range.sql) {
			query += range.sql;
			params.push(...range.params);
		}

		query += ` ORDER BY b.ENCODED_DT DESC, b.IDNo DESC`;

		const parsedLimit = limit != null ? parseInt(String(limit), 10) : 0;
		if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
			query += ` LIMIT ${Math.min(parsedLimit, 2000)}`;
		} else {
			// Always cap list payloads so growth cannot unbounded-scan the table.
			query += ` LIMIT 500`;
		}

		const [rows] = await pool.execute(query, params);
		return rows;
	}

	static async getListStats(branchId = null, options = {}) {
		const { start_date: startDate = null, end_date: endDate = null } = options;
		let query = `
			SELECT
				COALESCE(SUM(GREATEST(COALESCE(b.AMOUNT_DUE, 0) - COALESCE(b.AMOUNT_PAID, 0), 0)), 0) AS totalDue,
				COALESCE(SUM(b.AMOUNT_PAID), 0) AS totalPaid,
				COALESCE(SUM(b.STATUS = 1), 0) AS paidCount,
				COALESCE(SUM(b.STATUS = 2), 0) AS partialCount,
				COALESCE(SUM(b.STATUS = 3), 0) AS unpaidCount
			FROM billing b
			INNER JOIN orders o ON o.IDNo = b.ORDER_ID AND o.STATUS IN (2, 1)
			WHERE 1=1
		`;
		const params = [];
		if (branchId) {
			query += ` AND b.BRANCH_ID = ?`;
			params.push(branchId);
		}
		const range = phLocalDayRangeFilter('b.ENCODED_DT', startDate, endDate);
		if (range.sql) {
			query += range.sql;
			params.push(...range.params);
		}
		const [rows] = await pool.execute(query, params);
		const r = rows[0] || {};
		return {
			totalDue: Number(r.totalDue) || 0,
			totalPaid: Number(r.totalPaid) || 0,
			paidCount: Number(r.paidCount) || 0,
			partialCount: Number(r.partialCount) || 0,
			unpaidCount: Number(r.unpaidCount) || 0,
		};
	}

	static async getByOrderId(orderId) {
		const query = `
			SELECT 
				b.IDNo,
				b.ORDER_ID,
				o.ORDER_NO,
				b.PAYMENT_METHOD,
				b.AMOUNT_DUE,
				b.AMOUNT_PAID,
				b.PAYMENT_REF,
				b.STATUS,
				b.ENCODED_BY,
				ui.FIRSTNAME AS ENCODED_BY_NAME,
				b.ENCODED_DT
			FROM billing b
			LEFT JOIN orders o ON o.IDNo = b.ORDER_ID
			LEFT JOIN user_info ui ON ui.IDNo = b.ENCODED_BY
			WHERE b.ORDER_ID = ?
			LIMIT 1
		`;

		const [rows] = await pool.execute(query, [orderId]);
		return rows[0] || null;
	}

	static async createForOrder(data) {
		const {
			branch_id,
			order_id,
			payment_method,
			amount_due,
			amount_paid,
			payment_ref,
			status,
			user_id,
			encoded_dt
		} = data;
		const encodedDtValue =
			encoded_dt != null && String(encoded_dt).trim() !== '' ? encoded_dt : null;

		const query = `
			INSERT INTO billing (
				IDNo,
				BRANCH_ID,
				ORDER_ID,
				PAYMENT_METHOD,
				AMOUNT_DUE,
				AMOUNT_PAID,
				PAYMENT_REF,
				STATUS,
				ENCODED_BY,
				ENCODED_DT
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

		// Same atomic max-then-insert as OrderModel.create — see that comment.
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			const [idRows] = await connection.execute('SELECT COALESCE(MAX(IDNo), 0) + 1 AS nextId FROM billing FOR UPDATE');
			const nextId = Number(idRows?.[0]?.nextId) || 1;

			await connection.execute(query, [
				nextId,
				branch_id,
				order_id,
				payment_method || 'CASH',
				amount_due || 0,
				amount_paid || 0,
				payment_ref || null,
				status || 3,
				user_id,
				encodedDtValue || new Date()
			]);
			await connection.commit();
		} catch (err) {
			await connection.rollback();
			throw err;
		} finally {
			connection.release();
		}
	}

	static async updateForOrder(orderId, data) {
		const {
			payment_method,
			amount_due,
			amount_paid,
			payment_ref,
			status,
			encoded_dt
		} = data;

		// Fetch current billing record to preserve values if they aren't provided
		const current = await this.getByOrderId(orderId);
		if (!current) return false;
		const encodedDtValue =
			encoded_dt != null && String(encoded_dt).trim() !== '' ? encoded_dt : null;

		const query = `
			UPDATE billing SET
				PAYMENT_METHOD = ?,
				AMOUNT_DUE = ?,
				AMOUNT_PAID = ?,
				PAYMENT_REF = ?,
				STATUS = ?,
				ENCODED_DT = COALESCE(?, ENCODED_DT)
			WHERE ORDER_ID = ?
		`;

		await pool.execute(query, [
			payment_method || current.PAYMENT_METHOD || 'CASH',
			amount_due !== undefined ? amount_due : current.AMOUNT_DUE,
			amount_paid !== undefined ? amount_paid : current.AMOUNT_PAID,
			payment_ref || current.PAYMENT_REF || null,
			status !== undefined ? status : current.STATUS,
			encodedDtValue,
			orderId
		]);
		return true;
	}

	static async recordTransaction(data) {
		const { order_id, payment_method, amount_paid, payment_ref, user_id, encoded_dt } = data;
		const encodedDtValue =
			encoded_dt != null && String(encoded_dt).trim() !== '' ? encoded_dt : null;
		const query = `
			INSERT INTO payment_transactions (
				IDNo, ORDER_ID, PAYMENT_METHOD, AMOUNT_PAID, PAYMENT_REF, ENCODED_BY, ENCODED_DT
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`;

		// Same atomic max-then-insert as OrderModel.create — see that comment.
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			const [idRows] = await connection.execute('SELECT COALESCE(MAX(IDNo), 0) + 1 AS nextId FROM payment_transactions FOR UPDATE');
			const nextId = Number(idRows?.[0]?.nextId) || 1;

			await connection.execute(query, [
				nextId,
				order_id,
				payment_method,
				amount_paid,
				payment_ref,
				user_id,
				encodedDtValue || new Date(),
			]);
			await connection.commit();
		} catch (err) {
			await connection.rollback();
			throw err;
		} finally {
			connection.release();
		}
	}

	static async getPaymentHistory(orderId) {
		const query = `SELECT * FROM payment_transactions WHERE ORDER_ID = ? ORDER BY ENCODED_DT DESC`;
		const [rows] = await pool.execute(query, [orderId]);
		return rows;
	}

	static async resetRefundsInRange(startDate, endDate, branchId = null) {
		// Reset refunds for a given date window so that range re-syncs can recompute from scratch.
		// Normalize to YYYY-MM-DD; avoid DATE(b.REFUND_DT) so we don't hit "Truncated incorrect datetime"
		// when the column holds ISO strings (e.g. 2025-12-31T16:00:00.000Z).
		const toDateOnly = (v) => {
			if (v == null || v === '') return null;
			if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
			const d = new Date(v);
			if (Number.isNaN(d.getTime())) return null;
			return d.toISOString().slice(0, 10);
		};
		const start = toDateOnly(startDate);
		const end = toDateOnly(endDate);
		if (!start || !end) return;

		// Compare date part only (LEFT 10 chars) so we never parse ISO in column — avoids "Truncated incorrect datetime"
		let query = `
			UPDATE billing b
			INNER JOIN orders o ON o.IDNo = b.ORDER_ID
			SET
				b.REFUND = 0,
				b.REFUND_DT = NULL,
				b.REFUND_REASON = NULL
			WHERE
				b.REFUND IS NOT NULL
				AND LEFT(CAST(b.REFUND_DT AS CHAR), 10) >= ?
				AND LEFT(CAST(b.REFUND_DT AS CHAR), 10) <= ?
		`;

		const params = [start, end];

		if (branchId) {
			query += ' AND o.BRANCH_ID = ?';
			params.push(branchId);
		}

		await pool.execute(query, params);

		// If we track idempotent Loyverse refund receipts, clear the tracker rows in the same window,
		// otherwise range re-sync will reset billing refunds but then refuse to re-apply them (looks like "refund disappeared").
		try {
			await this.ensureLoyverseRefundsTable();
			let delQuery = `
				DELETE FROM loyverse_refund_receipts
				WHERE refund_dt IS NOT NULL
				AND DATE(refund_dt) >= DATE(?)
				AND DATE(refund_dt) <= DATE(?)
			`;
			const delParams = [start, end];
			if (branchId) {
				delQuery += ' AND branch_id = ?';
				delParams.push(branchId);
			}
			await pool.execute(delQuery, delParams);
		} catch (e) {
			// Best-effort: if table doesn't exist or DB user lacks perms, don't fail the whole sync.
			console.warn('[BillingModel.resetRefundsInRange] Failed to clear loyverse_refund_receipts tracker:', e?.message || e);
		}
	}

	/**
	 * Apply refund to billing. Idempotent per refund receipt number.
	 * @returns {{ changed: true }} when DB was updated
	 * @returns {{ changed: false }} when this refund receipt was already applied (no DB write)
	 * @returns false when order missing and cannot insert billing
	 */
	static async updateRefundForOrder(orderId, refundAmount, refundDt, refundReason, refundReceiptNumber = null) {
		const debug = String(process.env.LOYVERSE_DEBUG_SYNC || '').toLowerCase() === '1' || String(process.env.LOYVERSE_DEBUG_SYNC || '').toLowerCase() === 'true';

		if (debug) {
			console.log('[BillingModel.updateRefundForOrder] Incoming refund payload:', {
				orderId,
				refundAmount,
				refundDt,
				refundReason,
				refundReceiptNumber
			});
		}

		// Idempotency guard: one Loyverse refund receipt applies once only.
		if (refundReceiptNumber) {
			await this.ensureLoyverseRefundsTable();

			const [existingRows] = await pool.execute(
				`SELECT refund_receipt_number FROM loyverse_refund_receipts WHERE refund_receipt_number = ? LIMIT 1`,
				[refundReceiptNumber]
			);
			if (existingRows.length > 0) {
				if (debug) {
					console.log('[BillingModel.updateRefundForOrder] Refund already applied for receipt:', refundReceiptNumber);
				}
				return { changed: false };
			}

			let branchId = null;
			try {
				const [orderRows] = await pool.execute(
					`SELECT BRANCH_ID FROM orders WHERE IDNo = ? LIMIT 1`,
					[orderId]
				);
				branchId = orderRows[0]?.BRANCH_ID ?? null;
			} catch (_) {}

			try {
				await pool.execute(
					`INSERT INTO loyverse_refund_receipts
					 (refund_receipt_number, order_id, branch_id, refund_amount, refund_dt, refund_reason)
					 VALUES (?, ?, ?, ?, ?, ?)`,
					[refundReceiptNumber, orderId, branchId, refundAmount, refundDt, refundReason]
				);
			} catch (insertErr) {
				if (insertErr?.code === 'ER_DUP_ENTRY') {
					return { changed: false };
				}
				throw insertErr;
			}
		}

		// Try to update existing billing row first: accumulate refunds per order
		const updateQuery = `
			UPDATE billing SET
				REFUND = COALESCE(REFUND, 0) + ?,
				REFUND_DT = ?,
				REFUND_REASON = ?
			WHERE ORDER_ID = ?
		`;

		const [updateResult] = await pool.execute(updateQuery, [refundAmount, refundDt, refundReason, orderId]);
		if (debug) {
			console.log('[BillingModel.updateRefundForOrder] UPDATE result.affectedRows =', updateResult.affectedRows);
		}
		if (updateResult.affectedRows > 0) {
			return { changed: true };
		}

		// If no billing row exists for this order yet, create one so refunds are not lost
		const [orderRows] = await pool.execute(
			`SELECT BRANCH_ID, GRAND_TOTAL, ENCODED_DT FROM orders WHERE IDNo = ? LIMIT 1`,
			[orderId]
		);
		const order = orderRows[0];
		if (!order) {
			console.warn('[BillingModel.updateRefundForOrder] Order not found for refund, orderId=', orderId);
			return false;
		}

		const insertQuery = `
			INSERT INTO billing (
				IDNo,
				BRANCH_ID,
				ORDER_ID,
				PAYMENT_METHOD,
				AMOUNT_DUE,
				AMOUNT_PAID,
				REFUND,
				REFUND_DT,
				REFUND_REASON,
				STATUS,
				ENCODED_BY,
				ENCODED_DT
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;
		const [idRows] = await pool.execute('SELECT COALESCE(MAX(IDNo), 0) + 1 AS nextId FROM billing');
		const nextId = Number(idRows?.[0]?.nextId) || 1;

		await pool.execute(insertQuery, [
			nextId,
			order.BRANCH_ID || null,
			orderId,
			'CASH',
			order.GRAND_TOTAL || 0,
			0,
			refundAmount,
			refundDt,
			refundReason,
			1,
			0,
			order.ENCODED_DT || new Date()
		]);

		if (debug) {
			console.log('[BillingModel.updateRefundForOrder] INSERTED billing row with refund for orderId=', orderId);
		}

		return { changed: true };
	}
}

module.exports = BillingModel;
