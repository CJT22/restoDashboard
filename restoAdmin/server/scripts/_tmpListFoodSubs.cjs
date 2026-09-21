const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

(async () => {
  const p = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
  });
  const [rows] = await p.execute(
    `SELECT oc.NAME AS main, mc.IDNo, mc.CATEGORY_NAME,
            (SELECT COUNT(*) FROM expenses e WHERE e.MASTER_CAT_ID = mc.IDNo AND e.ACTIVE = 1) AS cnt
     FROM master_categories mc
     JOIN operation_category oc ON oc.IDNo = mc.OP_CAT_ID
     WHERE mc.BRANCH_ID = 12 AND mc.ACTIVE = 1 AND oc.NAME LIKE '%Food%'
     ORDER BY mc.CATEGORY_NAME`
  );
  for (const r of rows) {
    console.log(`${r.IDNo} | ${r.main} > ${r.CATEGORY_NAME} (${r.cnt})`);
  }
  await p.end();
})();
