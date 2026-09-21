// Only Blue Moon (branch IDNo 3) and 3Core (branch IDNo 4) are multi-floor
// locations today. Every other branch has a single floor, so the floor
// pickers in Table Settings / Orders stay hidden for them and their tables'
// FLOOR column is left null.
export const FLOOR_ENABLED_BRANCH_IDS = new Set(['3', '4']);

export const isFloorEnabledBranch = (
  branchId: string | number | null | undefined
): boolean => branchId != null && FLOOR_ENABLED_BRANCH_IDS.has(String(branchId));

export type TableFloor = 'gf' | '2f';
