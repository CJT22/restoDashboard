/**
 * Reclassify miscategorized items under Operation › Supplies into the correct
 * Food Supplies / Operation subcategories (by expense item name heuristics).
 *
 * Default: dry-run
 * Apply:   node server/scripts/reclassifyOperationSuppliesItems.cjs --apply
 * Branch:  node server/scripts/reclassifyOperationSuppliesItems.cjs --branch "PRIME BBQ" --apply
 *
 * Does not change EXP_AMOUNT. Remaps MASTER_CAT_ID (+ ingredient master when linked).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

const DEFAULT_BRANCHES = ['PRIME BBQ', 'KumHo Restaurant'];

/** Target keys resolved against each branch's live category labels. */
const TARGET = {
  MEAT: 'meat',
  VEG: 'vegetables',
  SEAFOOD: 'seafood',
  FRESH: 'fresh food',
  RICE: 'rice',
  BEV: 'beverages',
  SUPPLIES: 'supplies',
  INDIRECT: 'indirect',
  FIXED: 'fixed costs',
  VEHICLE: 'vehicle',
};

/**
 * First matching rule wins.
 * { re, target } — target is TARGET.* key
 */
const RULES = [
  // ---- tools / packaging that mention food words but are Supplies ----
  { re: /\b(meat\s*paper|meat\s*blade|고기칼날|칼날|blade\s+for|noodle\s*maker|sauce\s*cap)\b/i, target: TARGET.SUPPLIES },
  { re: /\b(rice\s*box|take\s*out|bento|dosirak|wrapper|utensil|chopping|choping|cutting board|lighter|faucet|banner|tarpaulin|torch|basahan|handsoap|hand soap|extension|extention|laminate|saucer|clingwrap|water\s*jug|water\s*test|water\s*dispenser|cupcake|liner|ariel|calla powder|rubber band|fuse|baseboard|epoxy|primer|pillar sink|outlet|plug|phone load|hard copy|scooper|cleaning items?|hair\s*net)\b/i, target: TARGET.SUPPLIES },

  // ---- clear non-food stay / move within Operation ----
  { re: /\b(lpg|butane|charcoal|gas cylinder|부탄)\b/i, target: TARGET.INDIRECT },
  { re: /\b(drj trading|daraejung|korean association|korean items?|korean item)\b/i, target: TARGET.INDIRECT },
  {
    re: /\b(paper towel|table tissue|cling wrap|garbage bag|detergent|bleach|sponge|thermal paper|napkin|foil|plastic|mop|brush|paint|tape|gloves?|hairnet|bond paper|coupon print|dishwashing|steel ?wool|chopsticks?|spoon|fork|bidet|baygon|cutter|hose|wire|fan|filter|extinguish|medicine|roller|labo|tissue|towel|ink|print|cup|pitcher|glass|weighing scale|exhaust|drip pan|shell|sakura|ngbu|lb\s*1|lb1|re\s*2500|re\s*1000|re2500|ro16)\b/i,
    target: TARGET.SUPPLIES,
  },
  { re: /\b(alcohol)\b/i, target: TARGET.SUPPLIES }, // sanitizing, not liquor

  // ---- sauces / powders that mention meat/chicken but are Fresh Food ----
  { re: /\b(bulgogi\s*sauce|chicken\s*powder|spicy\s*crab\s*sauce|meat\s*sauce)\b/i, target: TARGET.FRESH },
  { re: /\b(potato\s*starch|전분|corn\s*starch|cornstarch)\b/i, target: TARGET.RICE },

  // ---- food → Food Supplies ----
  { re: /\b(beef|pork|bacon|ham|sausage|galbi|samgyeopsal)\b/i, target: TARGET.MEAT },
  { re: /\b(shrimp|fish|squid|octopus|clam|mussel|anchovy|seafood)\b/i, target: TARGET.SEAFOOD },
  { re: /\boyster(?!\s+sauce)\b/i, target: TARGET.SEAFOOD },
  { re: /\bcrab(?!\s+sauce)\b/i, target: TARGET.SEAFOOD },
  { re: /\b(lettuce|cabbage|onion|garlic|tomato(?!\s+ketchup)|potato(?!\s*starch)|carrot|banana|fruit|vegetable|mushroom|cucumber|kimchi|hanyang)\b/i, target: TARGET.VEG },
  { re: /\b(company\s*phone|phone\s*load)\b/i, target: TARGET.INDIRECT },
  { re: /\b(rice(?!\s*box)|grain|flour|noodle|pasta|bread\s*crumbs?|breadcrumbs?|buchim|부침|밀떡|miltteok|ramyeon|ramen)\b/i, target: TARGET.RICE },
  { re: /\b(beer|wine|soju|juice|coke|sprite|coffee|tea(?!\s)|beverage|liquor)\b/i, target: TARGET.BEV },

  // condiments / oils / seasonings / frozen sides → Fresh Food
  {
    re: /\b(oil|sugar|설탕|salt|sauce|soy|ganjang|dasida|dashida|dasima|wasabi|mayo|mayonnaise|mayonaise|mustard|vinegar|ketchup|chili|gochujang|gochugaru|huchu|huchugaru|sunhuchu|ajinomoto|ajinamoto|\baji\b|sesame|season|spice|pepper|rock salt|msg|ice\b|cheese|cream|syrup|caramel|ssamjang|doenjang|denjang|tteokbokki|tteokboki|fries|fry|bidan|worijib|nestle|datu puti|ufc|french fries|white sugar|cooking oil|jin ganjang|apple vinegar|sweet chili|local soy|strong vinegar|korean mayo|wasabi paste|sea water|mulyeot|물엿|baking soda|galamandeun|galamandaeun|yeondu|연두|단무지|만두)\b/i,
    target: TARGET.FRESH,
  },
];

function money(n) {
  return Number(n || 0).toFixed(2);
}

function classifyName(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  for (const rule of RULES) {
    if (rule.re.test(raw)) return rule.target;
  }
  return null;
}

function englishTail(label) {
  const parts = String(label || '')
    .split('/')
    .map((p) => p.replace(/^\d+\.?\s*/, '').trim())
    .filter(Boolean);
  return (parts[parts.length - 1] || label || '').toLowerCase().trim();
}

function canonical(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/^\d+\.?\s*/, '')
    .replace(/[,，、]/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
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

async function resolveBranch(conn, nameOrId) {
  const [rows] = await conn.execute(
    `SELECT IDNo, BRANCH_NAME FROM branches
     WHERE ACTIVE = 1 AND (IDNo = ? OR LOWER(TRIM(BRANCH_NAME)) = LOWER(?))
     LIMIT 1`,
    [/^\d+$/.test(String(nameOrId)) ? Number(nameOrId) : -1, String(nameOrId)]
  );
  if (!rows.length) throw new Error(`Branch not found: ${nameOrId}`);
  return rows[0];
}

async function loadCategories(conn, branchId) {
  const [rows] = await conn.execute(
    `SELECT mc.IDNo, mc.CATEGORY_NAME, mc.CATEGORY_TYPE, oc.NAME AS main_name, oc.STATE
     FROM master_categories mc
     JOIN operation_category oc ON oc.IDNo = mc.OP_CAT_ID
     WHERE mc.BRANCH_ID = ? AND mc.ACTIVE = 1 AND oc.ACTIVE = 1`,
    [branchId]
  );
  return rows;
}

function isFoodMain(mainName) {
  return /food\s*supplies|식자재/i.test(String(mainName || ''));
}

function isOperationMain(mainName) {
  return /operation|매장운영/i.test(String(mainName || ''));
}

function findTargetCategory(categories, targetKey) {
  const foodTargets = new Set([
    TARGET.MEAT,
    TARGET.VEG,
    TARGET.SEAFOOD,
    TARGET.FRESH,
    TARGET.RICE,
    TARGET.BEV,
  ]);
  const opTargets = new Set([TARGET.SUPPLIES, TARGET.INDIRECT, TARGET.FIXED, TARGET.VEHICLE]);

  const scored = [];
  for (const cat of categories) {
    const label = String(cat.CATEGORY_NAME || cat.CATEGORY_TYPE || '');
    const main = String(cat.main_name || '');
    const eng = englishTail(label);
    const can = canonical(label);
    let score = 0;
    if (eng === targetKey || can === targetKey) score = 100;
    else if (eng.includes(targetKey) || can.includes(targetKey)) score = 80;
    else if (targetKey === TARGET.INDIRECT && /(indirect|기타경비|간접)/i.test(label)) score = 90;
    else if (targetKey === TARGET.SUPPLIES && /(supplies|소모품)/i.test(label)) score = 90;
    else if (targetKey === TARGET.FRESH && /(fresh food|신선)/i.test(label)) score = 90;
    else if (targetKey === TARGET.MEAT && /(meat\s*&\s*poultry|고기류)/i.test(label)) score = 90;
    else if (targetKey === TARGET.VEG && /(vegetables?\s*&\s*fruits?|야채)/i.test(label)) score = 90;
    else if (targetKey === TARGET.SEAFOOD && /(seafood|해산)/i.test(label)) score = 90;
    else if (targetKey === TARGET.RICE && /(rice\s*&\s*grains?|곡류)/i.test(label)) score = 90;
    else if (targetKey === TARGET.BEV && /(beverage|음료|liquor)/i.test(label)) score = 90;
    else if (targetKey === TARGET.FIXED && /(fixed|공과금|tax)/i.test(label)) score = 90;
    else if (targetKey === TARGET.VEHICLE && /(vehicle|차량)/i.test(label)) score = 90;

    // Prefer official Food Supplies / Operation parents over Mart store labels.
    if (score > 0) {
      if (foodTargets.has(targetKey) && isFoodMain(main)) score += 50;
      if (foodTargets.has(targetKey) && /mart|마트/i.test(main)) score -= 40;
      if (opTargets.has(targetKey) && isOperationMain(main)) score += 50;
      scored.push({ cat, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.cat || null;
}

function findSuppliesCategory(categories) {
  // Prefer Operation › Supplies (non-inventory / name contains Operation + Supplies)
  const opSupplies = categories.filter(
    (c) => /operation|매장운영/i.test(c.main_name) && /(supplies|소모품)/i.test(c.CATEGORY_NAME || '')
  );
  if (opSupplies.length) return opSupplies[0];
  return findTargetCategory(categories, TARGET.SUPPLIES);
}

async function branchExpenseTotal(conn, branchId) {
  const [rows] = await conn.execute(
    `SELECT COALESCE(SUM(EXP_AMOUNT), 0) AS total, COUNT(*) AS cnt
     FROM expenses WHERE BRANCH_ID = ? AND ACTIVE = 1`,
    [branchId]
  );
  return { total: Number(rows[0].total), count: Number(rows[0].cnt) };
}

async function buildPlan(conn, branchId) {
  const categories = await loadCategories(conn, branchId);
  const supplies = findSuppliesCategory(categories);
  if (!supplies) throw new Error('Operation Supplies category not found');

  const targetCache = new Map();
  const resolveTarget = (key) => {
    if (targetCache.has(key)) return targetCache.get(key);
    const cat = findTargetCategory(categories, key);
    targetCache.set(key, cat);
    return cat;
  };

  const [expenses] = await conn.execute(
    `SELECT e.IDNo, e.EXP_DESC, e.EXP_AMOUNT, e.EXP_SOURCE, e.INGREDIENT_ID, e.MASTER_CAT_ID
     FROM expenses e
     WHERE e.BRANCH_ID = ? AND e.MASTER_CAT_ID = ? AND e.ACTIVE = 1`,
    [branchId, supplies.IDNo]
  );

  const moves = []; // { expenseId, name, fromId, toId, toLabel, amount, ingredientId }
  const stay = [];
  const unmatched = [];
  const byTarget = new Map();

  for (const exp of expenses) {
    const name = String(exp.EXP_DESC || '').trim() || '(blank)';
    const key = classifyName(name);
    if (!key) {
      unmatched.push({ id: exp.IDNo, name, amount: Number(exp.EXP_AMOUNT) || 0, source: exp.EXP_SOURCE });
      continue;
    }
    const target = resolveTarget(key);
    if (!target) {
      unmatched.push({ id: exp.IDNo, name, amount: Number(exp.EXP_AMOUNT) || 0, source: exp.EXP_SOURCE, note: `no cat for ${key}` });
      continue;
    }
    if (Number(target.IDNo) === Number(supplies.IDNo)) {
      stay.push({ name, amount: Number(exp.EXP_AMOUNT) || 0 });
      continue;
    }
    const toLabel = `${target.main_name} › ${target.CATEGORY_NAME}`;
    moves.push({
      expenseId: Number(exp.IDNo),
      name,
      fromId: Number(supplies.IDNo),
      toId: Number(target.IDNo),
      toLabel,
      amount: Number(exp.EXP_AMOUNT) || 0,
      ingredientId: exp.INGREDIENT_ID != null ? Number(exp.INGREDIENT_ID) : null,
      source: exp.EXP_SOURCE,
    });
    if (!byTarget.has(toLabel)) byTarget.set(toLabel, { count: 0, amount: 0, names: new Map() });
    const agg = byTarget.get(toLabel);
    agg.count += 1;
    agg.amount += Number(exp.EXP_AMOUNT) || 0;
    const nk = name.toLowerCase();
    if (!agg.names.has(nk)) agg.names.set(nk, { name, count: 0, amount: 0 });
    const nAgg = agg.names.get(nk);
    nAgg.count += 1;
    nAgg.amount += Number(exp.EXP_AMOUNT) || 0;
  }

  return {
    supplies,
    moves,
    stayCount: stay.length,
    unmatched,
    byTarget,
  };
}

async function remapIngredientToCategory(conn, branchId, ingredientId, targetCatId) {
  if (!ingredientId) return { updated: 0, mergedAway: 0 };

  const [srcRows] = await conn.execute(
    `SELECT IDNo, NAME FROM ingredients
     WHERE IDNo = ? AND BRANCH_ID = ? AND ACTIVE = 1 LIMIT 1`,
    [ingredientId, branchId]
  );
  if (!srcRows.length) return { updated: 0, mergedAway: 0 };
  const src = srcRows[0];

  const [collision] = await conn.execute(
    `SELECT IDNo FROM ingredients
     WHERE BRANCH_ID = ? AND ACTIVE = 1 AND MASTER_CAT_ID = ?
       AND TRIM(NAME) = TRIM(?) AND IDNo <> ?
     LIMIT 1`,
    [branchId, targetCatId, src.NAME, ingredientId]
  );

  if (!collision.length) {
    const [r] = await conn.execute(
      `UPDATE ingredients SET MASTER_CAT_ID = ?, EDITED_DT = CURRENT_TIMESTAMP
       WHERE IDNo = ? AND BRANCH_ID = ? AND ACTIVE = 1`,
      [targetCatId, ingredientId, branchId]
    );
    return { updated: r.affectedRows || 0, mergedAway: 0 };
  }

  const targetIngId = Number(collision[0].IDNo);

  await conn.execute(
    `UPDATE expenses SET INGREDIENT_ID = ?
     WHERE BRANCH_ID = ? AND INGREDIENT_ID = ? AND ACTIVE = 1`,
    [targetIngId, branchId, ingredientId]
  );

  const [menuLinks] = await conn.execute(
    `SELECT IDNo, MENU_ID FROM menu_ingredients WHERE INGREDIENT_ID = ? AND ACTIVE = 1`,
    [ingredientId]
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
    [branchId, ingredientId]
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
    [ingredientId, branchId]
  );
  return { updated: 0, mergedAway: 1 };
}

async function applyPlan(conn, branchId, moves) {
  const before = await branchExpenseTotal(conn, branchId);
  await conn.beginTransaction();
  try {
    let expensesMoved = 0;
    let ingredientsUpdated = 0;
    let ingredientsMergedAway = 0;
    const touchedIngredients = new Set();

    for (const m of moves) {
      const [r] = await conn.execute(
        `UPDATE expenses SET MASTER_CAT_ID = ?
         WHERE IDNo = ? AND BRANCH_ID = ? AND ACTIVE = 1 AND MASTER_CAT_ID = ?`,
        [m.toId, m.expenseId, branchId, m.fromId]
      );
      expensesMoved += r.affectedRows || 0;

      if (m.ingredientId && !touchedIngredients.has(m.ingredientId)) {
        touchedIngredients.add(m.ingredientId);
        const ing = await remapIngredientToCategory(conn, branchId, m.ingredientId, m.toId);
        ingredientsUpdated += ing.updated;
        ingredientsMergedAway += ing.mergedAway;
      }
    }

    const after = await branchExpenseTotal(conn, branchId);
    if (money(before.total) !== money(after.total) || before.count !== after.count) {
      throw new Error(
        `Integrity failed before=${before.count}/${money(before.total)} after=${after.count}/${money(after.total)}`
      );
    }
    await conn.commit();
    return { before, after, expensesMoved, ingredientsUpdated, ingredientsMergedAway };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const branchIdx = argv.indexOf('--branch');
  const branches =
    branchIdx >= 0 && argv[branchIdx + 1] ? [argv[branchIdx + 1]] : DEFAULT_BRANCHES;
  return { apply, branches };
}

async function main() {
  const { apply, branches } = parseArgs(process.argv.slice(2));
  const pool = await createPool();
  const conn = await pool.getConnection();

  try {
    console.log(apply ? '=== APPLY MODE ===\n' : '=== DRY-RUN (no changes) ===\n');

    for (const branchName of branches) {
      const branch = await resolveBranch(conn, branchName);
      const branchId = Number(branch.IDNo);
      console.log(`\n######## ${branch.BRANCH_NAME} (${branchId}) ########`);

      const plan = await buildPlan(conn, branchId);
      console.log(`Source: ${plan.supplies.main_name} › ${plan.supplies.CATEGORY_NAME} (id=${plan.supplies.IDNo})`);
      console.log(`To move: ${plan.moves.length} expenses`);
      console.log(`Stay in Supplies (matched as supplies): ${plan.stayCount}`);
      console.log(`Unmatched (left in Supplies): ${plan.unmatched.length}`);

      console.log('\nMove summary by target:');
      for (const [label, agg] of [...plan.byTarget.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
        console.log(`  → ${label}: ${agg.count} rows, sum=${money(agg.amount)}`);
        const top = [...agg.names.values()].sort((a, b) => b.amount - a.amount).slice(0, 12);
        for (const n of top) {
          console.log(`      - ${n.name} ×${n.count} (${money(n.amount)})`);
        }
      }

      if (plan.unmatched.length) {
        const byName = new Map();
        for (const u of plan.unmatched) {
          const k = u.name.toLowerCase();
          if (!byName.has(k)) byName.set(k, { name: u.name, count: 0, amount: 0 });
          const a = byName.get(k);
          a.count += 1;
          a.amount += u.amount;
        }
        console.log('\nUnmatched sample (left as Supplies) top by amount:');
        [...byName.values()]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 25)
          .forEach((u) => console.log(`  ? ${u.name} ×${u.count} (${money(u.amount)})`));
      }

      if (!apply) {
        console.log('\nDry-run only.');
        continue;
      }
      if (!plan.moves.length) {
        console.log('Nothing to apply.');
        continue;
      }
      console.log('\nApplying...');
      const result = await applyPlan(conn, branchId, plan.moves);
      console.log(
        `DONE: expensesMoved=${result.expensesMoved}, ingredientsUpdated=${result.ingredientsUpdated}, ingredientsMergedAway=${result.ingredientsMergedAway}`
      );
      console.log(
        `Integrity OK: SUM ${money(result.before.total)} → ${money(result.after.total)}, rows ${result.before.count} → ${result.after.count}`
      );
    }

    if (!apply) console.log('\nRe-run with --apply to commit.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Reclassify failed:', err.message || err);
  process.exit(1);
});
