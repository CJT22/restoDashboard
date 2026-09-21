/**
 * Analyze Operation › Supplies items for food vs non-food mix.
 *   node server/scripts/analyzeOperationSuppliesMix.cjs [branchNameOrId]
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
const mysql = require('mysql2/promise');

const FOOD_HINT =
  /\b(oil|sugar|salt|sauce|soy|ganjang|dasida|wasabi|fries|ice|meat|chicken|pork|beef|fish|shrimp|rice|noodle|flour|starch|corn|sesame|garlic|onion|pepper|spice|season|kimchi|egg|milk|cheese|butter|cream|vinegar|mayo|ketchup|chili|gochujang|mirin|sake|beer|wine|juice|water|tea|coffee|bean|tofu|mushroom|cabbage|lettuce|tomato|potato|carrot|fruit|vegetable|seafood|broth|stock|msg|ajinomoto|cooking|ingredient|jin\b|fry|frozen|dumpling|mandoo|banchan)\b/i;

const NONFOOD_HINT =
  /\b(mop|brush|paint|roller|medicine|detergent|soap|tissue|towel|bag|glove|mask|cleaner|bleach|sponge|bucket|tape|screw|nail|tool|battery|bulb|light|plastic|wrap|foil|cup|plate|fork|spoon|straw|napkin|paper|ink|print|coupon|filter|hose|wire|cable|fan|heater|extinguisher)\b/i;

function classify(name) {
  const n = String(name || '').trim();
  const food = FOOD_HINT.test(n);
  const nonfood = NONFOOD_HINT.test(n);
  if (food && !nonfood) return 'food';
  if (nonfood && !food) return 'nonfood';
  if (food && nonfood) return 'ambiguous';
  return 'unknown';
}

async function main() {
  const arg = process.argv[2] || 'PRIME BBQ';
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
    const [branches] = await pool.execute(
      `SELECT IDNo, BRANCH_NAME FROM branches
       WHERE ACTIVE = 1 AND (IDNo = ? OR LOWER(TRIM(BRANCH_NAME)) = LOWER(?))
       LIMIT 1`,
      [/^\d+$/.test(arg) ? Number(arg) : -1, arg]
    );
    if (!branches.length) throw new Error(`Branch not found: ${arg}`);
    const branch = branches[0];
    const branchId = Number(branch.IDNo);

    const [cats] = await pool.execute(
      `SELECT mc.IDNo, mc.CATEGORY_NAME, oc.NAME AS main_name
       FROM master_categories mc
       JOIN operation_category oc ON oc.IDNo = mc.OP_CAT_ID
       WHERE mc.BRANCH_ID = ? AND mc.ACTIVE = 1
         AND oc.NAME LIKE '%Operation%'
         AND (mc.CATEGORY_NAME LIKE '%Supplies%' OR mc.CATEGORY_NAME LIKE '%소모품%')
       LIMIT 5`,
      [branchId]
    );
    if (!cats.length) throw new Error('Operation Supplies category not found');
    const cat = cats[0];
    console.log(`Branch: ${branch.BRANCH_NAME} (${branchId})`);
    console.log(`Category: ${cat.main_name} › ${cat.CATEGORY_NAME} (id=${cat.IDNo})\n`);

    const [rows] = await pool.execute(
      `SELECT e.IDNo, e.EXP_DESC, e.EXP_QTY, e.EXP_AMOUNT, e.EXP_SOURCE, e.ENCODED_DT,
              DATE(e.ENCODED_DT) AS d
       FROM expenses e
       WHERE e.BRANCH_ID = ? AND e.MASTER_CAT_ID = ? AND e.ACTIVE = 1
       ORDER BY e.ENCODED_DT DESC, e.IDNo DESC`,
      [branchId, cat.IDNo]
    );

    const byName = new Map();
    const byClass = { food: [], nonfood: [], ambiguous: [], unknown: [] };
    let foodAmt = 0;
    let nonfoodAmt = 0;
    let ambAmt = 0;
    let unkAmt = 0;

    for (const r of rows) {
      const name = String(r.EXP_DESC || '').trim() || '(blank)';
      const cls = classify(name);
      const amt = Number(r.EXP_AMOUNT) || 0;
      const key = name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, { name, cls, count: 0, amount: 0, sources: new Set(), samples: [] });
      }
      const agg = byName.get(key);
      agg.count += 1;
      agg.amount += amt;
      if (r.EXP_SOURCE) agg.sources.add(String(r.EXP_SOURCE));
      if (agg.samples.length < 3) agg.samples.push(String(r.d || ''));

      byClass[cls].push(r);
      if (cls === 'food') foodAmt += amt;
      else if (cls === 'nonfood') nonfoodAmt += amt;
      else if (cls === 'ambiguous') ambAmt += amt;
      else unkAmt += amt;
    }

    console.log(`Total expense rows: ${rows.length}`);
    console.log(`Unique item names: ${byName.size}`);
    console.log(
      `Heuristic class counts (rows): food=${byClass.food.length}, nonfood=${byClass.nonfood.length}, ambiguous=${byClass.ambiguous.length}, unknown=${byClass.unknown.length}`
    );
    console.log(
      `Heuristic amounts: food=${foodAmt.toFixed(2)}, nonfood=${nonfoodAmt.toFixed(2)}, ambiguous=${ambAmt.toFixed(2)}, unknown=${unkAmt.toFixed(2)}\n`
    );

    const ranked = [...byName.values()].sort((a, b) => b.amount - a.amount);

    console.log('=== Likely FOOD items still under Operation › Supplies (top by amount) ===');
    ranked
      .filter((x) => x.cls === 'food')
      .slice(0, 40)
      .forEach((x) => {
        console.log(
          `  ${x.name.padEnd(28)} cnt=${String(x.count).padStart(3)} sum=${x.amount.toFixed(2).padStart(12)} src=[${[...x.sources].join(',')}]`
        );
      });

    console.log('\n=== Likely NON-FOOD supplies (top by amount) ===');
    ranked
      .filter((x) => x.cls === 'nonfood')
      .slice(0, 40)
      .forEach((x) => {
        console.log(
          `  ${x.name.padEnd(28)} cnt=${String(x.count).padStart(3)} sum=${x.amount.toFixed(2).padStart(12)} src=[${[...x.sources].join(',')}]`
        );
      });

    console.log('\n=== UNKNOWN / needs manual review (top by amount) ===');
    ranked
      .filter((x) => x.cls === 'unknown' || x.cls === 'ambiguous')
      .slice(0, 50)
      .forEach((x) => {
        console.log(
          `  [${x.cls}] ${x.name.padEnd(28)} cnt=${String(x.count).padStart(3)} sum=${x.amount.toFixed(2).padStart(12)} src=[${[...x.sources].join(',')}]`
        );
      });

    // Aug 2026 window like the UI screenshot
    const [aug] = await pool.execute(
      `SELECT e.EXP_DESC, COUNT(*) cnt, SUM(e.EXP_AMOUNT) amt
       FROM expenses e
       WHERE e.BRANCH_ID = ? AND e.MASTER_CAT_ID = ? AND e.ACTIVE = 1
         AND e.ENCODED_DT >= '2026-08-01' AND e.ENCODED_DT < '2026-08-18'
       GROUP BY e.EXP_DESC
       ORDER BY amt DESC`,
      [branchId, cat.IDNo]
    );
    console.log(`\n=== Aug 1–17 2026 unique items in this category: ${aug.length} ===`);
    let augFood = 0;
    let augNon = 0;
    for (const r of aug) {
      const cls = classify(r.EXP_DESC);
      if (cls === 'food') augFood += 1;
      if (cls === 'nonfood') augNon += 1;
    }
    console.log(`Aug window heuristic: food-like names=${augFood}, nonfood-like=${augNon}, other=${aug.length - augFood - augNon}`);
    console.log('\nAug items:');
    for (const r of aug.slice(0, 60)) {
      console.log(
        `  [${classify(r.EXP_DESC).padEnd(8)}] ${String(r.EXP_DESC || '').padEnd(28)} cnt=${r.cnt} sum=${Number(r.amt).toFixed(2)}`
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
