// ============================================
// REPORTS MODEL
// ============================================
// File: models/reportsModel.js
// Description: Database operations for reports and analytics
// ============================================

const pool = require('../config/db');

class ReportsModel {
	// Get revenue report by period
	// Includes data from both billing table and sales_hourly_summary table (imported data)
	static async getRevenueReport(period = 'daily', startDate = null, endDate = null, branchId = null) {
		let dateFilter = '';
		let dateFilterSummary = '';
		const params = [];
		const summaryParams = [];

		if (period === 'daily') {
			if (startDate && endDate) {
				// Sargable range (index-friendly) — inclusive end day via < end+1 day
				dateFilter = 'AND b.ENCODED_DT >= ? AND b.ENCODED_DT < DATE_ADD(?, INTERVAL 1 DAY)';
				dateFilterSummary = 'AND s.sale_datetime >= ? AND s.sale_datetime < DATE_ADD(?, INTERVAL 1 DAY)';
				params.push(startDate, endDate);
				summaryParams.push(startDate, endDate);
			} else {
				dateFilter = 'AND DATE(b.ENCODED_DT) = CURDATE()';
				dateFilterSummary = 'AND DATE(s.sale_datetime) = CURDATE()';
			}
		} else if (period === 'weekly') {
			if (startDate && endDate) {
				dateFilter = 'AND b.ENCODED_DT >= ? AND b.ENCODED_DT < DATE_ADD(?, INTERVAL 1 DAY)';
				dateFilterSummary = 'AND s.sale_datetime >= ? AND s.sale_datetime < DATE_ADD(?, INTERVAL 1 DAY)';
				params.push(startDate, endDate);
				summaryParams.push(startDate, endDate);
			} else {
				dateFilter = 'AND YEARWEEK(b.ENCODED_DT) = YEARWEEK(CURDATE())';
				dateFilterSummary = 'AND YEARWEEK(s.sale_datetime) = YEARWEEK(CURDATE())';
			}
		} else if (period === 'monthly') {
			if (startDate && endDate) {
				dateFilter = 'AND b.ENCODED_DT >= ? AND b.ENCODED_DT < DATE_ADD(?, INTERVAL 1 DAY)';
				dateFilterSummary = 'AND s.sale_datetime >= ? AND s.sale_datetime < DATE_ADD(?, INTERVAL 1 DAY)';
				params.push(startDate, endDate);
				summaryParams.push(startDate, endDate);
			} else {
				dateFilter = 'AND YEAR(b.ENCODED_DT) = YEAR(CURDATE()) AND MONTH(b.ENCODED_DT) = MONTH(CURDATE())';
				dateFilterSummary = 'AND YEAR(s.sale_datetime) = YEAR(CURDATE()) AND MONTH(s.sale_datetime) = MONTH(CURDATE())';
			}
		}

		// Build billing query with grouping
		let billingGroupBy = '';
		if (period === 'daily') {
			billingGroupBy = ` GROUP BY DATE(b.ENCODED_DT)`;
		} else if (period === 'weekly') {
			billingGroupBy = ` GROUP BY YEARWEEK(b.ENCODED_DT)`;
		} else if (period === 'monthly') {
			billingGroupBy = ` GROUP BY YEAR(b.ENCODED_DT), MONTH(b.ENCODED_DT)`;
		}

		let billingQuery = `
			SELECT 
				DATE(b.ENCODED_DT) as date,
				SUM(b.AMOUNT_PAID) as revenue,
				COUNT(DISTINCT b.ORDER_ID) as order_count,
				AVG(b.AMOUNT_PAID) as average_order_value
			FROM billing b
			WHERE b.STATUS IN (1, 2)
			${dateFilter}
		`;

		if (branchId) {
			billingQuery += ` AND b.BRANCH_ID = ?`;
			params.push(branchId);
		}

		billingQuery += billingGroupBy;

		// Build sales_hourly_summary query with grouping
		let summaryGroupBy = '';
		if (period === 'daily') {
			summaryGroupBy = ` GROUP BY DATE(s.sale_datetime)`;
		} else if (period === 'weekly') {
			summaryGroupBy = ` GROUP BY YEARWEEK(s.sale_datetime)`;
		} else if (period === 'monthly') {
			summaryGroupBy = ` GROUP BY YEAR(s.sale_datetime), MONTH(s.sale_datetime)`;
		}

		let summaryQuery = `
			SELECT 
				DATE(s.sale_datetime) as date,
				SUM(s.total_sales) as revenue,
				0 as order_count,
				0 as average_order_value
			FROM sales_hourly_summary s
			WHERE 1=1
			${dateFilterSummary}
		`;

		if (branchId) {
			summaryQuery += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
			summaryParams.push(branchId);
		}

		summaryQuery += summaryGroupBy;

		// Combine both queries with UNION and aggregate
		let query = `
			SELECT 
				date,
				SUM(revenue) as revenue,
				SUM(order_count) as order_count,
				CASE 
					WHEN SUM(order_count) > 0 THEN SUM(revenue) / SUM(order_count)
					ELSE 0
				END as average_order_value
			FROM (
				${billingQuery}
				UNION ALL
				${summaryQuery}
			) AS combined_data
		`;

		if (period === 'daily') {
			query += ` GROUP BY date ORDER BY date DESC`;
		} else if (period === 'weekly') {
			query += ` GROUP BY YEARWEEK(date) ORDER BY date DESC`;
		} else if (period === 'monthly') {
			query += ` GROUP BY YEAR(date), MONTH(date) ORDER BY date DESC`;
		}

		// Combine params for execution
		const allParams = [...params, ...summaryParams];
		try {
			const [rows] = await pool.execute(query, allParams);
			return rows;
		} catch (err) {
			if (err?.code !== 'ER_NO_SUCH_TABLE' || !String(err?.sqlMessage || '').includes('sales_hourly_summary')) {
				throw err;
			}
			// Fallback when imported sales summary table is not deployed — billing-only revenue.
			let billingOnlyQuery = billingQuery;
			if (period === 'daily') {
				billingOnlyQuery += ` ORDER BY date DESC`;
			}
			const [billingRows] = await pool.execute(billingOnlyQuery, params);
			return billingRows;
		}
	}

	// Get order reports
	static async getOrderReport(startDate = null, endDate = null, branchId = null, status = null) {
		let dateFilter = '';
		const params = [];

		if (startDate && endDate) {
			dateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			params.push(startDate, endDate);
		} else {
			dateFilter = 'AND DATE(o.ENCODED_DT) = CURDATE()';
		}

		let query = `
			SELECT 
				DATE(o.ENCODED_DT) as date,
				COUNT(DISTINCT o.IDNo) as total_orders,
				COUNT(oi.IDNo) as total_items,
				SUM(o.GRAND_TOTAL) as total_revenue,
				AVG(o.GRAND_TOTAL) as average_order_value,
				SUM(CASE WHEN o.STATUS = 1 THEN 1 ELSE 0 END) as settled_orders,
				SUM(CASE WHEN o.STATUS = 2 THEN 1 ELSE 0 END) as confirmed_orders,
				SUM(CASE WHEN o.STATUS = 3 THEN 1 ELSE 0 END) as pending_orders
			FROM orders o
			LEFT JOIN order_items oi ON oi.ORDER_ID = o.IDNo
			WHERE 1=1
			${dateFilter}
		`;

		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}

		if (status !== null && status !== undefined) {
			query += ` AND o.STATUS = ?`;
			params.push(status);
		}

		query += ` GROUP BY DATE(o.ENCODED_DT) ORDER BY date DESC`;

		const [rows] = await pool.execute(query, params);
		return rows;
	}

	// Get most popular menu items
	static async getPopularMenuItems(startDate = null, endDate = null, branchId = null, limit = 10) {
		let dateFilter = '';
		const params = [];

		if (startDate && endDate) {
			dateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			params.push(startDate, endDate);
		} else {
			dateFilter = 'AND DATE(o.ENCODED_DT) = CURDATE()';
		}

		let query = `
			SELECT 
				m.IDNo,
				m.MENU_NAME,
				m.MENU_PRICE,
				SUM(oi.QTY) as total_quantity,
				COUNT(DISTINCT oi.ORDER_ID) as order_count,
				SUM(oi.LINE_TOTAL) as total_revenue
			FROM order_items oi
			INNER JOIN orders o ON o.IDNo = oi.ORDER_ID
			INNER JOIN menu m ON m.IDNo = oi.MENU_ID
			WHERE 1=1
			${dateFilter}
		`;

		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}

		query += `
			GROUP BY m.IDNo, m.MENU_NAME, m.MENU_PRICE
			ORDER BY total_quantity DESC
			LIMIT ?
		`;
		params.push(limit);

		const [rows] = await pool.execute(query, params);
		return rows;
	}

	// Get daily sales by product for chart (last N days)
	// Returns daily revenue breakdown for top products
	// Only includes paid orders (joins with billing table)
	// Uses order date (o.ENCODED_DT) for daily grouping
	static async getDailySalesByProduct(startDate = null, endDate = null, branchId = null, limit = 5) {
		let dateFilter = '';
		const params = [];

		// Convert to Asia/Manila timezone (UTC+8) for accurate date extraction
		// This ensures orders created on Feb 19 in local time show as Feb 19, not Feb 18
		const localTimeField = `COALESCE(
			CONVERT_TZ(o.ENCODED_DT, @@session.time_zone, '+08:00'),
			DATE_ADD(o.ENCODED_DT, INTERVAL 8 HOUR)
		)`;

		if (startDate && endDate) {
			// Use DATE() with timezone adjustment to ensure proper date comparison
			// Convert to local time (UTC+8 for Philippines) before extracting date
			dateFilter = `AND DATE(${localTimeField}) >= DATE(?) AND DATE(${localTimeField}) <= DATE(?)`;
			params.push(startDate, endDate);
		} else {
			// Default to last 30 days
			const end = new Date();
			const start = new Date();
			start.setDate(start.getDate() - 29);
			dateFilter = `AND DATE(${localTimeField}) >= DATE(?) AND DATE(${localTimeField}) <= DATE(?)`;
			params.push(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
		}

		// First, get top N products by total revenue (only paid orders)
		let topProductsQuery = `
			SELECT 
				m.IDNo,
				m.MENU_NAME
			FROM order_items oi
			INNER JOIN orders o ON o.IDNo = oi.ORDER_ID
			INNER JOIN billing b ON b.ORDER_ID = o.IDNo
			INNER JOIN menu m ON m.IDNo = oi.MENU_ID
			WHERE b.STATUS = 1
			${dateFilter}
		`;

		const topProductsParams = [...params];
		if (branchId && branchId !== 'all') {
			topProductsQuery += ` AND o.BRANCH_ID = ?`;
			topProductsParams.push(branchId);
		}

		topProductsQuery += `
			GROUP BY m.IDNo, m.MENU_NAME
			ORDER BY SUM(oi.LINE_TOTAL) DESC
			LIMIT ?
		`;
		topProductsParams.push(limit);

		const [topProducts] = await pool.execute(topProductsQuery, topProductsParams);

		if (!topProducts || topProducts.length === 0) {
			return [];
		}

		const productIds = topProducts
			.map(p => p && p.IDNo ? parseInt(p.IDNo, 10) : null)
			.filter(id => id !== null && !isNaN(id));

		if (productIds.length === 0) {
			return [];
		}

		const placeholders = productIds.map(() => '?').join(',');

		// Get daily sales for these top products (only paid orders)
		// Group by order date (o.ENCODED_DT) to match the date filter
		// Convert to local time (UTC+8 for Philippines) before extracting date
		// Use DATE_FORMAT to return string 'YYYY-MM-DD' instead of Date object
		// This ensures orders created on Feb 19 show as Feb 19, not Feb 18
		let query = `
			SELECT 
				DATE_FORMAT(${localTimeField}, '%Y-%m-%d') as date,
				m.IDNo as menu_id,
				m.MENU_NAME,
				COALESCE(SUM(oi.LINE_TOTAL), 0) as daily_revenue
			FROM order_items oi
			INNER JOIN orders o ON o.IDNo = oi.ORDER_ID
			INNER JOIN billing b ON b.ORDER_ID = o.IDNo
			INNER JOIN menu m ON m.IDNo = oi.MENU_ID
			WHERE b.STATUS = 1
			AND m.IDNo IN (${placeholders})
			${dateFilter}
		`;

		const dailyParams = [...productIds, ...params];
		if (branchId && branchId !== 'all') {
			query += ` AND o.BRANCH_ID = ?`;
			dailyParams.push(branchId);
		}

		query += `
			GROUP BY DATE(${localTimeField}), m.IDNo, m.MENU_NAME
			ORDER BY date ASC, m.IDNo ASC
		`;

		const [rows] = await pool.execute(query, dailyParams);
		return rows;
	}

	/**
	 * Fast single-item analytics (Node SQL — not PyServer menu-report).
	 * One daily series query covering all comparison windows + 6-month chart.
	 */
	static async getMenuItemAnalytics({ goods, branchId = null, rangeStart, rangeEnd }) {
		const goodsName = String(goods || '').trim();
		if (!goodsName || !rangeStart || !rangeEnd) {
			return { daily: [] };
		}

		const localDt = `COALESCE(
			CONVERT_TZ(b.ENCODED_DT, @@session.time_zone, '+08:00'),
			DATE_ADD(b.ENCODED_DT, INTERVAL 8 HOUR)
		)`;

		const isRoomCharge = /^room\s*charge$/i.test(goodsName);
		const hasBranch = branchId != null && branchId !== '' && String(branchId) !== 'all';
		const branchSql = hasBranch ? ' AND b.BRANCH_ID = ?' : '';

		let query;
		let execParams;

		if (isRoomCharge) {
			query = `
				SELECT
					DATE_FORMAT(${localDt}, '%Y-%m-%d') AS sale_date,
					COUNT(DISTINCT o.IDNo) AS qty,
					COALESCE(SUM(o.SERVICE_CHARGE), 0) AS amount
				FROM orders o
				INNER JOIN billing b
					ON b.ORDER_ID = o.IDNo
					AND b.STATUS IN (1, 2)
					AND b.STATUS NOT IN (-1, -2)
					AND o.STATUS NOT IN (-1, -2)
				WHERE DATE(${localDt}) BETWEEN DATE(?) AND DATE(?)
				${branchSql}
				GROUP BY DATE_FORMAT(${localDt}, '%Y-%m-%d')
				ORDER BY sale_date ASC
			`;
			execParams = hasBranch
				? [rangeStart, rangeEnd, Number(branchId)]
				: [rangeStart, rangeEnd];
		} else {
			query = `
				SELECT
					DATE_FORMAT(${localDt}, '%Y-%m-%d') AS sale_date,
					COALESCE(SUM(oi.QTY), 0) AS qty,
					COALESCE(SUM(oi.LINE_TOTAL), 0) AS amount
				FROM orders o
				INNER JOIN billing b
					ON b.ORDER_ID = o.IDNo
					AND b.STATUS IN (1, 2)
					AND b.STATUS NOT IN (-1, -2)
					AND o.STATUS NOT IN (-1, -2)
				INNER JOIN order_items oi ON oi.ORDER_ID = o.IDNo
				INNER JOIN menu m ON m.IDNo = oi.MENU_ID
				WHERE DATE(${localDt}) BETWEEN DATE(?) AND DATE(?)
				  AND LOWER(TRIM(m.MENU_NAME)) = LOWER(TRIM(?))
				${branchSql}
				GROUP BY DATE_FORMAT(${localDt}, '%Y-%m-%d')
				ORDER BY sale_date ASC
			`;
			execParams = hasBranch
				? [rangeStart, rangeEnd, goodsName, Number(branchId)]
				: [rangeStart, rangeEnd, goodsName];
		}

		const [rows] = await pool.execute(query, execParams);
		return {
			daily: (rows || []).map((r) => ({
				sale_date: String(r.sale_date).slice(0, 10),
				qty: Number(r.qty) || 0,
				amount: Number(r.amount) || 0,
			})),
		};
	}

	// Get table utilization report
	static async getTableUtilizationReport(startDate = null, endDate = null, branchId = null) {
		let dateFilter = '';
		const params = [];

		if (startDate && endDate) {
			dateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			params.push(startDate, endDate);
		} else {
			dateFilter = 'AND DATE(o.ENCODED_DT) = CURDATE()';
		}

		let query = `
			SELECT 
				rt.IDNo,
				rt.TABLE_NUMBER,
				rt.CAPACITY,
				COUNT(DISTINCT o.IDNo) as order_count,
				SUM(o.GRAND_TOTAL) as total_revenue,
				AVG(o.GRAND_TOTAL) as average_order_value,
				SUM(CASE WHEN o.STATUS = 1 THEN 1 ELSE 0 END) as settled_count
			FROM restaurant_tables rt
			LEFT JOIN orders o ON o.TABLE_ID = rt.IDNo
			WHERE rt.ACTIVE = 1
			${dateFilter}
		`;

		if (branchId) {
			query += ` AND rt.BRANCH_ID = ?`;
			params.push(branchId);
		}

		query += ` GROUP BY rt.IDNo, rt.TABLE_NUMBER, rt.CAPACITY ORDER BY order_count DESC`;

		const [rows] = await pool.execute(query, params);
		return rows;
	}

	// Get employee performance report
	static async getEmployeePerformanceReport(startDate = null, endDate = null, branchId = null, employeeId = null) {
		let dateFilter = '';
		const params = [];

		if (startDate && endDate) {
			dateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			params.push(startDate, endDate);
		} else {
			dateFilter = 'AND DATE(o.ENCODED_DT) = CURDATE()';
		}

		let query = `
			SELECT 
				u.IDNo as user_id,
				u.USERNAME,
				u.FIRSTNAME,
				u.LASTNAME,
				CONCAT(u.FIRSTNAME, ' ', u.LASTNAME) as fullname,
				COUNT(DISTINCT o.IDNo) as orders_created,
				SUM(o.GRAND_TOTAL) as total_sales,
				AVG(o.GRAND_TOTAL) as average_order_value,
				COUNT(DISTINCT DATE(o.ENCODED_DT)) as days_active
			FROM user_info u
			INNER JOIN orders o ON o.ENCODED_BY = u.IDNo
			WHERE u.ACTIVE = 1
			${dateFilter}
		`;

		if (branchId) {
			query += ` AND o.BRANCH_ID = ?`;
			params.push(branchId);
		}

		if (employeeId) {
			query += ` AND u.IDNo = ?`;
			params.push(employeeId);
		}

		query += ` GROUP BY u.IDNo, u.USERNAME, u.FIRSTNAME, u.LASTNAME ORDER BY total_sales DESC`;

		const [rows] = await pool.execute(query, params);
		return rows;
	}

	// Get sales hourly summary based only on live orders + receipts.
	// Legacy summary table (sales_hourly_summary) has been removed.
	static async getSalesHourlySummary(startDate = null, endDate = null, branchId = null) {
		const params = [];
		const orderParams = [];
		let dateFilter = '';
		let branchFilter = '';
		let orderDateFilter = '';
		let orderBranchFilter = '';

		if (startDate && endDate) {
			dateFilter = 'AND DATE(sale_datetime) BETWEEN ? AND ?';
			params.push(startDate, endDate);
			orderDateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			orderParams.push(startDate, endDate);
		}

		if (branchId) {
			branchFilter = 'AND branch_id = ?';
			params.push(branchId);
			orderBranchFilter = 'AND o.BRANCH_ID = ?';
			orderParams.push(branchId);
		}

		// Legacy summary table (sales_hourly_summary) has been dropped.
		// We now rely solely on actual orders + receipts for hourly stats.
		const summaryRows = [];

		// Get data from actual orders (paid orders only)
		const ordersQuery = `
			SELECT 
				DATE_FORMAT(DATE(o.ENCODED_DT), '%Y-%m-%d') as date_part,
				DATE_FORMAT(o.ENCODED_DT, '%Y-%m-%d %H:00:00') as hour,
				COALESCE(SUM(o.GRAND_TOTAL), 0) as total_sales,
				0 as refund,
				COALESCE(SUM(o.DISCOUNT_AMOUNT), 0) as discount,
				COALESCE(SUM(o.GRAND_TOTAL - COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) as net_sales,
				COALESCE(SUM(o.SUBTOTAL), 0) as product_unit_price,
				COALESCE(SUM(o.GRAND_TOTAL - COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) as gross_profit
			FROM orders o
			INNER JOIN billing b ON b.ORDER_ID = o.IDNo
			WHERE b.STATUS = 1
			${orderDateFilter}
			${orderBranchFilter}
			GROUP BY DATE_FORMAT(o.ENCODED_DT, '%Y-%m-%d %H:00:00')
		`;
		const [orderRows] = await pool.execute(ordersQuery, orderParams);

		// Get refunds from receipts table (transaction_type = 2 means refund)
		const refundParams = [];
		let refundDateFilter = '';
		let refundBranchFilter = '';

		if (startDate && endDate) {
			refundDateFilter = 'AND DATE(r.receipt_date) BETWEEN ? AND ?';
			refundParams.push(startDate, endDate);
		}

		// Note: receipts table doesn't have branch_id, so we'll get all refunds
		// If branch filtering is needed, we might need to join with orders table
		const refundsQuery = `
			SELECT 
				DATE_FORMAT(r.receipt_date, '%Y-%m-%d %H:00:00') as hour,
				COALESCE(SUM(r.total_amount), 0) as refund_amount
			FROM receipts r
			WHERE r.transaction_type = 2
			${refundDateFilter}
			GROUP BY DATE_FORMAT(r.receipt_date, '%Y-%m-%d %H:00:00')
		`;
		const [refundRows] = await pool.execute(refundsQuery, refundParams);

		// Combine data: merge summary data with actual orders data
		const dataMap = new Map();

		// Add summary data
		summaryRows.forEach(row => {
			const hour = row.hour;
			if (!dataMap.has(hour)) {
				dataMap.set(hour, {
					hour: hour,
					total_sales: 0,
					refund: 0,
					discount: 0,
					net_sales: 0,
					product_unit_price: 0,
					gross_profit: 0
				});
			}
			const data = dataMap.get(hour);
			data.total_sales += parseFloat(row.total_sales) || 0;
			data.refund += parseFloat(row.refund) || 0;
			data.discount += parseFloat(row.discount) || 0;
			data.net_sales += parseFloat(row.net_sales) || 0;
			data.product_unit_price += parseFloat(row.product_unit_price) || 0;
			data.gross_profit += parseFloat(row.gross_profit) || 0;
		});

		// Add/merge actual orders data
		orderRows.forEach(row => {
			const hour = row.hour;
			if (!dataMap.has(hour)) {
				dataMap.set(hour, {
					hour: hour,
					total_sales: 0,
					refund: 0,
					discount: 0,
					net_sales: 0,
					product_unit_price: 0,
					gross_profit: 0
				});
			}
			const data = dataMap.get(hour);
			data.total_sales += parseFloat(row.total_sales) || 0;
			data.refund += parseFloat(row.refund) || 0;
			data.discount += parseFloat(row.discount) || 0;
			data.net_sales += parseFloat(row.net_sales) || 0;
			data.product_unit_price += parseFloat(row.product_unit_price) || 0;
			data.gross_profit += parseFloat(row.gross_profit) || 0;
		});

		// Add/merge refunds from receipts table
		// Sum refunds from receipts (they are actual transactions)
		// Summary table might have imported refunds, but receipts are the source of truth for actual refunds
		// We'll sum them to get total refunds (summary + new refunds from receipts)
		refundRows.forEach(row => {
			const hour = row.hour;
			const refundAmount = parseFloat(row.refund_amount) || 0;
			if (refundAmount === 0) return;

			if (!dataMap.has(hour)) {
				dataMap.set(hour, {
					hour: hour,
					total_sales: 0,
					refund: 0,
					discount: 0,
					net_sales: 0,
					product_unit_price: 0,
					gross_profit: 0
				});
			}
			const data = dataMap.get(hour);
			const currentRefund = data.refund || 0;

			// Sum refunds: summary refunds + receipts refunds
			// This ensures we capture all refunds (both imported and actual)
			data.refund = currentRefund + refundAmount;
			// Adjust net_sales and gross_profit to account for refunds
			data.net_sales -= refundAmount;
			data.gross_profit -= refundAmount;
		});

		// Convert map to array and sort by hour descending
		const result = Array.from(dataMap.values()).sort((a, b) => {
			return new Date(b.hour) - new Date(a.hour);
		});

		return result;
	}

	// Import sales hourly summary
	// NO-OP: sales_hourly_summary table has been removed from the database.
	static async importSalesHourlySummary(rows, branchId = null) {
		return {
			inserted: 0,
			message: 'sales_hourly_summary table has been removed; importSalesHourlySummary is disabled.',
		};
	}

	// Legacy: sync order to sales_category_report (summary table removed)
	// NO-OP now; kept only for backward compatibility so callers don't break.
	static async syncOrderToSalesCategoryReport(orderId) {
		return {
			success: false,
			message: 'sales_category_report table has been removed; syncOrderToSalesCategoryReport is disabled.',
		};
	}

	// Legacy: sync order to sales_hourly_summary (summary table removed)
	// NO-OP now; kept only for backward compatibility so callers don't break.
	static async syncOrderToSalesHourlySummary(orderId) {
		return {
			success: false,
			message: 'sales_hourly_summary table has been removed; syncOrderToSalesHourlySummary is disabled.',
		};
	}

	// Alias for syncOrderToGoodsSalesReport for backward compatibility
	static async syncOrderToProductSalesSummary(orderId) {
		return this.syncOrderToGoodsSalesReport(orderId);
	}

	// Sync order to goods_sales_report when order is paid/settled
	// This automatically updates the goods_sales_report table when an order is completed
	// Aggregates sales by goods/product
	static async syncOrderToGoodsSalesReport(orderId) {
		try {
			// NO-OP if legacy table doesn't exist (newer DBs removed it).
			// Do a lightweight existence check up-front to avoid noisy logs.
			try {
				await pool.execute(`SELECT 1 FROM goods_sales_report LIMIT 1`);
			} catch (e) {
				if (e && e.code === 'ER_NO_SUCH_TABLE') {
					return {
						success: false,
						message: 'goods_sales_report table has been removed; syncOrderToGoodsSalesReport is disabled.',
					};
				}
				throw e;
			}

			// Get order details with billing info
			const [orderRows] = await pool.execute(`
				SELECT 
					o.IDNo,
					o.BRANCH_ID,
					o.ENCODED_DT,
					o.GRAND_TOTAL,
					o.DISCOUNT_AMOUNT,
					o.SUBTOTAL,
					b.STATUS as billing_status
				FROM orders o
				LEFT JOIN billing b ON b.ORDER_ID = o.IDNo
				WHERE o.IDNo = ?
			`, [orderId]);

			if (!orderRows || orderRows.length === 0) {
				return { success: false, message: 'Order not found' };
			}

			const order = orderRows[0];

			// Only sync if billing is PAID (status = 1)
			if (!order.billing_status || parseInt(order.billing_status) !== 1) {
				return { success: false, message: 'Order not paid yet' };
			}

			// Get order items with menu and category information
			const [orderItems] = await pool.execute(`
				SELECT 
					oi.MENU_ID,
					oi.QTY,
					oi.UNIT_PRICE,
					oi.LINE_TOTAL,
					m.MENU_NAME,
					m.CATEGORY_ID,
					c.CAT_NAME as category_name
				FROM order_items oi
				INNER JOIN menu m ON m.IDNo = oi.MENU_ID
				LEFT JOIN categories c ON c.IDNo = m.CATEGORY_ID
				WHERE oi.ORDER_ID = ?
			`, [orderId]);

			if (!orderItems || orderItems.length === 0) {
				return { success: false, message: 'Order has no items' };
			}

			// Calculate discount proportion (if any)
			const discountAmount = parseFloat(order.DISCOUNT_AMOUNT) || 0;
			const subtotal = parseFloat(order.SUBTOTAL) || 0;
			const discountRatio = subtotal > 0 ? discountAmount / subtotal : 0;

			// Aggregate by goods/product
			const goodsMap = new Map();

			orderItems.forEach((item) => {
				const goodsName = (item.MENU_NAME || 'Unnamed Product').trim();
				if (!goodsName) return;

				const qty = parseFloat(item.QTY) || 0;
				const unitPrice = parseFloat(item.UNIT_PRICE) || 0;
				const lineTotal = parseFloat(item.LINE_TOTAL) || 0;
				const categoryName = (item.category_name || 'Uncategorized').trim();

				// Calculate discount for this item proportionally
				const itemDiscount = lineTotal * discountRatio;
				const netSales = lineTotal - itemDiscount;

				if (!goodsMap.has(goodsName)) {
					goodsMap.set(goodsName, {
						goods: goodsName,
						category: categoryName,
						sales_quantity: 0,
						discounts: 0,
						net_sales: 0,
						unit_cost: 0,
						total_revenue: 0
					});
				}

				const goodsData = goodsMap.get(goodsName);
				goodsData.sales_quantity += qty;
				goodsData.discounts += itemDiscount;
				goodsData.net_sales += netSales;
				goodsData.total_revenue += netSales; // total_revenue = net_sales
			});

			// Update or insert into goods_sales_report
			for (const [goodsName, goodsData] of goodsMap.entries()) {
				// Set unit_cost to 0 for now (data source not yet determined)
				const unitCost = 0;

				// Check if record exists for this goods
				const [existingRows] = await pool.execute(`
					SELECT id FROM goods_sales_report WHERE goods = ?
				`, [goodsName]);

				if (existingRows && existingRows.length > 0) {
					// Update existing record - add to existing values
					await pool.execute(`
						UPDATE goods_sales_report SET
							category = ?,
							sales_quantity = sales_quantity + ?,
							discounts = discounts + ?,
							net_sales = net_sales + ?,
							total_revenue = total_revenue + ?
						WHERE goods = ?
					`, [
						goodsData.category,
						goodsData.sales_quantity,
						goodsData.discounts,
						goodsData.net_sales,
						goodsData.total_revenue,
						goodsName
					]);
				} else {
					// Insert new record
					await pool.execute(`
						INSERT INTO goods_sales_report (goods, category, sales_quantity, discounts, net_sales, unit_cost, total_revenue)
						VALUES (?, ?, ?, ?, ?, ?, ?)
					`, [
						goodsName,
						goodsData.category,
						goodsData.sales_quantity,
						goodsData.discounts,
						goodsData.net_sales,
						unitCost,
						goodsData.total_revenue
					]);
				}
			}

			return { success: true, message: 'Order synced to goods_sales_report', goods: goodsMap.size };
		} catch (error) {
			// Avoid spamming logs when legacy tables are missing.
			if (error && error.code === 'ER_NO_SUCH_TABLE') {
				return { success: false, message: 'goods_sales_report table has been removed; syncOrderToGoodsSalesReport is disabled.' };
			}
			console.error('Error syncing order to goods_sales_report:', error);
			// Don't throw - this is a background sync operation
			return { success: false, message: error.message };
		}
	}

	// Get receipts (from receipts table)
	// Columns: receipt_number, receipt_date, employee_name, customer_name, transaction_type, total_amount
	static async getReceipts(startDate = null, endDate = null, branchId = null, employeeFilter = null, search = null) {
		const params = [];
		let dateFilter = '';
		let employeeFilterClause = '';
		let searchClause = '';

		if (startDate && endDate) {
			dateFilter = 'AND DATE(receipt_date) BETWEEN ? AND ?';
			params.push(startDate, endDate);
		}

		if (employeeFilter && employeeFilter !== 'all') {
			employeeFilterClause = 'AND employee_name = ?';
			params.push(employeeFilter);
		}

		if (search && search.trim()) {
			const term = `%${search.trim()}%`;
			searchClause = 'AND (receipt_number LIKE ? OR employee_name LIKE ? OR customer_name LIKE ? OR CAST(transaction_type AS CHAR) LIKE ?)';
			params.push(term, term, term, term);
		}

		const query = `
			SELECT receipt_number, receipt_date, employee_name, customer_name, transaction_type, total_amount
			FROM receipts
			WHERE 1=1
			${dateFilter}
			${employeeFilterClause}
			${searchClause}
			ORDER BY receipt_date DESC
		`;
		const [rows] = await pool.execute(query, params);
		return rows;
	}

	// Import receipts (insert into receipts table)
	// Expects array of { receipt_number, receipt_date, employee_name, customer_name, transaction_type, total_amount }
	// Uses INSERT IGNORE to skip duplicates (receipt_number has UNIQUE key)
	static async importReceipts(rows) {
		if (!rows || rows.length === 0) {
			return { inserted: 0, skipped: 0, message: 'No data to import' };
		}
		let inserted = 0;
		let skipped = 0;
		for (const row of rows) {
			const receiptNumber = String(row.receipt_number || '').trim();
			if (!receiptNumber) continue;
			let receiptDate = row.receipt_date || (row.date && row.time ? `${row.date} ${row.time.length === 5 ? row.time + ':00' : row.time}` : row.date) || null;
			if (!receiptDate) continue;
			if (typeof receiptDate === 'string' && receiptDate.includes('T')) {
				receiptDate = receiptDate.replace('T', ' ').slice(0, 19);
			}
			const employeeName = String(row.employee_name || row.employee || '').trim() || null;
			const customerName = String(row.customer_name || row.customer || '').trim() || null;
			// transaction_type: 1 = sales, 2 = refund
			const typeRaw = row.transaction_type ?? row.type ?? 1;
			const transactionType = [1, 2, '1', '2'].includes(typeRaw)
				? parseInt(typeRaw, 10)
				: /^(refund|2|환불)$/i.test(String(typeRaw).trim()) ? 2 : 1;
			const totalAmount = parseFloat(row.total_amount || row.total) || 0;

			const [result] = await pool.execute(
				`INSERT IGNORE INTO receipts (receipt_number, receipt_date, employee_name, customer_name, transaction_type, total_amount)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				[receiptNumber, receiptDate, employeeName, customerName, transactionType, totalAmount]
			);
			if (result.affectedRows > 0) {
				inserted++;
			} else {
				skipped++;
			}
		}
		return { inserted, skipped };
	}

	// Get discount report (from discount_report table + actual orders)
	// Columns: name, discount_applied, point_discount_amount
	// Accepts start_date, end_date, branch_id for future extension when view has those columns
	static async getDiscountReport(startDate = null, endDate = null, branchId = null) {
		const orderParams = [];
		let orderDateFilter = '';
		let orderBranchFilter = '';

		if (startDate && endDate) {
			orderDateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			orderParams.push(startDate, endDate);
		}

		if (branchId) {
			orderBranchFilter = 'AND o.BRANCH_ID = ?';
			orderParams.push(branchId);
		}

		// Get data from discount_report (imported data with discount names/types)
		const summaryQuery = `SELECT name, discount_applied, point_discount_amount FROM discount_report`;
		const [summaryRows] = await pool.execute(summaryQuery);

		// Get total discount from actual orders (paid orders only)
		const ordersQuery = `
			SELECT 
				COALESCE(SUM(o.DISCOUNT_AMOUNT), 0) as total_discount,
				COUNT(DISTINCT o.IDNo) as total_orders_with_discount
			FROM orders o
			INNER JOIN billing b ON b.ORDER_ID = o.IDNo
			WHERE b.STATUS = 1 AND o.DISCOUNT_AMOUNT > 0
			${orderDateFilter}
			${orderBranchFilter}
		`;
		const [orderRows] = await pool.execute(ordersQuery, orderParams);
		const totalDiscountFromOrders = parseFloat(orderRows[0]?.total_discount || 0);
		const totalOrdersWithDiscount = parseInt(orderRows[0]?.total_orders_with_discount || 0);

		// Calculate total from discount_report
		const totalFromReport = summaryRows.reduce((sum, row) => {
			return sum + (parseFloat(row.point_discount_amount || 0));
		}, 0);

		// If there's a difference, add/update a "Total Discount" row or adjust existing rows
		// For now, we'll add the actual orders discount to the report
		// If discount_report has data, we'll merge; otherwise create a summary row
		const result = [...summaryRows];

		// If there's discount from orders that's not in the report, add it
		// We'll add it as "Total Discount from Orders" if there's a significant difference
		if (totalDiscountFromOrders > 0 && Math.abs(totalDiscountFromOrders - totalFromReport) > 0.01) {
			// Check if there's already a "Total" or similar row
			const hasTotalRow = result.some(row =>
				row.name && (
					row.name.toLowerCase().includes('total') ||
					row.name.toLowerCase().includes('할인') ||
					row.name === 'Total Discount'
				)
			);

			if (!hasTotalRow && totalDiscountFromOrders > totalFromReport) {
				// Add the difference as "Additional Discounts"
				const difference = totalDiscountFromOrders - totalFromReport;
				if (difference > 0.01) {
					result.push({
						name: 'Additional Discounts',
						discount_applied: totalOrdersWithDiscount,
						point_discount_amount: difference
					});
				}
			} else if (hasTotalRow) {
				// Update the total row to match actual orders total
				const totalRowIndex = result.findIndex(row =>
					row.name && (
						row.name.toLowerCase().includes('total') ||
						row.name.toLowerCase().includes('할인') ||
						row.name === 'Total Discount'
					)
				);
				if (totalRowIndex >= 0) {
					result[totalRowIndex].point_discount_amount = totalDiscountFromOrders;
					result[totalRowIndex].discount_applied = totalOrdersWithDiscount;
				}
			}
		}

		return result;
	}

	// Import discount data (insert into discount_report table)
	// Expects array of { name, discount_applied, point_discount_amount }
	static async importDiscountReport(rows) {
		if (!rows || rows.length === 0) {
			return { inserted: 0, message: 'No data to import' };
		}
		let inserted = 0;
		for (const row of rows) {
			const name = String(row.name || '').trim();
			const discountApplied = parseFloat(row.discount_applied) || 0;
			const pointDiscountAmount = parseFloat(row.point_discount_amount) || 0;
			if (!name) continue;
			await pool.execute(
				`INSERT INTO discount_report (name, discount_applied, point_discount_amount) VALUES (?, ?, ?)`,
				[name, discountApplied, pointDiscountAmount]
			);
			inserted++;
		}
		return { inserted };
	}

	// Get sales by category report based on live orders only
	// Columns: category, sales_quantity, total_sales, refund_quantity, refund_amount, discounts, net_sales
	// Accepts start_date, end_date, branch_id for future extension when view has those columns
	// FIX: When date range is provided, only use actual orders to avoid double-counting synced orders
	static async getSalesCategoryReport(startDate = null, endDate = null, branchId = null) {
		const params = [];
		const orderParams = [];
		let orderDateFilter = '';
		let orderBranchFilter = '';

		if (startDate && endDate) {
			orderDateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
			orderParams.push(startDate, endDate);
		}

		if (branchId) {
			orderBranchFilter = 'AND o.BRANCH_ID = ?';
			orderParams.push(branchId);
		}

		// Get data from actual orders (paid orders only)
		// This is the source of truth for orders within the date range
		const ordersQuery = `
			SELECT 
				COALESCE(c.CAT_NAME, 'Uncategorized') as category,
				COALESCE(SUM(oi.QTY), 0) as sales_quantity,
				COALESCE(SUM(oi.LINE_TOTAL), 0) as total_sales,
				0 as refund_quantity,
				0 as refund_amount,
				COALESCE(SUM(
					CASE 
						WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
						ELSE 0
					END
				), 0) as discounts,
				COALESCE(SUM(
					oi.LINE_TOTAL - CASE 
						WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
						ELSE 0
					END
				), 0) as net_sales
			FROM orders o
			INNER JOIN billing b ON b.ORDER_ID = o.IDNo
			INNER JOIN order_items oi ON oi.ORDER_ID = o.IDNo
			INNER JOIN menu m ON m.IDNo = oi.MENU_ID
			LEFT JOIN categories c ON c.IDNo = m.CATEGORY_ID
			WHERE b.STATUS = 1
			${orderDateFilter}
			${orderBranchFilter}
			GROUP BY COALESCE(c.CAT_NAME, 'Uncategorized')
		`;
		const [orderRows] = await pool.execute(ordersQuery, orderParams);

		const dataMap = new Map();

		// Add/merge actual orders data
		orderRows.forEach(row => {
			const category = row.category || 'Uncategorized';
			if (!dataMap.has(category)) {
				dataMap.set(category, {
					category: category,
					sales_quantity: 0,
					total_sales: 0,
					refund_quantity: 0,
					refund_amount: 0,
					discounts: 0,
					net_sales: 0
				});
			}
			const data = dataMap.get(category);
			data.sales_quantity += parseInt(row.sales_quantity) || 0;
			data.total_sales += parseFloat(row.total_sales) || 0;
			data.refund_quantity += parseInt(row.refund_quantity) || 0;
			data.refund_amount += parseFloat(row.refund_amount) || 0;
			data.discounts += parseFloat(row.discounts) || 0;
			data.net_sales += parseFloat(row.net_sales) || 0;
		});

		// Convert map to array and sort by category
		const result = Array.from(dataMap.values()).sort((a, b) => {
			return a.category.localeCompare(b.category);
		});

		return result;
	}

	// Import sales category data
	// NO-OP: sales_category_report table has been removed from the database.
	static async importSalesCategoryReport(rows) {
		return {
			inserted: 0,
			message: 'sales_category_report table has been removed; importSalesCategoryReport is disabled.',
		};
	}

	// Get goods sales report based on live orders only
	// Columns: id, goods, category, sales_quantity, discounts, net_sales, unit_cost, total_revenue, created_at, updated_at
	// Joins with categories table to get category name instead of ID
	// Note: Category IDs from old system (10009, 10004, etc.) don't match new system IDs (21-44)
	// So we match by looking up menu items to find their categories
	static async getGoodsSalesReport(startDate = null, endDate = null, branchId = null) {
		try {
			const orderParams = [];
			let orderDateFilter = '';
			let orderBranchFilter = '';

			if (startDate && endDate) {
				orderDateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
				orderParams.push(startDate, endDate);
			}

			if (branchId) {
				orderBranchFilter = 'AND o.BRANCH_ID = ?';
				orderParams.push(branchId);
			}

			// Legacy product_sales_summary table has been removed; rely only on actual orders.
			const summaryRows = [];

			// Get data from actual orders (paid orders only)
			const ordersQuery = `
				SELECT 
					m.MENU_NAME as goods,
					COALESCE(c.CAT_NAME, 'Uncategorized') as category,
					COALESCE(SUM(oi.QTY), 0) as sales_quantity,
					COALESCE(SUM(oi.LINE_TOTAL), 0) as total_sales,
					0 as refund_quantity,
					0 as refund_amount,
					COALESCE(SUM(
						CASE 
							WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
							ELSE 0
						END
					), 0) as discounts,
					COALESCE(SUM(
						oi.LINE_TOTAL - CASE 
							WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
							ELSE 0
						END
					), 0) as net_sales,
					0 as unit_cost,
					COALESCE(SUM(
						oi.LINE_TOTAL - CASE 
							WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
							ELSE 0
						END
					), 0) as total_revenue
				FROM orders o
				INNER JOIN billing b ON b.ORDER_ID = o.IDNo
				INNER JOIN order_items oi ON oi.ORDER_ID = o.IDNo
				INNER JOIN menu m ON m.IDNo = oi.MENU_ID
				LEFT JOIN categories c ON c.IDNo = m.CATEGORY_ID
				WHERE b.STATUS = 1
				${orderDateFilter}
				${orderBranchFilter}
				GROUP BY m.MENU_NAME, COALESCE(c.CAT_NAME, 'Uncategorized')
			`;
			const [orderRows] = await pool.execute(ordersQuery, orderParams);

			// Combine data: merge summary data with actual orders data
			const dataMap = new Map();

			// Add summary data
			summaryRows.forEach(row => {
				const goods = (row.goods || '').trim();
				if (!goods) return;
				if (!dataMap.has(goods)) {
					dataMap.set(goods, {
						id: row.id || null,
						goods: goods,
						category: row.category || 'Uncategorized',
						sales_quantity: 0,
						total_sales: 0,
						refund_quantity: 0,
						refund_amount: 0,
						discounts: 0,
						net_sales: 0,
						unit_cost: 0,
						total_revenue: 0,
						created_at: row.created_at || null
					});
				}
				const data = dataMap.get(goods);
				data.sales_quantity += parseInt(row.sales_quantity) || 0;
				data.total_sales += parseFloat(row.total_sales) || 0;
				data.refund_quantity += parseInt(row.refund_quantity) || 0;
				data.refund_amount += parseFloat(row.refund_amount) || 0;
				data.discounts += parseFloat(row.discounts) || 0;
				data.net_sales += parseFloat(row.net_sales) || 0;
				data.unit_cost += parseFloat(row.unit_cost) || 0;
				data.total_revenue += parseFloat(row.total_revenue) || 0;
			});

			// Add/merge actual orders data
			orderRows.forEach(row => {
				const goods = (row.goods || '').trim();
				if (!goods) return;
				if (!dataMap.has(goods)) {
					dataMap.set(goods, {
						id: null,
						goods: goods,
						category: row.category || 'Uncategorized',
						sales_quantity: 0,
						total_sales: 0,
						refund_quantity: 0,
						refund_amount: 0,
						discounts: 0,
						net_sales: 0,
						unit_cost: 0,
						total_revenue: 0,
						created_at: null
					});
				}
				const data = dataMap.get(goods);
				data.sales_quantity += parseInt(row.sales_quantity) || 0;
				data.total_sales += parseFloat(row.total_sales) || 0;
				data.refund_quantity += parseInt(row.refund_quantity) || 0;
				data.refund_amount += parseFloat(row.refund_amount) || 0;
				data.discounts += parseFloat(row.discounts) || 0;
				data.net_sales += parseFloat(row.net_sales) || 0;
				data.unit_cost += parseFloat(row.unit_cost) || 0;
				data.total_revenue += parseFloat(row.total_revenue) || 0;
			});

			// Convert map to array
			const allRows = Array.from(dataMap.values());

			const [menuItems] = await pool.execute(`
				SELECT m.MENU_NAME, c.CAT_NAME
				FROM menu m
				LEFT JOIN categories c ON c.IDNo = m.CATEGORY_ID
				WHERE m.ACTIVE = 1 AND c.CAT_NAME IS NOT NULL
			`);

			const goodsToCategoryMap = new Map();
			menuItems.forEach(item => {
				if (item.MENU_NAME && item.CAT_NAME) {
					const normalizedMenuName = item.MENU_NAME.trim().toLowerCase();
					const normalizedCategoryName = item.CAT_NAME.trim().replace(/\s+/g, ' ');
					goodsToCategoryMap.set(normalizedMenuName, normalizedCategoryName);
					goodsToCategoryMap.set(item.MENU_NAME.trim(), normalizedCategoryName);
				}
			});

			const [categories] = await pool.execute(`
				SELECT IDNo, CAT_NAME FROM categories WHERE ACTIVE = 1
			`);
			const categoryIdMap = new Map();
			categories.forEach(cat => {
				categoryIdMap.set(cat.IDNo.toString(), cat.CAT_NAME);
			});

			const mappedRows = allRows.map(row => {
				let categoryName = row.category;
				const goodsName = (row.goods || '').trim();

				if (categoryName && /^[0-9]+$/.test(categoryName.trim())) {
					if (goodsName && goodsToCategoryMap.has(goodsName)) {
						categoryName = goodsToCategoryMap.get(goodsName);
					} else if (goodsName) {
						const normalizedGoodsName = goodsName.toLowerCase();
						if (goodsToCategoryMap.has(normalizedGoodsName)) {
							categoryName = goodsToCategoryMap.get(normalizedGoodsName);
						} else {
							for (const [menuName, catName] of goodsToCategoryMap.entries()) {
								if (normalizedGoodsName.includes(menuName.toLowerCase()) ||
									menuName.toLowerCase().includes(normalizedGoodsName)) {
									categoryName = catName;
									break;
								}
							}
						}
					}
					if (/^[0-9]+$/.test(categoryName.trim()) && categoryIdMap.has(categoryName.trim())) {
						categoryName = categoryIdMap.get(categoryName.trim());
					}
				} else if (categoryName && !/^[0-9]+$/.test(categoryName.trim())) {
					categoryName = categoryName.trim().replace(/\s+/g, ' ');
					categoryName = categoryName.replace(/\s*-\s+/g, '-').replace(/\s+-\s*/g, '-');
				}

				return {
					...row,
					category: categoryName || 'Uncategorized'
				};
			});

			return mappedRows;
		} catch (error) {
			console.error('Error in getGoodsSalesReport:', error);
			throw error;
		}
	}

	// Import goods sales data (insert into goods_sales_report table)
	// Expects array of { goods, category, sales_quantity, discounts, net_sales, unit_cost, total_revenue }
	// Converts category IDs to category names during import
	static async importGoodsSalesReport(rows) {
		if (!rows || rows.length === 0) {
			return { inserted: 0, message: 'No data to import' };
		}
		let inserted = 0;

		// Cache for category ID to name mapping
		const categoryCache = new Map();

		// Get all menu items for goods-to-category mapping
		const [menuItems] = await pool.execute(`
			SELECT m.MENU_NAME, c.CAT_NAME
			FROM menu m
			LEFT JOIN categories c ON c.IDNo = m.CATEGORY_ID
			WHERE m.ACTIVE = 1 AND c.CAT_NAME IS NOT NULL
		`);

		// Create mapping: goods name -> category name (normalized)
		const goodsToCategoryMap = new Map();
		menuItems.forEach(item => {
			if (item.MENU_NAME && item.CAT_NAME) {
				const normalizedMenuName = item.MENU_NAME.trim().toLowerCase();
				const normalizedCategoryName = item.CAT_NAME.trim().replace(/\s+/g, ' ');
				goodsToCategoryMap.set(normalizedMenuName, normalizedCategoryName);
				goodsToCategoryMap.set(item.MENU_NAME.trim(), normalizedCategoryName);
			}
		});

		for (const row of rows) {
			const goods = String(row.goods || row.product_name || '').trim();
			if (!goods) continue;
			let category = String(row.category || '').trim();

			// If category is empty, try to find it from goods name
			if (!category) {
				// First try: Exact match by goods name (case-sensitive)
				if (goodsToCategoryMap.has(goods)) {
					category = goodsToCategoryMap.get(goods);
				}
				// Second try: Case-insensitive match
				else {
					const normalizedGoodsName = goods.toLowerCase();
					if (goodsToCategoryMap.has(normalizedGoodsName)) {
						category = goodsToCategoryMap.get(normalizedGoodsName);
					}
					// Third try: Partial match (goods name contains menu name or vice versa)
					else {
						for (const [menuName, catName] of goodsToCategoryMap.entries()) {
							if (normalizedGoodsName.includes(menuName.toLowerCase()) ||
								menuName.toLowerCase().includes(normalizedGoodsName)) {
								category = catName;
								break;
							}
						}
					}
				}
			}

			// If category is numeric (ID), convert to category name
			if (category && /^[0-9]+$/.test(category)) {
				const categoryId = parseInt(category, 10);
				if (categoryCache.has(categoryId)) {
					category = categoryCache.get(categoryId);
				} else {
					try {
						const [categoryRows] = await pool.execute(
							`SELECT CAT_NAME FROM categories WHERE IDNo = ? LIMIT 1`,
							[categoryId]
						);
						if (categoryRows && categoryRows.length > 0 && categoryRows[0].CAT_NAME) {
							category = categoryRows[0].CAT_NAME.trim().replace(/\s+/g, ' ');
							categoryCache.set(categoryId, category);
						}
					} catch (err) {
						console.error(`Error looking up category ID ${categoryId}:`, err);
					}
				}
			}
			// If category is already a name, normalize it
			else if (category) {
				category = category.trim().replace(/\s+/g, ' ').replace(/\s*-\s+/g, '-').replace(/\s+-\s*/g, '-');
			}

			const salesQuantity = parseInt(row.sales_quantity || row.quantity || 0, 10) || 0;
			const totalSales = parseFloat(row.total_sales || 0) || 0;
			const refundQuantity = parseInt(row.refund_quantity || 0, 10) || 0;
			const refundAmount = parseFloat(row.refund_amount || 0) || 0;
			const discounts = parseFloat(row.discounts || 0) || 0;
			const netSales = parseFloat(row.net_sales || 0) || 0;
			const unitCost = parseFloat(row.unit_cost || 0) || 0;
			const totalRevenue = parseFloat(row.total_revenue || 0) || 0;

			// Default category if still empty
			if (!category) {
				category = 'Uncategorized';
			}

			try {
				// Check if record exists
				const [existing] = await pool.execute(
					`SELECT id FROM product_sales_summary WHERE product_name = ? LIMIT 1`,
					[goods]
				);

				if (existing && existing.length > 0) {
					// Update existing record
					const [updateResult] = await pool.execute(
						`UPDATE product_sales_summary SET 
						 category = ?,
						 sales_quantity = ?,
						 total_sales = ?,
						 refund_quantity = ?,
						 refund_amount = ?,
						 discounts = ?,
						 net_sales = ?,
						 unit_cost = ?,
						 total_revenue = ?
						 WHERE product_name = ?`,
						[category, salesQuantity, totalSales, refundQuantity, refundAmount, discounts, netSales, unitCost, totalRevenue, goods]
					);
				} else {
					await pool.execute(
						`INSERT INTO product_sales_summary (product_name, category, sales_quantity, total_sales, refund_quantity, refund_amount, discounts, net_sales, unit_cost, total_revenue) 
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[goods, category, salesQuantity, totalSales, refundQuantity, refundAmount, discounts, netSales, unitCost, totalRevenue]
					);
				}
				inserted++;
			} catch (err) {
				console.error(`Error inserting/updating goods sales record for "${goods}":`, err);
			}
		}
		return { inserted };
	}

	// Validate imported data - check if totals tally across different tables
	// This helps ensure imported data from previous system is consistent
	static async validateImportedData(branchId = null, startDate = null, endDate = null) {
		try {
			const results = {
				sales_hourly_summary: {
					total_sales: 0,
					total_refund: 0,
					total_discount: 0,
					total_net_sales: 0,
					total_gross_profit: 0,
					record_count: 0
				},
				sales_category_report: {
					total_revenue: 0,
					total_net_sales: 0,
					total_quantity: 0,
					record_count: 0
				},
				product_sales_summary: {
					total_revenue: 0,
					total_net_sales: 0,
					total_discounts: 0,
					total_quantity: 0,
					record_count: 0
				},
				discount_report: {
					total_discount: 0,
					record_count: 0
				},
				refund_report: {
					total_refund: 0,
					record_count: 0
				},
				validation: {
					sales_match: false,
					discounts_match: false,
					net_sales_match: false,
					refunds_match: false,
					warnings: []
				}
			};

			// Build date filter
			let dateFilter = '';
			const params = [];
			if (startDate && endDate) {
				dateFilter = 'AND DATE(sale_datetime) >= ? AND DATE(sale_datetime) <= ?';
				params.push(startDate, endDate);
			}

			// Legacy summary table sales_hourly_summary has been removed.
			// For validation, we now base hourly totals purely on live orders + receipts.
			const hourlyRows = [{
				record_count: 0,
				total_sales: 0,
				total_refund: 0,
				total_discount: 0,
				total_net_sales: 0,
				total_gross_profit: 0,
			}];

			// Also get totals from actual orders (paid orders only) to add to summary
			const orderParamsForHourly = [];
			let orderDateFilterForHourly = '';
			let orderBranchFilterForHourly = '';
			if (startDate && endDate) {
				orderDateFilterForHourly = 'AND DATE(o.ENCODED_DT) >= ? AND DATE(o.ENCODED_DT) <= ?';
				orderParamsForHourly.push(startDate, endDate);
			}
			if (branchId) {
				orderBranchFilterForHourly = 'AND o.BRANCH_ID = ?';
				orderParamsForHourly.push(branchId);
			}

			const [orderHourlyRows] = await pool.execute(`
				SELECT 
					COALESCE(SUM(o.GRAND_TOTAL), 0) as total_sales,
					0 as total_refund,
					COALESCE(SUM(o.DISCOUNT_AMOUNT), 0) as total_discount,
					COALESCE(SUM(o.GRAND_TOTAL - COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) as total_net_sales,
					COALESCE(SUM(o.GRAND_TOTAL - COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) as total_gross_profit
				FROM orders o
				INNER JOIN billing b ON b.ORDER_ID = o.IDNo
				WHERE b.STATUS = 1
				${orderDateFilterForHourly}
				${orderBranchFilterForHourly}
			`, orderParamsForHourly);

			// Combine summary table data with actual orders data
			const summaryTotalSales = parseFloat(hourlyRows[0]?.total_sales || 0);
			const summaryTotalRefund = parseFloat(hourlyRows[0]?.total_refund || 0);
			const summaryTotalDiscount = parseFloat(hourlyRows[0]?.total_discount || 0);
			const summaryTotalNetSales = parseFloat(hourlyRows[0]?.total_net_sales || 0);
			const summaryTotalGrossProfit = parseFloat(hourlyRows[0]?.total_gross_profit || 0);

			const ordersTotalSales = parseFloat(orderHourlyRows[0]?.total_sales || 0);
			const ordersTotalDiscount = parseFloat(orderHourlyRows[0]?.total_discount || 0);
			const ordersTotalNetSales = parseFloat(orderHourlyRows[0]?.total_net_sales || 0);
			const ordersTotalGrossProfit = parseFloat(orderHourlyRows[0]?.total_gross_profit || 0);

			// Get refunds from receipts table (transaction_type = 2)
			const refundParamsForValidation = [];
			let refundDateFilterForValidation = '';
			if (startDate && endDate) {
				refundDateFilterForValidation = 'AND DATE(receipt_date) >= ? AND DATE(receipt_date) <= ?';
				refundParamsForValidation.push(startDate, endDate);
			}

			const [refundValidationRows] = await pool.execute(`
				SELECT 
					COALESCE(SUM(total_amount), 0) as total_refund_from_receipts
				FROM receipts
				WHERE transaction_type = 2
				${refundDateFilterForValidation}
			`, refundParamsForValidation);
			const totalRefundFromReceipts = parseFloat(refundValidationRows[0]?.total_refund_from_receipts || 0);

			// Merge: use the higher value (since summary might already include some orders)
			// Or sum them if they're from different time periods
			// For refunds, combine summary refunds with receipts refunds
			results.sales_hourly_summary = {
				total_sales: Math.max(summaryTotalSales, ordersTotalSales),
				total_refund: summaryTotalRefund + totalRefundFromReceipts, // Combine summary refunds with receipts refunds
				total_discount: Math.max(summaryTotalDiscount, ordersTotalDiscount),
				total_net_sales: Math.max(summaryTotalNetSales, ordersTotalNetSales) - totalRefundFromReceipts, // Subtract refunds from net sales
				total_gross_profit: Math.max(summaryTotalGrossProfit, ordersTotalGrossProfit) - totalRefundFromReceipts, // Subtract refunds from gross profit
				record_count: parseInt(hourlyRows[0]?.record_count || 0)
			};

			// Legacy summary table sales_category_report has been removed.
			// Keep validation shape but use zeros.
			const categoryRows = [{
				record_count: 0,
				total_sales: 0,
				total_refund: 0,
				total_net_sales: 0,
				total_quantity: 0,
			}];
			const categorySummaryRefund = 0;

			// Add refunds from receipts table (same as hourly summary)
			const categoryTotalRefund = categorySummaryRefund + totalRefundFromReceipts;

			if (categoryRows && categoryRows.length > 0) {
				results.sales_category_report = {
					total_revenue: parseFloat(categoryRows[0].total_sales || 0), // Use total_sales as total_revenue for compatibility
					total_refund: categoryTotalRefund,
					total_net_sales: parseFloat(categoryRows[0].total_net_sales || 0),
					total_quantity: parseInt(categoryRows[0].total_quantity || 0),
					record_count: parseInt(categoryRows[0].record_count || 0)
				};
			}

			// Legacy summary table product_sales_summary has been removed.
			// Keep validation shape but use zeros.
			const goodsRows = [{
				record_count: 0,
				total_sales: 0,
				total_revenue: 0,
				total_refund: 0,
				total_net_sales: 0,
				total_discounts: 0,
				total_quantity: 0,
			}];
			const goodsSummaryRefund = 0;

			// Add refunds from receipts table (same as hourly summary)
			const goodsTotalRefund = goodsSummaryRefund + totalRefundFromReceipts;

			// Also get totals from actual orders (paid orders only) for goods/products
			const orderParamsForGoods = [];
			let orderDateFilterForGoods = '';
			let orderBranchFilterForGoods = '';
			if (startDate && endDate) {
				orderDateFilterForGoods = 'AND DATE(o.ENCODED_DT) >= ? AND DATE(o.ENCODED_DT) <= ?';
				orderParamsForGoods.push(startDate, endDate);
			}
			if (branchId) {
				orderBranchFilterForGoods = 'AND o.BRANCH_ID = ?';
				orderParamsForGoods.push(branchId);
			}

			const [orderGoodsRows] = await pool.execute(`
				SELECT 
					COALESCE(SUM(oi.LINE_TOTAL), 0) as total_sales,
					COALESCE(SUM(
						oi.LINE_TOTAL - CASE 
							WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
							ELSE 0
						END
					), 0) as total_net_sales,
					COALESCE(SUM(
						CASE 
							WHEN o.SUBTOTAL > 0 THEN (oi.LINE_TOTAL * o.DISCOUNT_AMOUNT / o.SUBTOTAL)
							ELSE 0
						END
					), 0) as total_discounts,
					COALESCE(SUM(oi.QTY), 0) as total_quantity
				FROM orders o
				INNER JOIN billing b ON b.ORDER_ID = o.IDNo
				INNER JOIN order_items oi ON oi.ORDER_ID = o.IDNo
				WHERE b.STATUS = 1
				${orderDateFilterForGoods}
				${orderBranchFilterForGoods}
			`, orderParamsForGoods);

			// Combine summary table data with actual orders data
			const goodsSummaryTotalSales = parseFloat(goodsRows[0]?.total_sales || 0);
			const goodsSummaryTotalNetSales = parseFloat(goodsRows[0]?.total_net_sales || 0);
			const goodsSummaryTotalDiscounts = parseFloat(goodsRows[0]?.total_discounts || 0);
			const goodsSummaryTotalQuantity = parseInt(goodsRows[0]?.total_quantity || 0);

			const goodsOrdersTotalSales = parseFloat(orderGoodsRows[0]?.total_sales || 0);
			const goodsOrdersTotalNetSales = parseFloat(orderGoodsRows[0]?.total_net_sales || 0);
			const goodsOrdersTotalDiscounts = parseFloat(orderGoodsRows[0]?.total_discounts || 0);
			const goodsOrdersTotalQuantity = parseInt(orderGoodsRows[0]?.total_quantity || 0);

			if (goodsRows && goodsRows.length > 0) {
				results.product_sales_summary = {
					total_revenue: Math.max(goodsSummaryTotalSales, goodsOrdersTotalSales), // Use total_sales for comparison with hourly and category
					total_refund: goodsTotalRefund,
					total_net_sales: Math.max(goodsSummaryTotalNetSales, goodsOrdersTotalNetSales),
					total_discounts: Math.max(goodsSummaryTotalDiscounts, goodsOrdersTotalDiscounts),
					total_quantity: Math.max(goodsSummaryTotalQuantity, goodsOrdersTotalQuantity),
					record_count: parseInt(goodsRows[0].record_count || 0)
				};
			}

			// Get totals from discount_report (use point_discount_amount, not discount_applied)
			const [discountRows] = await pool.execute(`
				SELECT 
					COUNT(*) as record_count,
					COALESCE(SUM(point_discount_amount), 0) as total_discount
				FROM discount_report
			`);
			if (discountRows && discountRows.length > 0) {
				results.discount_report = {
					total_discount: parseFloat(discountRows[0].total_discount || 0),
					record_count: parseInt(discountRows[0].record_count || 0)
				};
			}

			// Get totals from receipts table for refund report (transaction_type = 2)
			// Use the same totalRefundFromReceipts that's already calculated for sales_hourly_summary
			// This ensures consistency - both use the same receipts refunds
			// We already have totalRefundFromReceipts calculated above, so use it
			// Also get count from the same query
			const [refundReportCountRows] = await pool.execute(`
				SELECT COUNT(*) as record_count
				FROM receipts
				WHERE transaction_type = 2
				${refundDateFilterForValidation}
			`, refundParamsForValidation);
			const receiptsRefundCount = parseInt(refundReportCountRows[0]?.record_count || 0);
			const receiptsRefundAmount = totalRefundFromReceipts; // Use the same value as sales_hourly_summary

			// Get refund count from sales_hourly_summary (only records with refund > 0 for count)
			const summaryRefundParams = [];
			let summaryRefundBranchFilter = '';
			if (branchId) {
				summaryRefundBranchFilter = ' AND (branch_id = ? OR branch_id IS NULL)';
				summaryRefundParams.push(branchId);
			}

			let summaryRefundCount = 0;
			try {
				const [summaryRefundCountRows] = await pool.execute(`
					SELECT COUNT(*) as record_count
					FROM sales_hourly_summary
					WHERE 1=1 ${summaryRefundBranchFilter} AND (refund > 0 OR refund IS NOT NULL)
				`, summaryRefundParams);
				summaryRefundCount = parseInt(summaryRefundCountRows[0]?.record_count || 0);
			} catch (e) {
				// Legacy summary table sales_hourly_summary has been removed
				summaryRefundCount = 0;
			}

			// Use the same summaryTotalRefund to ensure refund_report matches sales_hourly_summary
			const summaryRefundAmount = summaryTotalRefund;
			const finalReceiptsRefund = totalRefundFromReceipts > 0 ? totalRefundFromReceipts : receiptsRefundAmount;
			const totalRefundReportAmount = finalReceiptsRefund + summaryRefundAmount;
			const totalRefundReportCount = receiptsRefundCount + summaryRefundCount;

			results.refund_report = {
				total_refund: totalRefundReportAmount,
				record_count: totalRefundReportCount
			};

			// Also get total discount from actual orders (paid orders only) to ensure accuracy
			const orderParams = [];
			let orderDateFilter = '';
			let orderBranchFilter = '';
			if (startDate && endDate) {
				orderDateFilter = 'AND DATE(o.ENCODED_DT) >= ? AND DATE(o.ENCODED_DT) <= ?';
				orderParams.push(startDate, endDate);
			}
			if (branchId) {
				orderBranchFilter = 'AND o.BRANCH_ID = ?';
				orderParams.push(branchId);
			}

			const [orderDiscountRows] = await pool.execute(`
				SELECT 
					COALESCE(SUM(o.DISCOUNT_AMOUNT), 0) as total_discount_from_orders
				FROM orders o
				INNER JOIN billing b ON b.ORDER_ID = o.IDNo
				WHERE b.STATUS = 1 AND o.DISCOUNT_AMOUNT > 0
				${orderDateFilter}
				${orderBranchFilter}
			`, orderParams);
			const totalDiscountFromOrders = parseFloat(orderDiscountRows[0]?.total_discount_from_orders || 0);

			// Validate totals
			const tolerance = 0.01; // Allow small rounding differences
			const hourlyTotalSales = results.sales_hourly_summary.total_sales;
			const categoryTotalRevenue = results.sales_category_report.total_revenue;
			const goodsTotalRevenue = results.product_sales_summary.total_revenue;

			// Check if sales totals match (within tolerance)
			const salesDiff1 = Math.abs(hourlyTotalSales - categoryTotalRevenue);
			const salesDiff2 = Math.abs(hourlyTotalSales - goodsTotalRevenue);
			const salesDiff3 = Math.abs(categoryTotalRevenue - goodsTotalRevenue);

			results.validation.sales_match = salesDiff1 <= tolerance && salesDiff2 <= tolerance && salesDiff3 <= tolerance;

			// Check if discounts match
			// Note: Since we now fetch discounts from actual orders in getSalesHourlySummary and getGoodsSalesReport,
			// the totals should include actual orders. We'll compare:
			// 1. hourlyDiscount (from sales_hourly_summary + actual orders)
			// 2. goodsDiscount (from product_sales_summary + actual orders)
			// 3. discountReportDiscount (from discount_report table + actual orders via getDiscountReport)
			// 4. totalDiscountFromOrders (direct from orders table for validation)
			const hourlyDiscount = results.sales_hourly_summary.total_discount;
			const goodsDiscount = results.product_sales_summary.total_discounts;
			const discountReportDiscount = results.discount_report.total_discount;

			// Calculate expected total: discount_report + actual orders (if not already included)
			// Since getDiscountReport now includes actual orders, discountReportDiscount should match totalDiscountFromOrders
			// But we'll validate against all sources
			const discountDiff1 = Math.abs(hourlyDiscount - goodsDiscount);
			const discountDiff2 = Math.abs(hourlyDiscount - discountReportDiscount);
			const discountDiff3 = Math.abs(goodsDiscount - discountReportDiscount);

			// Also check against actual orders total if available
			let discountDiff4 = 0;
			if (totalDiscountFromOrders > 0) {
				// Compare each source with actual orders
				discountDiff4 = Math.abs(hourlyDiscount - totalDiscountFromOrders);
				// If hourly/goods already include orders, they should match
				// If discount_report doesn't include orders yet, we'll allow some difference
			}

			// Discounts match if all sources are within tolerance
			// Allow discount_report to be slightly different if it doesn't include actual orders yet
			const discountReportTolerance = totalDiscountFromOrders > 0 ? Math.max(tolerance, Math.abs(discountReportDiscount - totalDiscountFromOrders) * 0.1) : tolerance;

			results.validation.discounts_match =
				discountDiff1 <= tolerance &&
				discountDiff2 <= discountReportTolerance &&
				discountDiff3 <= discountReportTolerance &&
				(totalDiscountFromOrders === 0 || discountDiff4 <= tolerance);

			// Check if net sales match
			const hourlyNetSales = results.sales_hourly_summary.total_net_sales;
			const categoryNetSales = results.sales_category_report.total_net_sales;
			const goodsNetSales = results.product_sales_summary.total_net_sales;
			const netSalesDiff1 = Math.abs(hourlyNetSales - categoryNetSales);
			const netSalesDiff2 = Math.abs(hourlyNetSales - goodsNetSales);

			results.validation.net_sales_match = netSalesDiff1 <= tolerance && netSalesDiff2 <= tolerance;

			// Check if refunds match across all tables
			// Compare refunds from:
			// 1. sales_hourly_summary (summaryTotalRefund + totalRefundFromReceipts)
			// 2. sales_category_report (summary refunds + receipts refunds)
			// 3. product_sales_summary (summary refunds + receipts refunds)
			// 4. Expected total: summary refunds + receipts refunds
			const hourlyRefund = results.sales_hourly_summary.total_refund;
			const categoryRefund = results.sales_category_report.total_refund || 0;
			const goodsRefund = results.product_sales_summary.total_refund || 0;
			const summaryRefundOnly = summaryTotalRefund;
			const receiptsRefundOnly = totalRefundFromReceipts;

			// Expected total: summary refunds + receipts refunds
			const expectedRefundTotal = summaryRefundOnly + receiptsRefundOnly;

			// Check if all refund totals match expected total
			const refundDiff1 = Math.abs(hourlyRefund - expectedRefundTotal);
			const refundDiff2 = Math.abs(categoryRefund - expectedRefundTotal);
			const refundDiff3 = Math.abs(goodsRefund - expectedRefundTotal);

			// Refunds match if all tables match expected total (summary + receipts)
			results.validation.refunds_match = refundDiff1 <= tolerance && refundDiff2 <= tolerance && refundDiff3 <= tolerance;

			// Add warnings for mismatches
			if (!results.validation.sales_match) {
				results.validation.warnings.push(
					`Sales totals don't match: Hourly=${hourlyTotalSales.toFixed(2)}, Category=${categoryTotalRevenue.toFixed(2)}, Goods=${goodsTotalRevenue.toFixed(2)}`
				);
			}
			if (!results.validation.discounts_match) {
				let discountWarning = `Discounts don't match: Hourly=${hourlyDiscount.toFixed(2)}, Goods=${goodsDiscount.toFixed(2)}, Discount Report=${discountReportDiscount.toFixed(2)}`;
				if (totalDiscountFromOrders > 0) {
					discountWarning += `, Actual Orders=${totalDiscountFromOrders.toFixed(2)}`;
				}
				results.validation.warnings.push(discountWarning);
			}
			if (!results.validation.net_sales_match) {
				results.validation.warnings.push(
					`Net sales don't match: Hourly=${hourlyNetSales.toFixed(2)}, Category=${categoryNetSales.toFixed(2)}, Goods=${goodsNetSales.toFixed(2)}`
				);
			}
			if (!results.validation.refunds_match) {
				let refundWarning = `Refunds don't match: Hourly=${hourlyRefund.toFixed(2)}, Category=${categoryRefund.toFixed(2)}, Goods=${goodsRefund.toFixed(2)}, Expected (Summary + Receipts)=${expectedRefundTotal.toFixed(2)}`;
				if (summaryRefundOnly > 0 || receiptsRefundOnly > 0) {
					refundWarning += `, Summary=${summaryRefundOnly.toFixed(2)}, Receipts=${receiptsRefundOnly.toFixed(2)}`;
				}
				results.validation.warnings.push(refundWarning);
			}

			return results;
		} catch (error) {
			console.error('Error validating imported data:', error);
			throw error;
		}
	}

	// Get total sales per branch
	// Aggregates from billing table + sales_hourly_summary
	static async getSalesPerBranch(startDate = null, endDate = null, branchId = null) {
		let dateFilterBilling = '';
		let dateFilterSummary = '';
		let branchFilterBilling = '';
		let branchFilterSummary = '';
		const billingParams = [];
		const summaryParams = [];

		if (startDate && endDate) {
			dateFilterBilling = 'AND DATE(b.ENCODED_DT) >= ? AND DATE(b.ENCODED_DT) <= ?';
			billingParams.push(startDate, endDate);
			dateFilterSummary = 'AND DATE(s.sale_datetime) >= ? AND DATE(s.sale_datetime) <= ?';
			summaryParams.push(startDate, endDate);
		}

		if (branchId) {
			branchFilterBilling = 'AND br.IDNo = ?';
			billingParams.push(branchId);
			branchFilterSummary = 'AND s.branch_id = ?';
			summaryParams.push(branchId);
		}

		// Get gross sales from billing + orders (Loyverse-aligned: paid + discount)
		const billingQuery = `
			SELECT 
				br.IDNo as branch_id,
				br.BRANCH_NAME as branch_name,
				br.BRANCH_CODE as branch_code,
				COALESCE(SUM(b.AMOUNT_PAID + COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) as total_sales,
				COUNT(DISTINCT b.ORDER_ID) as order_count,
				CASE 
					WHEN COUNT(DISTINCT b.ORDER_ID) > 0 THEN COALESCE(SUM(b.AMOUNT_PAID + COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) / COUNT(DISTINCT b.ORDER_ID)
					ELSE 0
				END as avg_order_value
			FROM branches br
			LEFT JOIN billing b ON b.BRANCH_ID = br.IDNo AND b.STATUS IN (1, 2) ${dateFilterBilling}
			LEFT JOIN orders o ON o.IDNo = b.ORDER_ID AND o.STATUS NOT IN (-1, -2)
			WHERE br.ACTIVE = 1 ${branchFilterBilling}
			GROUP BY br.IDNo, br.BRANCH_NAME, br.BRANCH_CODE
			ORDER BY total_sales DESC
		`;

		const [billingRows] = await pool.execute(billingQuery, billingParams);

		// Get sales from sales_hourly_summary grouped by branch (if table exists).
		// If the table has been removed from the database, we gracefully fall back
		// to using only billing data so that reports continue to work.
		const summaryQuery = `
			SELECT 
				s.branch_id,
				COALESCE(SUM(s.total_sales), 0) as total_sales
			FROM sales_hourly_summary s
			WHERE s.branch_id IS NOT NULL
			${dateFilterSummary}
			${branchFilterSummary}
			GROUP BY s.branch_id
		`;

		let summaryRows = [];
		try {
			const [rows] = await pool.execute(summaryQuery, summaryParams);
			summaryRows = rows;
		} catch (error) {
			// ER_NO_SUCH_TABLE (1146) => sales_hourly_summary was dropped
			if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146)) {
				console.warn('[ReportsModel.getSalesPerBranch] sales_hourly_summary table missing, using billing-only data');
				summaryRows = [];
			} else {
				throw error;
			}
		}

		// Merge summary data into billing rows (if any summary rows were found)
		const summaryMap = new Map();
		summaryRows.forEach(row => {
			summaryMap.set(parseInt(row.branch_id), parseFloat(row.total_sales) || 0);
		});

		const result = billingRows.map(row => {
			const summaryTotal = summaryMap.get(parseInt(row.branch_id)) || 0;
			return {
				branch_id: row.branch_id,
				branch_name: row.branch_name,
				branch_code: row.branch_code,
				total_sales: parseFloat(row.total_sales) + summaryTotal,
				order_count: parseInt(row.order_count) || 0,
				avg_order_value: parseFloat(row.avg_order_value) || 0
			};
		});

		// Re-sort after merging
		result.sort((a, b) => b.total_sales - a.total_sales);

		return result;
	}

	/**
	 * Daily sales broken out by branch (day × branch).
	 * Fallback when PyServer daily-per-branch is unavailable.
	 */
	static async getDailySalesPerBranch(startDate = null, endDate = null, branchId = null) {
		const billingLocalDt = `COALESCE(
			CONVERT_TZ(b.ENCODED_DT, @@session.time_zone, '+08:00'),
			DATE_ADD(b.ENCODED_DT, INTERVAL 8 HOUR)
		)`;

		let dateFilter = '';
		const params = [];
		if (startDate && endDate) {
			dateFilter = `AND b.ENCODED_DT >= COALESCE(
				CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+08:00', @@session.time_zone),
				DATE_SUB(CONCAT(?, ' 00:00:00'), INTERVAL 8 HOUR)
			) AND b.ENCODED_DT < COALESCE(
				CONVERT_TZ(DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY), '+08:00', @@session.time_zone),
				DATE_SUB(DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY), INTERVAL 8 HOUR)
			)`;
			params.push(startDate, startDate, endDate, endDate);
		}

		let branchFilter = '';
		if (branchId) {
			branchFilter = 'AND br.IDNo = ?';
			params.push(branchId);
		}

		const query = `
			SELECT
				br.IDNo AS branch_id,
				br.BRANCH_NAME AS branch_name,
				DATE_FORMAT(DATE(${billingLocalDt}), '%Y-%m-%d') AS sale_date,
				DAYNAME(DATE(${billingLocalDt})) AS day_name,
				COALESCE(SUM(b.AMOUNT_PAID + COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) AS total_sales,
				COALESCE(SUM(COALESCE(b.REFUND, 0)), 0) AS refund,
				COALESCE(SUM(COALESCE(o.DISCOUNT_AMOUNT, 0)), 0) AS discount,
				COALESCE(SUM(b.AMOUNT_PAID - COALESCE(b.REFUND, 0)), 0) AS net_sales,
				COUNT(DISTINCT b.ORDER_ID) AS order_count
			FROM branches br
			INNER JOIN billing b ON b.BRANCH_ID = br.IDNo AND b.STATUS IN (1, 2) ${dateFilter}
			INNER JOIN orders o ON o.IDNo = b.ORDER_ID AND o.STATUS NOT IN (-1, -2)
			WHERE br.ACTIVE = 1 ${branchFilter}
			GROUP BY br.IDNo, br.BRANCH_NAME, DATE(${billingLocalDt})
			HAVING sale_date IS NOT NULL
			ORDER BY br.BRANCH_NAME, sale_date
		`;

		const [rows] = await pool.execute(query, params);
		return (rows || []).map((row) => ({
			branch_id: Number(row.branch_id),
			branch_name: String(row.branch_name || ''),
			sale_date: String(row.sale_date || '').slice(0, 10),
			day_name: String(row.day_name || ''),
			total_sales: Number(row.total_sales) || 0,
			refund: Number(row.refund) || 0,
			discount: Number(row.discount) || 0,
			net_sales: Number(row.net_sales) || 0,
			order_count: Number(row.order_count) || 0,
		}));
	}

	// Get least selling menu items (items with fewest orders, excluding zero)
	// Uses BOTH product_sales_summary (imported/Loyverse data) AND actual orders
	static async getLeastSellingItems(startDate = null, endDate = null, branchId = null, limit = 5) {
		try {
			// ── Source 1: product_sales_summary (imported / synced data) ──
			// Note: No date filter here — created_at is the import date, not sale date.
			// This table stores cumulative totals from Loyverse POS imports.
			const summaryQuery = `
				SELECT 
					product_name as name,
					category,
					COALESCE(sales_quantity, 0) as total_quantity,
					COALESCE(net_sales, 0) as total_revenue
				FROM product_sales_summary
				WHERE sales_quantity > 0
				ORDER BY sales_quantity ASC
			`;

			const [summaryRows] = await pool.execute(summaryQuery);

			// ── Source 2: actual orders (paid orders from billing) ──
			let orderDateFilter = '';
			let orderBranchFilter = '';
			const orderParams = [];

			if (startDate && endDate) {
				orderDateFilter = 'AND DATE(o.ENCODED_DT) BETWEEN ? AND ?';
				orderParams.push(startDate, endDate);
			}
			if (branchId) {
				orderBranchFilter = 'AND o.BRANCH_ID = ?';
				orderParams.push(branchId);
			}

			const ordersQuery = `
				SELECT 
					m.MENU_NAME as name,
					COALESCE(c.CAT_NAME, 'Uncategorized') as category,
					COALESCE(SUM(oi.QTY), 0) as total_quantity,
					COALESCE(SUM(oi.LINE_TOTAL), 0) as total_revenue,
					m.MENU_PRICE
				FROM orders o
				INNER JOIN billing b ON b.ORDER_ID = o.IDNo
				INNER JOIN order_items oi ON oi.ORDER_ID = o.IDNo
				INNER JOIN menu m ON m.IDNo = oi.MENU_ID
				LEFT JOIN categories c ON c.IDNo = m.CATEGORY_ID
				WHERE b.STATUS = 1
				${orderDateFilter}
				${orderBranchFilter}
				GROUP BY m.IDNo, m.MENU_NAME, m.MENU_PRICE, c.CAT_NAME
				HAVING total_quantity > 0
			`;

			const [orderRows] = await pool.execute(ordersQuery, orderParams);

			// ── Merge both sources by product name ──
			const dataMap = new Map();

			// Add imported data first
			summaryRows.forEach(row => {
				const name = (row.name || '').trim();
				if (!name) return;
				if (!dataMap.has(name)) {
					dataMap.set(name, {
						name,
						category: row.category || 'Uncategorized',
						total_quantity: 0,
						total_revenue: 0,
						price: 0,
					});
				}
				const data = dataMap.get(name);
				data.total_quantity += parseInt(row.total_quantity) || 0;
				data.total_revenue += parseFloat(row.total_revenue) || 0;
			});

			// Add/merge actual orders data
			orderRows.forEach(row => {
				const name = (row.name || '').trim();
				if (!name) return;
				if (!dataMap.has(name)) {
					dataMap.set(name, {
						name,
						category: row.category || 'Uncategorized',
						total_quantity: 0,
						total_revenue: 0,
						price: parseFloat(row.MENU_PRICE) || 0,
					});
				}
				const data = dataMap.get(name);
				data.total_quantity += parseInt(row.total_quantity) || 0;
				data.total_revenue += parseFloat(row.total_revenue) || 0;
				if (row.MENU_PRICE) data.price = parseFloat(row.MENU_PRICE) || data.price;
			});

			// Convert to array, filter > 0, sort by least quantity, limit
			const result = Array.from(dataMap.values())
				.filter(item => item.total_quantity > 0)
				.sort((a, b) => a.total_quantity - b.total_quantity || a.total_revenue - b.total_revenue)
				.slice(0, limit)
				.map((item, idx) => ({
					IDNo: idx + 1,
					MENU_NAME: item.name,
					MENU_PRICE: item.price,
					category: item.category,
					total_quantity: item.total_quantity,
					order_count: item.total_quantity,
					total_revenue: item.total_revenue,
				}));

			return result;
		} catch (error) {
			console.error('Error in getLeastSellingItems:', error);
			throw error;
		}
	}
}

module.exports = ReportsModel;
