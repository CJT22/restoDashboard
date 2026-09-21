/**
 * List active master categories for a branch (read-only).
 *   node server/scripts/listBranchCategories.cjs "PRIME BBQ"
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

async function main() {
  const arg = process.argv[2] || 'PRIME BBQ';
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
  });
  try {
    const [branches] = await pool.execute(
      `SELECT IDNo, BRANCH_NAME FROM branches
       WHERE ACTIVE = 1 AND (IDNo = ? OR LOWER(TRIM(BRANCH_NAME)) = LOWER(?)) LIMIT 1`,
      [/^\d+$/.test(arg) ? Number(arg) : -1, arg]
    );
    if (!branches.length) throw new Error('Branch not found');
    const branchId = Number(branches[0].IDNo);
    console.log(`Branch: ${branches[0].BRANCH_NAME} (${branchId})\n`);

    const [rows] = await pool.execute(
      `SELECT oc.NAME AS main_name, oc.STATE, mc.IDNo, mc.CATEGORY_NAME,
              (SELECT COUNT(*) FROM expenses e
               WHERE e.MASTER_CAT_ID = mc.IDNo AND e.ACTIVE = 1 AND e.BRANCH_ID = ?) AS cnt
       FROM master_categories mc
       JOIN operation_category oc ON oc.IDNo = mc.OP_CAT_ID
       WHERE mc.BRANCH_ID = ? AND mc.ACTIVE = 1 AND oc.ACTIVE = 1
       ORDER BY oc.NAME, mc.CATEGORY_NAME`,
      [branchId, branchId]
    );
    for (const r of rows) {
      const st = Number(r.STATE) === 1 ? 'INV' : 'EXP';
      console.log(`[${st}] ${r.main_name} › ${r.CATEGORY_NAME}  id=${r.IDNo} exp=${r.cnt}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
