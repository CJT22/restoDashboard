/**
 * Move Food Supplies Supplies/Indirect duplicates into Operation targets.
 * Branches: KumHo Restaurant (9), PRIME BBQ (12)
 *
 * Default: dry-run
 * Apply:   node server/scripts/mergeFoodSuppliesOpsDupes.cjs --apply
 *
 * Does not change EXP_AMOUNT values. Soft-deletes source master_categories.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

const FOOD_SUPPLIES = '1. 식자재 / Food Supplies';
const OPERATION = '2. 매장운영 / Operation';

const BRANCHES = [
  { name: 'KumHo Restaurant', id: 9 },
  { name: 'PRIME BBQ', id: 12 },
];

/** Exact name matches under Food Supplies → Operation */
const MERGES = [
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: '7. 소모품, 잡화 / Supplies',
    targetMain: OPERATION,
    targetName: '1. 소모품, 잡화 / Supplies',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: '소모품, 잡화 / Supplies',
    targetMain: OPERATION,
    targetName: '1. 소모품, 잡화 / Supplies',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: 'Supplies',
    targetMain: OPERATION,
    targetName: '1. 소모품, 잡화 / Supplies',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: '8. 간접비 / Indirect expenses',
    targetMain: OPERATION,
    targetName: '2. 기타경비 / Indirect Expenses',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: '간접비 / Indirect expenses',
    targetMain: OPERATION,
    targetName: '2. 기타경비 / Indirect Expenses',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: 'Indirect expenses',
    targetMain: OPERATION,
    targetName: '2. 기타경비 / Indirect Expenses',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: 'Indirect Expenses',
    targetMain: OPERATION,
    targetName: '2. 기타경비 / Indirect Expenses',
  },
  {
    sourceMain: FOOD_SUPPLIES,
    sourceName: '기타경비 / Indirect Expenses',
    targetMain: OPERATION,
    targetName: '2. 기타경비 / Indirect Expenses',
  },
];

function money(n) {
  return Number(n || 0).toFixed(2);
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
  });
}

async function resolveBranch(conn, expected) {
  const [rows] = await conn.execute(
    `SELECT IDNo, BRANCH_NAME FROM branches
     WHERE ACTIVE = 1 AND (IDNo = ? OR LOWER(TRIM(BRANCH_NAME)) = LOWER(?))
     LIMIT 1`,
    [expected.id, expected.name]
  );
  if (!rows.length) throw new Error(`Branch not found: ${expected.name} / id ${expected.id}`);
  return rows[0];
}

async function loadOpsByName(conn, branchId) {
  const [rows] = await conn.execute(
    `SELECT IDNo, NAME, STATE FROM operation_category
     WHERE ACTIVE = 1 AND (BRANCH_ID = ? OR BRANCH_ID IS NULL)`,
    [branchId]
  );
  const byName = new Map();
  for (const row of rows) byName.set(String(row.NAME).trim(), row);
  return byName;
}

async function findMaster(conn, branchId, opCatId, categoryName) {
  const [rows] = await conn.execute(
    `SELECT IDNo, CATEGORY_NAME, CATEGORY_TYPE, OP_CAT_ID, ACTIVE
     FROM master_categories
     WHERE BRANCH_ID = ? AND OP_CAT_ID = ? AND ACTIVE = 1
       AND TRIM(CATEGORY_NAME) = ?
     LIMIT 2`,
    [branchId, opCatId, categoryName]
  );
  if (rows.length) return rows;
  const [byType] = await conn.execute(
    `SELECT IDNo, CATEGORY_NAME, CATEGORY_TYPE, OP_CAT_ID, ACTIVE
     FROM master_categories
     WHERE BRANCH_ID = ? AND OP_CAT_ID = ? AND ACTIVE = 1
       AND TRIM(CATEGORY_TYPE) = ?
     LIMIT 2`,
    [branchId, opCatId, categoryName]
  );
  return byType;
}

async function countExpenses(conn, branchId, masterCatId) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(EXP_AMOUNT), 0) AS total
     FROM expenses
     WHERE BRANCH_ID = ? AND MASTER_CAT_ID = ? AND ACTIVE = 1`,
    [branchId, masterCatId]
  );
  return { count: Number(rows[0].cnt), total: Number(rows[0].total) };
}

async function countIngredients(conn, branchId, masterCatId) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM ingredients
     WHERE BRANCH_ID = ? AND MASTER_CAT_ID = ? AND ACTIVE = 1`,
    [branchId, masterCatId]
  );
  return Number(rows[0].cnt);
}

async function branchExpenseTotal(conn, branchId) {
  const [rows] = await conn.execute(
    `SELECT COALESCE(SUM(EXP_AMOUNT), 0) AS total, COUNT(*) AS cnt
     FROM expenses
     WHERE BRANCH_ID = ? AND ACTIVE = 1`,
    [branchId]
  );
  return { total: Number(rows[0].total), count: Number(rows[0].cnt) };
}

async function buildPlan(conn, branchId) {
  const ops = await loadOpsByName(conn, branchId);
  const pairs = [];
  const missing = [];
  const seenSourceIds = new Set();

  for (const merge of MERGES) {
    const sourceOp = ops.get(merge.sourceMain);
    const targetOp = ops.get(merge.targetMain);
    if (!sourceOp) {
      missing.push(`Missing main: ${merge.sourceMain}`);
      continue;
    }
    if (!targetOp) {
      missing.push(`Missing main: ${merge.targetMain}`);
      continue;
    }

    const sourceRows = await findMaster(conn, branchId, sourceOp.IDNo, merge.sourceName);
    const targetRows = await findMaster(conn, branchId, targetOp.IDNo, merge.targetName);

    if (!sourceRows.length) continue; // source variant absent — ok
    if (sourceRows.length > 1) {
      missing.push(`Ambiguous source "${merge.sourceName}": ids ${sourceRows.map((r) => r.IDNo).join(',')}`);
      continue;
    }
    if (!targetRows.length) {
      missing.push(`Target not found: "${merge.targetName}" under ${merge.targetMain}`);
      continue;
    }
    if (targetRows.length > 1) {
      missing.push(`Ambiguous target "${merge.targetName}": ids ${targetRows.map((r) => r.IDNo).join(',')}`);
      continue;
    }

    const source = sourceRows[0];
    const target = targetRows[0];
    const sourceId = Number(source.IDNo);
    const targetId = Number(target.IDNo);
    if (sourceId === targetId) continue;
    if (seenSourceIds.has(sourceId)) continue;
    seenSourceIds.add(sourceId);

    const exp = await countExpenses(conn, branchId, sourceId);
    const ing = await countIngredients(conn, branchId, sourceId);
    pairs.push({
      sourceMain: merge.sourceMain,
      sourceName: String(source.CATEGORY_NAME || merge.sourceName),
      sourceId,
      targetMain: merge.targetMain,
      targetName: String(target.CATEGORY_NAME || merge.targetName),
      targetId,
      expenseCount: exp.count,
      expenseTotal: exp.total,
      ingredientCount: ing,
    });
  }

  return { pairs, missing: [...new Set(missing)] };
}

async function remapIngredients(conn, branchId, sourceCatId, targetCatId) {
  let moved = 0;
  let mergedAway = 0;

  const [collisions] = await conn.execute(
    `SELECT s.IDNo AS source_ing_id, t.IDNo AS target_ing_id, TRIM(s.NAME) AS name
     FROM ingredients s
     INNER JOIN ingredients t
       ON t.BRANCH_ID = s.BRANCH_ID
      AND t.ACTIVE = 1
      AND t.MASTER_CAT_ID = ?
      AND TRIM(t.NAME) = TRIM(s.NAME)
     WHERE s.BRANCH_ID = ?
       AND s.ACTIVE = 1
       AND s.MASTER_CAT_ID = ?`,
    [targetCatId, branchId, sourceCatId]
  );

  for (const row of collisions) {
    const sourceIngId = Number(row.source_ing_id);
    const targetIngId = Number(row.target_ing_id);

    await conn.execute(
      `UPDATE expenses SET INGREDIENT_ID = ?
       WHERE BRANCH_ID = ? AND INGREDIENT_ID = ? AND ACTIVE = 1`,
      [targetIngId, branchId, sourceIngId]
    );

    const [menuLinks] = await conn.execute(
      `SELECT IDNo, MENU_ID FROM menu_ingredients WHERE INGREDIENT_ID = ? AND ACTIVE = 1`,
      [sourceIngId]
    );
    for (const link of menuLinks) {
      const [existing] = await conn.execute(
        `SELECT IDNo FROM menu_ingredients
         WHERE MENU_ID = ? AND INGREDIENT_ID = ? AND ACTIVE = 1 LIMIT 1`,
        [link.MENU_ID, targetIngId]
      );
      if (existing.length) {
        await conn.execute(
          `UPDATE menu_ingredients SET ACTIVE = 0, EDITED_DT = CURRENT_TIMESTAMP WHERE IDNo = ?`,
          [link.IDNo]
        );
      } else {
        await conn.execute(
          `UPDATE menu_ingredients SET INGREDIENT_ID = ?, EDITED_DT = CURRENT_TIMESTAMP WHERE IDNo = ?`,
          [targetIngId, link.IDNo]
        );
      }
    }

    const [srcInv] = await conn.execute(
      `SELECT IDNo, STOCK_QTY FROM inventory
       WHERE BRANCH_ID = ? AND INGREDIENT_ID = ? AND ACTIVE = 1`,
      [branchId, sourceIngId]
    );
    for (const inv of srcInv) {
      const qty = Number(inv.STOCK_QTY) || 0;
      const [tgtInv] = await conn.execute(
        `SELECT IDNo FROM inventory
         WHERE BRANCH_ID = ? AND INGREDIENT_ID = ? AND ACTIVE = 1 LIMIT 1`,
        [branchId, targetIngId]
      );
      if (tgtInv.length) {
        await conn.execute(
          `UPDATE inventory
           SET STOCK_QTY = COALESCE(STOCK_QTY, 0) + ?, EDITED_DT = CURRENT_TIMESTAMP
           WHERE IDNo = ?`,
          [qty, tgtInv[0].IDNo]
        );
        await conn.execute(
          `UPDATE inventory SET ACTIVE = 0, EDITED_DT = CURRENT_TIMESTAMP WHERE IDNo = ?`,
          [inv.IDNo]
        );
      } else {
        await conn.execute(
          `UPDATE inventory SET INGREDIENT_ID = ?, EDITED_DT = CURRENT_TIMESTAMP WHERE IDNo = ?`,
          [targetIngId, inv.IDNo]
        );
      }
    }

    await conn.execute(
      `UPDATE ingredients SET ACTIVE = 0, EDITED_DT = CURRENT_TIMESTAMP
       WHERE IDNo = ? AND BRANCH_ID = ? AND ACTIVE = 1`,
      [sourceIngId, branchId]
    );
    mergedAway += 1;
  }

  const [ingResult] = await conn.execute(
    `UPDATE ingredients
     SET MASTER_CAT_ID = ?, EDITED_DT = CURRENT_TIMESTAMP
     WHERE BRANCH_ID = ? AND MASTER_CAT_ID = ? AND ACTIVE = 1`,
    [targetCatId, branchId, sourceCatId]
  );
  moved += ingResult.affectedRows || 0;
  return { moved, mergedAway };
}

async function applyMerge(conn, branchId, pairs) {
  const before = await branchExpenseTotal(conn, branchId);
  await conn.beginTransaction();
  try {
    let expensesMoved = 0;
    let ingredientsMoved = 0;
    let ingredientsMergedAway = 0;
    const deactivated = [];

    for (const pair of pairs) {
      const ingStats = await remapIngredients(conn, branchId, pair.sourceId, pair.targetId);
      ingredientsMoved += ingStats.moved;
      ingredientsMergedAway += ingStats.mergedAway;

      const [expResult] = await conn.execute(
        `UPDATE expenses SET MASTER_CAT_ID = ?
         WHERE BRANCH_ID = ? AND MASTER_CAT_ID = ? AND ACTIVE = 1`,
        [pair.targetId, branchId, pair.sourceId]
      );
      expensesMoved += expResult.affectedRows || 0;

      const [delResult] = await conn.execute(
        `UPDATE master_categories
         SET ACTIVE = 0, EDITED_DT = CURRENT_TIMESTAMP
         WHERE IDNo = ? AND BRANCH_ID = ? AND ACTIVE = 1`,
        [pair.sourceId, branchId]
      );
      if (delResult.affectedRows) deactivated.push(pair.sourceId);
    }

    const after = await branchExpenseTotal(conn, branchId);
    if (money(before.total) !== money(after.total) || before.count !== after.count) {
      throw new Error(
        `Amount integrity failed. Before: ${before.count}/${money(before.total)}; After: ${after.count}/${money(after.total)}`
      );
    }

    await conn.commit();
    return { before, after, expensesMoved, ingredientsMoved, ingredientsMergedAway, deactivated };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = await createPool();
  const conn = await pool.getConnection();

  try {
    console.log(apply ? '=== APPLY MODE ===\n' : '=== DRY-RUN (no changes) ===\n');

    for (const expected of BRANCHES) {
      const branch = await resolveBranch(conn, expected);
      const branchId = Number(branch.IDNo);
      console.log(`\n######## Branch: ${branch.BRANCH_NAME} (IDNo=${branchId}) ########`);

      const before = await branchExpenseTotal(conn, branchId);
      console.log(`Active expenses: ${before.count} rows, SUM=${money(before.total)}`);

      const { pairs, missing } = await buildPlan(conn, branchId);
      if (missing.length) {
        console.log('Notes:');
        for (const m of missing) console.log(`  - ${m}`);
      }
      if (!pairs.length) {
        console.log('Nothing to merge for this branch.');
        continue;
      }

      console.log('Merge plan:');
      for (const p of pairs) {
        console.log(
          `  [${p.sourceId}] ${p.sourceMain} › ${p.sourceName}` +
            `  →  [${p.targetId}] ${p.targetMain} › ${p.targetName}` +
            `  | exp=${p.expenseCount} sum=${money(p.expenseTotal)} ing=${p.ingredientCount}`
        );
      }

      if (!apply) {
        console.log('Dry-run only for this branch.');
        continue;
      }

      console.log('Applying...');
      const result = await applyMerge(conn, branchId, pairs);
      console.log(
        `DONE: expensesMoved=${result.expensesMoved}, ingredientsMoved=${result.ingredientsMoved}, ` +
          `ingredientsMergedAway=${result.ingredientsMergedAway}, deactivated=[${result.deactivated.join(', ')}]`
      );
      console.log(
        `Integrity OK: SUM ${money(result.before.total)} → ${money(result.after.total)}, rows ${result.before.count} → ${result.after.count}`
      );
    }

    if (!apply) console.log('\nDry-run complete. Re-run with --apply to commit.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Merge failed:', err.message || err);
  process.exit(1);
});
