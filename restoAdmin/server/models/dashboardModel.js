// ============================================
// DASHBOARD MODEL
// ============================================
// File: models/dashboardModel.js
// Description: Database operations for dashboard data
// ============================================

const pool = require('../config/db');

class DashboardModel {
	// Get today's revenue - Sum of AMOUNT_PAID from billing only
	// Legacy summary tables (sales_hourly_summary) have been removed from the database
	static async getTodaysRevenue(branchId = null, startDate = null, endDate = null) {
		const params = [];
		
		let billingQuery = `
			SELECT COALESCE(SUM(AMOUNT_PAID - COALESCE(REFUND, 0)), 0) as total_revenue
			FROM billing
			WHERE STATUS IN (1, 2)
		`;
		
		if (startDate && endDate) {
			if (startDate === endDate) {
				billingQuery += ` AND DATE(ENCODED_DT) = ?`;
				params.push(startDate);
			} else {
				billingQuery += ` AND DATE(ENCODED_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else {
			billingQuery += ` AND DATE(ENCODED_DT) = CURDATE()`;
		}
    
		if (branchId) {
			billingQuery += ` AND BRANCH_ID = ?`;
			params.push(branchId);
		}
		
		// Only use billing data; legacy summary tables have been dropped
		const [rows] = await pool.execute(billingQuery, params);
		return parseFloat(rows[0]?.total_revenue || 0);
	}

	// Get today's refunds - Sum of REFUND from billing where date is today
	static async getTodaysRefunds(branchId = null, startDate = null, endDate = null) {
		let query = `
			SELECT COALESCE(SUM(REFUND), 0) as total_refunds
			FROM billing
			WHERE 1=1
		`;
		const params = [];
		if (startDate && endDate) {
			if (startDate === endDate) {
				query += ` AND DATE(REFUND_DT) = ?`;
				params.push(startDate);
			} else {
				query += ` AND DATE(REFUND_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else {
			query += ` AND DATE(REFUND_DT) = CURDATE()`;
		}
		if (branchId) {
			query += ` AND BRANCH_ID = ?`;
			params.push(branchId);
		}
		const [rows] = await pool.execute(query, params);
		return parseFloat(rows[0]?.total_refunds || 0);
	}

	// Get total orders - Count of order items created today
	static async getTotalOrders(branchId = null, startDate = null, endDate = null) {
		let query = `
			SELECT COUNT(*) as total_orders
			FROM order_items oi
			INNER JOIN orders o ON oi.ORDER_ID = o.IDNo
			WHERE 1=1
		`;
		const params = [];
		if (startDate && endDate) {
			if (startDate === endDate) {
				query += ` AND DATE(o.ENCODED_DT) = ?`;
				params.push(startDate);
			} else {
				query += ` AND DATE(o.ENCODED_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else {
			query += ` AND DATE(o.ENCODED_DT) = CURDATE()`;
		}
		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}
		const [rows] = await pool.execute(query, params);
		return parseInt(rows[0]?.total_orders || 0);
	}

	// Get active tables - Count of tables with STATUS = 2 (OCCUPIED)
	static async getActiveTables(branchId = null, startDate = null, endDate = null) {
		let query = `
			SELECT COUNT(DISTINCT o.TABLE_ID) as active_tables
			FROM restaurant_tables rt
			INNER JOIN orders o ON rt.IDNo = o.TABLE_ID
			WHERE rt.ACTIVE = 1 AND o.STATUS NOT IN (1, -1) -- Exclude SETTLED (1) and CANCELLED (-1) orders
		`;
		const params = [];

		if (startDate && endDate) {
			if (startDate === endDate) {
				query += ` AND DATE(o.ENCODED_DT) = ?`;
				params.push(startDate);
			} else {
				query += ` AND DATE(o.ENCODED_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else {
			query += ` AND DATE(o.ENCODED_DT) = CURDATE()`;
		}

		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}
		const [rows] = await pool.execute(query, params);
		return parseInt(rows[0]?.active_tables || 0);
	}

	// Get pending orders - Count of order items with STATUS = 3 (PENDING)
	static async getPendingOrders(branchId = null, startDate = null, endDate = null) {
		let query = `
			SELECT COUNT(DISTINCT o.IDNo) as pending_orders
			FROM order_items oi
			INNER JOIN orders o ON oi.ORDER_ID = o.IDNo
			WHERE oi.STATUS = 3
		`;
		const params = [];
		if (startDate && endDate) {
			if (startDate === endDate) {
				query += ` AND DATE(o.ENCODED_DT) = ?`;
				params.push(startDate);
			} else {
				query += ` AND DATE(o.ENCODED_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else {
			query += ` AND DATE(o.ENCODED_DT) = CURDATE()`;
		}
		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}
		const [rows] = await pool.execute(query, params);
		return parseInt(rows[0]?.pending_orders || 0);
	}

	// Get popular items - Count of distinct menu items ordered today
	static async getPopularItems(branchId = null, startDate = null, endDate = null) {
		let query = `
			SELECT COUNT(DISTINCT oi.MENU_ID) as popular_items
			FROM order_items oi
			INNER JOIN orders o ON oi.ORDER_ID = o.IDNo
			WHERE 1=1
		`;
		const params = [];
		if (startDate && endDate) {
			if (startDate === endDate) {
				query += ` AND DATE(o.ENCODED_DT) = ?`;
				params.push(startDate);
			} else {
				query += ` AND DATE(o.ENCODED_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else {
			query += ` AND DATE(o.ENCODED_DT) = CURDATE()`;
		}
		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}
		const [rows] = await pool.execute(query, params);
		return parseInt(rows[0]?.popular_items || 0);
	}

	// Get bestseller items by meal period (all-time)
	// Returns bestseller for Breakfast (6:00 AM - 10:59 AM), Lunch (11:00 AM - 3:59 PM), and Dinner (4:00 PM - 11:59 PM)
	// Best seller persists until a new item beats it
	// Timezone: Converts to Asia/Manila (UTC+8) for accurate period classification
	static async getBestsellerByPeriod(branchId = null, startDate = null, endDate = null) {
		const dateField = 'COALESCE(oi.EDITED_DT, oi.ENCODED_DT)';
		// Convert to Asia/Manila timezone (UTC+8), fallback to +8 hours if timezone tables not available
		const localTime = `COALESCE(
			CONVERT_TZ(${dateField}, @@session.time_zone, '+08:00'),
			DATE_ADD(${dateField}, INTERVAL 8 HOUR)
		)`;
		const periodCase = `CASE 
			WHEN HOUR(${localTime}) >= 6 AND HOUR(${localTime}) < 11 THEN 'Breakfast'
			WHEN HOUR(${localTime}) >= 11 AND HOUR(${localTime}) < 16 THEN 'Lunch'
			ELSE 'Dinner'
		END`;
		let query = `
			SELECT 
				period,
				menu_name,
				total_sold
			FROM (
				SELECT 
					${periodCase} AS period,
					m.MENU_NAME as menu_name,
					SUM(oi.QTY) AS total_sold,
					ROW_NUMBER() OVER (
						PARTITION BY ${periodCase}
						ORDER BY SUM(oi.QTY) DESC
					) AS rn
				FROM order_items oi
				INNER JOIN menu m ON m.IDNo = oi.MENU_ID
				INNER JOIN orders o ON oi.ORDER_ID = o.IDNo
				WHERE oi.STATUS IN (1, 2, 3)
			`;
			const params = [];
			if (startDate && endDate) {
				if (startDate === endDate) {
					query += ` AND DATE(o.ENCODED_DT) = ?`;
					params.push(startDate);
				} else {
					query += ` AND DATE(o.ENCODED_DT) BETWEEN ? AND ?`;
					params.push(startDate, endDate);
				}
			} else {
				query += ` AND DATE(o.ENCODED_DT) = CURDATE()`;
			}
		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}
		query += `
				GROUP BY period, oi.MENU_ID, m.MENU_NAME
			) ranked
			WHERE rn = 1
			ORDER BY 
				CASE period
					WHEN 'Breakfast' THEN 1
					WHEN 'Lunch' THEN 2
					WHEN 'Dinner' THEN 3
				END ASC
		`;
		
		const [rows] = await pool.execute(query, params);
		return rows;
	}

	static async getPaymentMethodsSummary(branchId = null, startDate = null, endDate = null) {
		let query = `
			SELECT 
				PAYMENT_METHOD,
				COUNT(*) as payment_transaction,
				COALESCE(SUM(AMOUNT_PAID), 0) as payment_amount
			FROM billing
			WHERE STATUS IN (1, 2)
		`;
		
		const params = [];
		
		if (startDate && endDate) {
			if (startDate === endDate) {
				query += ` AND DATE(ENCODED_DT) = ?`;
				params.push(startDate);
			} else {
				query += ` AND DATE(ENCODED_DT) BETWEEN ? AND ?`;
				params.push(startDate, endDate);
			}
		} else if (startDate) {
			query += ` AND DATE(ENCODED_DT) = ?`;
			params.push(startDate);
		} else if (endDate) {
			query += ` AND DATE(ENCODED_DT) = ?`;
			params.push(endDate);
		} else {
			query += ` AND DATE(ENCODED_DT) = CURDATE()`;
		}
		
		if (branchId) {
			query += ` AND BRANCH_ID = ?`;
			params.push(branchId);
		}
		
		query += ` GROUP BY PAYMENT_METHOD ORDER BY payment_amount DESC`;
		
		const [rows] = await pool.execute(query, params);
		
		const normalizedRows = rows.map(row => {
			let method = (row.PAYMENT_METHOD || '').trim().toUpperCase();
			if (method === 'CASH') method = 'Cash';
			else if (method === 'GCASH') method = 'Gcash';
			else if (method === 'MAYA' || method === 'PAYMAYA') method = 'Paymaya';
			else if (method === 'CARD' || method === 'CREDIT CARD' || method === 'CREDITCARD') method = 'Credit Card';
			else if (method === 'BANK') method = 'Bank';
			else method = row.PAYMENT_METHOD;
			
			return {
				payment_method: method,
				payment_transaction: parseInt(row.payment_transaction || 0),
				payment_amount: parseFloat(row.payment_amount || 0)
			};
		});
		
		return normalizedRows;
	}

	// Get all dashboard statistics in one call
	static async getDashboardStats(branchId = null, startDate = null, endDate = null) {
		try {
			const [
				todaysRevenue,
				totalOrders,
				activeTables,
				pendingOrders,
				popularItems,
				todaysRefunds
			] = await Promise.all([
				this.getTodaysRevenue(branchId, startDate, endDate),
				this.getTotalOrders(branchId, startDate, endDate),
				this.getActiveTables(branchId, startDate, endDate),
				this.getPendingOrders(branchId, startDate, endDate),
				this.getPopularItems(branchId, startDate, endDate),
				this.getTodaysRefunds(branchId, startDate, endDate)
			]);

			return {
				todaysRevenue,
				totalOrders,
				activeTables,
				pendingOrders,
				popularItems,
				todaysRefunds
			};
		} catch (error) {
			console.error('Error fetching dashboard stats:', error);
			throw error;
		}
	}
}

module.exports = DashboardModel;

