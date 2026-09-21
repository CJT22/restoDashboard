/**
 * Move specific Blue Moon (BRANCH_ID=3) orders from Aug 3 to Aug 2
 * by shifting ENCODED_DT back 1 calendar day (time-of-day kept).
 *
 * Default: dry-run (preview only)
 * Apply:   node server/scripts/shiftBlueMoonAug3OrdersToAug2.cjs --apply
 *
 * Reports group sales by billing.ENCODED_DT / orders.ENCODED_DT, not ORDER_NO.
 * ORDER_NO is left unchanged (receipts / printed refs).
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

const BRANCH_ID = 3;
const BRANCH_NAME = 'Blue Moon';
const FROM_DAY = '2026-08-03';
const TO_DAY = '2026-08-02';

const ORDER_NOS = [
	'ORD-20260803-182114',
	'ORD-20260803-182053',
	'ORD-20260803-182019',
	'ORD-20260803-181957',
	'ORD-20260803-181921',
	'ORD-20260803-181841',
	'ORD-20260803-181819',
	'ORD-20260803-181802',
	'ORD-20260803-181740',
	'ORD-20260803-181713',
	'ORD-20260803-181653',
	'ORD-20260803-181637',
	'ORD-20260803-181626',
	'ORD-20260803-181508',
	'ORD-20260803-181452',
	'ORD-20260803-181426',
	'ORD-20260803-181401',
	'ORD-20260803-181241',
	'ORD-20260803-181221',
	'ORD-20260803-181215',
	'ORD-20260803-181116',
	'ORD-20260803-181100',
	'ORD-20260803-181036',
	'ORD-20260803-181011',
	'ORD-20260803-180936',
	'ORD-20260803-180918',
];

function fmtDt(v) {
	if (v == null) return null;
	if (v instanceof Date) {
		const pad = (n) => String(n).padStart(2, '0');
		return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
	}
	return String(v);
}

function dayOf(v) {
	const s = fmtDt(v);
	return s ? s.slice(0, 10) : null;
}

function shiftedDt(v) {
	const s = fmtDt(v);
	if (!s) return null;
	if (!s.startsWith(FROM_DAY)) return s;
	return `${TO_DAY}${s.slice(10)}`;
}

async function createPool() {
	return mysql.createPool({
		host: process.env.DB_HOST,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		port: process.env.DB_PORT,
		waitForConnections: true,
		connectionLimit: 5,
		dateStrings: true,
	});
}

async function loadRelated(conn, orderIds, table, extraCols = '') {
	if (!orderIds.length) return [];
	const ph = orderIds.map(() => '?').join(',');
	const [rows] = await conn.execute(
		`SELECT IDNo, ORDER_ID, ENCODED_DT${extraCols} FROM ${table} WHERE ORDER_ID IN (${ph})`,
		orderIds
	);
	return rows;
}

async function main() {
	const apply = process.argv.includes('--apply');
	const pool = await createPool();
	const conn = await pool.getConnection();

	try {
		const [branchRows] = await conn.execute(
			`SELECT IDNo, BRANCH_NAME FROM branches WHERE IDNo = ? LIMIT 1`,
			[BRANCH_ID]
		);
		if (!branchRows.length) throw new Error(`Branch ${BRANCH_ID} not found`);
		const branch = branchRows[0];
		if (String(branch.BRANCH_NAME).trim() !== BRANCH_NAME) {
			throw new Error(`Branch ${BRANCH_ID} is "${branch.BRANCH_NAME}", expected "${BRANCH_NAME}"`);
		}

		const ph = ORDER_NOS.map(() => '?').join(',');
		const [orders] = await conn.execute(
			`SELECT IDNo, BRANCH_ID, ORDER_NO, STATUS, GRAND_TOTAL, ENCODED_DT
			 FROM orders
			 WHERE ORDER_NO IN (${ph})
			 ORDER BY ENCODED_DT, IDNo`,
			ORDER_NOS
		);

		const foundNos = new Set(orders.map((o) => o.ORDER_NO));
		const missing = ORDER_NOS.filter((n) => !foundNos.has(n));
		const wrongBranch = orders.filter((o) => Number(o.BRANCH_ID) !== BRANCH_ID);
		const notFromDay = orders.filter((o) => dayOf(o.ENCODED_DT) !== FROM_DAY);
		const eligible = orders.filter(
			(o) => Number(o.BRANCH_ID) === BRANCH_ID && dayOf(o.ENCODED_DT) === FROM_DAY
		);

		const orderIds = eligible.map((o) => o.IDNo);
		const billing = await loadRelated(conn, orderIds, 'billing', ', AMOUNT_PAID, AMOUNT_DUE');
		const items = await loadRelated(conn, orderIds, 'order_items');
		const pays = await loadRelated(conn, orderIds, 'payment_transactions');
		const scans = await loadRelated(conn, orderIds, 'receipt_scan_history');

		const grandTotal = eligible.reduce((s, o) => s + Number(o.GRAND_TOTAL || 0), 0);

		console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
		console.log(`Branch: ${branch.BRANCH_NAME} (id ${branch.IDNo})`);
		console.log(`Shift: ${FROM_DAY} -> ${TO_DAY} (time kept)`);
		console.log(`Listed order nos: ${ORDER_NOS.length}`);
		console.log(`Found in DB: ${orders.length}`);
		console.log(`Eligible to move: ${eligible.length}`);
		console.log(`Grand total of eligible: ${grandTotal.toFixed(2)}`);
		if (missing.length) console.log(`MISSING: ${missing.join(', ')}`);
		if (wrongBranch.length) {
			console.log(
				`WRONG BRANCH: ${wrongBranch.map((o) => `${o.ORDER_NO} branch=${o.BRANCH_ID}`).join(', ')}`
			);
		}
		if (notFromDay.length) {
			console.log(
				`SKIP (not ${FROM_DAY}): ${notFromDay.map((o) => `${o.ORDER_NO}=${fmtDt(o.ENCODED_DT)}`).join(', ')}`
			);
		}

		console.log('\nOrders:');
		for (const o of eligible) {
			console.log(
				`  ${o.ORDER_NO}  id=${o.IDNo}  status=${o.STATUS}  total=${Number(o.GRAND_TOTAL).toFixed(2)}  ${fmtDt(o.ENCODED_DT)}  ->  ${shiftedDt(o.ENCODED_DT)}`
			);
		}

		const relatedSummary = [
			['billing', billing],
			['order_items', items],
			['payment_transactions', pays],
			['receipt_scan_history', scans],
		];
		console.log('\nRelated rows that would shift (only if currently on ' + FROM_DAY + '):');
		for (const [name, rows] of relatedSummary) {
			const toShift = rows.filter((r) => dayOf(r.ENCODED_DT) === FROM_DAY);
			const other = rows.filter((r) => dayOf(r.ENCODED_DT) !== FROM_DAY);
			console.log(`  ${name}: ${toShift.length} of ${rows.length} on ${FROM_DAY}`);
			if (other.length) {
				for (const r of other) {
					console.log(`    skip ${name} id=${r.IDNo} order=${r.ORDER_ID} dt=${fmtDt(r.ENCODED_DT)}`);
				}
			}
		}

		if (!apply) {
			console.log('\nDry-run only. Re-run with --apply to write changes.');
			return;
		}

		if (!eligible.length) {
			console.log('\nNothing to update.');
			return;
		}

		await conn.beginTransaction();
		try {
			const [uOrders] = await conn.query(
				`UPDATE orders
				 SET ENCODED_DT = CONCAT(?, ' ', TIME(ENCODED_DT))
				 WHERE BRANCH_ID = ?
				   AND DATE(ENCODED_DT) = ?
				   AND IDNo IN (?)`,
				[TO_DAY, BRANCH_ID, FROM_DAY, orderIds]
			);

			const [uBilling] = await conn.query(
				`UPDATE billing
				 SET ENCODED_DT = CONCAT(?, ' ', TIME(ENCODED_DT))
				 WHERE DATE(ENCODED_DT) = ?
				   AND ORDER_ID IN (?)`,
				[TO_DAY, FROM_DAY, orderIds]
			);

			const [uItems] = await conn.query(
				`UPDATE order_items
				 SET ENCODED_DT = CONCAT(?, ' ', TIME(ENCODED_DT))
				 WHERE DATE(ENCODED_DT) = ?
				   AND ORDER_ID IN (?)`,
				[TO_DAY, FROM_DAY, orderIds]
			);

			const [uPays] = await conn.query(
				`UPDATE payment_transactions
				 SET ENCODED_DT = CONCAT(?, ' ', TIME(ENCODED_DT))
				 WHERE DATE(ENCODED_DT) = ?
				   AND ORDER_ID IN (?)`,
				[TO_DAY, FROM_DAY, orderIds]
			);

			const [uScans] = await conn.query(
				`UPDATE receipt_scan_history
				 SET ENCODED_DT = CONCAT(?, ' ', TIME(ENCODED_DT))
				 WHERE DATE(ENCODED_DT) = ?
				   AND ORDER_ID IN (?)`,
				[TO_DAY, FROM_DAY, orderIds]
			);

			await conn.commit();
			console.log('\nApplied:');
			console.log(`  orders: ${uOrders.affectedRows}`);
			console.log(`  billing: ${uBilling.affectedRows}`);
			console.log(`  order_items: ${uItems.affectedRows}`);
			console.log(`  payment_transactions: ${uPays.affectedRows}`);
			console.log(`  receipt_scan_history: ${uScans.affectedRows}`);
		} catch (err) {
			await conn.rollback();
			throw err;
		}
	} finally {
		conn.release();
		await pool.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
