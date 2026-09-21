/**
 * One-time repair for cloud/local DBs that still have duplicate Loyverse refund rows.
 * Safe to run multiple times.
 *
 * Usage: node scripts/repair-refunds-once.cjs
 */
const BillingModel = require('../server/models/billingModel');
const pool = require('../server/config/db');

(async () => {
  await BillingModel.ensureLoyverseRefundsTable();
  await BillingModel.rebuildBillingRefundsFromTracker();

  const [dupes] = await pool.execute(
    `SELECT COUNT(*) AS c
     FROM (
       SELECT refund_receipt_number
       FROM loyverse_refund_receipts
       GROUP BY refund_receipt_number
       HAVING COUNT(*) > 1
     ) x`
  );

  const [pk] = await pool.execute(
    `SELECT COUNT(*) AS c
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = 'loyverse_refund_receipts'
       AND constraint_type = 'PRIMARY KEY'`
  );

  const [totals] = await pool.execute(
    `SELECT COALESCE(SUM(refund_amount), 0) AS tracker_total
     FROM loyverse_refund_receipts`
  );

  const [billing] = await pool.execute(
    `SELECT COALESCE(SUM(REFUND), 0) AS billing_total
     FROM billing WHERE REFUND > 0`
  );

  console.log('primary_key:', Number(pk[0]?.c || 0) > 0 ? 'yes' : 'no');
  console.log('duplicate receipt keys:', dupes[0]?.c ?? 0);
  console.log('tracker refund total:', totals[0]?.tracker_total);
  console.log('billing refund total:', billing[0]?.billing_total);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
