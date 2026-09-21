/**
 * Discover Food Supplies → Supplies / Indirect duplicates across branches.
 * Read-only.
 *
 *   node server/scripts/discoverFoodSuppliesOpsDupes.cjs
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    const [rows] = await pool.execute(`
      SELECT
        b.IDNo AS branch_id,
        b.BRANCH_NAME AS branch_name,
        oc.NAME AS main_name,
        oc.STATE AS main_state,
        mc.IDNo AS master_id,
        mc.CATEGORY_NAME AS cat_name,
        mc.CATEGORY_TYPE AS cat_type,
        (
          SELECT COUNT(*) FROM expenses e
          WHERE e.MASTER_CAT_ID = mc.IDNo AND e.ACTIVE = 1 AND e.BRANCH_ID = b.IDNo
        ) AS expense_cnt,
        (
          SELECT COALESCE(SUM(e.EXP_AMOUNT), 0) FROM expenses e
          WHERE e.MASTER_CAT_ID = mc.IDNo AND e.ACTIVE = 1 AND e.BRANCH_ID = b.IDNo
        ) AS expense_total
      FROM master_categories mc
      INNER JOIN branches b ON b.IDNo = mc.BRANCH_ID AND b.ACTIVE = 1
      INNER JOIN operation_category oc ON oc.IDNo = mc.OP_CAT_ID AND oc.ACTIVE = 1
      WHERE mc.ACTIVE = 1
        AND (
          mc.CATEGORY_NAME LIKE '%Supplies%'
          OR mc.CATEGORY_TYPE LIKE '%Supplies%'
          OR mc.CATEGORY_NAME LIKE '%소모품%'
          OR mc.CATEGORY_TYPE LIKE '%소모품%'
          OR mc.CATEGORY_NAME LIKE '%Indirect%'
          OR mc.CATEGORY_TYPE LIKE '%Indirect%'
          OR mc.CATEGORY_NAME LIKE '%간접비%'
          OR mc.CATEGORY_TYPE LIKE '%간접비%'
          OR mc.CATEGORY_NAME LIKE '%기타경비%'
          OR mc.CATEGORY_TYPE LIKE '%기타경비%'
        )
      ORDER BY b.BRANCH_NAME, oc.STATE DESC, oc.NAME, mc.CATEGORY_NAME
    `);

    console.log(`Found ${rows.length} Supplies/Indirect-related master categories:\n`);
    let lastBranch = null;
    for (const r of rows) {
      if (lastBranch !== r.branch_id) {
        console.log(`\n=== Branch ${r.branch_id}: ${r.branch_name} ===`);
        lastBranch = r.branch_id;
      }
      const stateLabel = Number(r.main_state) === 1 ? 'INV' : 'EXP';
      console.log(
        `  [${stateLabel}] ${r.main_name} › ${r.cat_name || r.cat_type}  (id=${r.master_id}, expenses=${r.expense_cnt}, total=${Number(r.expense_total).toFixed(2)})`
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
