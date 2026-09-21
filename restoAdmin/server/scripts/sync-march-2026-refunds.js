const loyverseService = require('../utils/loyverseService');

async function run() {
  const branchId = 2;
  // Use full-month range so totals line up with Loyverse "Mar 1 - Mar 31" report.
  const createdAtMin = '2026-03-01T00:00:00.000+08:00';
  const createdAtMax = '2026-03-31T23:59:59.999+08:00';
  const limit = 250;

  console.log('[Manual Sync] Starting March 2026 range sync', {
    branchId,
    created_at_min: createdAtMin,
    created_at_max: createdAtMax,
    limit,
  });

  const stats = await loyverseService.syncDateRange(branchId, limit, {
    created_at_min: createdAtMin,
    created_at_max: createdAtMax,
  });

  console.log('[Manual Sync] Completed', stats);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Manual Sync] Failed:', err?.message || err);
    process.exit(1);
  });
