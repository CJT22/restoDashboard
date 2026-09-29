import type { OrderRecord } from '../services/orderService';
import { createTwoTierCache } from './twoTierCache';

export type BranchDashboardStats = {
  totalOrders: number;
  totalSales: number;
  totalExpenses: number;
  totalProfit: number;
};

export type BranchDashboardRevenuePoint = {
  name: string;
  date?: string;
  income: number;
  expense: number;
};

export type BranchDashboardTrendingMenu = {
  key: string;
  name: string;
  category: string;
  totalQty: number;
  netSales: number;
  image: string;
};

export type BranchDashboardCachePayload = {
  dashboardData: {
    stats: BranchDashboardStats;
    revenueData: BranchDashboardRevenuePoint[];
    ordersOverview: { name: string; orders: number; date?: string }[];
  } | null;
  topCategories: { name: string; value: number; color: string }[];
  trendingMenusData: BranchDashboardTrendingMenu[];
  recentOrders: OrderRecord[];
  recentOrderItemsMeta: Record<string, { lineCount: number; totalQty: number }>;
};

const cache = createTwoTierCache<BranchDashboardCachePayload>({
  sessionKey: 'resto_branch_dashboard_cache_v1',
  localKey: 'resto_branch_dashboard_cache_v1_local',
  maxEntries: 12,
});

const EMPTY_MARKER_KEY = 'resto_branch_dashboard_empty_v1';
/** Short TTL — keep branch KPIs aligned across users. */
const LOCAL_CACHE_TTL_MS = 30 * 1000;
/** Instant paint only; Dashboard always revalidates on mount. */
const STALE_LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;
/** Tiny dedupe window after prefetch; otherwise always refresh. */
export const BRANCH_DASHBOARD_BG_REFRESH_TTL_MS = 10 * 1000;

const EMPTY_PAYLOAD: BranchDashboardCachePayload = {
  dashboardData: null,
  topCategories: [],
  trendingMenusData: [],
  recentOrders: [],
  recentOrderItemsMeta: {},
};

function payloadFromEntry(entry: BranchDashboardCachePayload): BranchDashboardCachePayload {
  return {
    ...EMPTY_PAYLOAD,
    ...entry,
    recentOrderItemsMeta: entry.recentOrderItemsMeta ?? {},
  };
}

export function buildBranchDashboardCacheKey(params: {
  branchId: string;
  start: string;
  end: string;
}): string {
  return `bd:${params.branchId}|${params.start}|${params.end}`;
}

export function hasBranchDashboardCacheData(
  cached: BranchDashboardCachePayload | null,
): cached is BranchDashboardCachePayload {
  if (!cached) return false;
  if (isBranchDashboardPayloadIncomplete(cached)) return false;
  const stats = cached.dashboardData?.stats;
  const hasStats =
    !!stats &&
    (stats.totalOrders > 0 ||
      stats.totalSales > 0 ||
      stats.totalExpenses > 0 ||
      (cached.dashboardData?.revenueData?.length ?? 0) > 0);
  return (
    hasStats ||
    cached.topCategories.length > 0 ||
    cached.trendingMenusData.length > 0 ||
    cached.recentOrders.length > 0
  );
}

/**
 * Sales present but companion widgets empty — usually Py timeouts under load.
 * Do not treat as a valid cache hit (would stick Total Orders / Expenses at 0).
 */
export function isBranchDashboardPayloadIncomplete(
  payload: BranchDashboardCachePayload | null,
): boolean {
  if (!payload) return false;
  const stats = payload.dashboardData?.stats;
  const totalSales = Number(stats?.totalSales) || 0;
  const hasRevenue = (payload.dashboardData?.revenueData?.length ?? 0) > 0;
  if (totalSales <= 0 && !hasRevenue) return false;

  const totalOrders = Number(stats?.totalOrders) || 0;
  const totalExpenses = Number(stats?.totalExpenses) || 0;
  if (totalOrders <= 0) return true;
  if (totalExpenses <= 0) return true;
  return false;
}

export function isBranchDashboardPayloadEmpty(payload: BranchDashboardCachePayload): boolean {
  const stats = payload.dashboardData?.stats;
  const statsEmpty =
    !stats ||
    (stats.totalOrders === 0 &&
      stats.totalSales === 0 &&
      stats.totalExpenses === 0 &&
      stats.totalProfit === 0);
  return (
    statsEmpty &&
    (payload.dashboardData?.revenueData?.length ?? 0) === 0 &&
    payload.topCategories.length === 0 &&
    payload.trendingMenusData.length === 0 &&
    payload.recentOrders.length === 0
  );
}

type EmptyMarkerStore = Record<string, number>;

export function isKnownEmptyBranch(key: string): boolean {
  try {
    const raw = sessionStorage.getItem(EMPTY_MARKER_KEY);
    if (!raw) return false;
    const store = JSON.parse(raw) as EmptyMarkerStore;
    return store[key] != null;
  } catch {
    return false;
  }
}

export function markKnownEmptyBranch(key: string): void {
  try {
    const raw = sessionStorage.getItem(EMPTY_MARKER_KEY);
    const store: EmptyMarkerStore = raw ? (JSON.parse(raw) as EmptyMarkerStore) : {};
    store[key] = Date.now();
    sessionStorage.setItem(EMPTY_MARKER_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function clearKnownEmptyBranch(key: string): void {
  try {
    const raw = sessionStorage.getItem(EMPTY_MARKER_KEY);
    if (!raw) return;
    const store = JSON.parse(raw) as EmptyMarkerStore;
    delete store[key];
    sessionStorage.setItem(EMPTY_MARKER_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

const isCompleteEntry = (entry: BranchDashboardCachePayload) =>
  !isBranchDashboardPayloadIncomplete(payloadFromEntry(entry));

export function readBranchDashboardCache(key: string): BranchDashboardCachePayload | null {
  const entry = cache.read(key, LOCAL_CACHE_TTL_MS, isCompleteEntry);
  return entry ? payloadFromEntry(entry) : null;
}

/** Fresh session cache, or local cache up to STALE_LOCAL_CACHE_TTL_MS. */
export function readBranchDashboardCacheIncludingStale(
  key: string,
): BranchDashboardCachePayload | null {
  const entry = cache.read(key, STALE_LOCAL_CACHE_TTL_MS, isCompleteEntry);
  return entry ? payloadFromEntry(entry) : null;
}

export function getBranchDashboardCacheAgeMs(key: string): number | null {
  return cache.ageMs(key);
}

export function isBranchDashboardCacheFresh(
  key: string,
  maxAgeMs: number = BRANCH_DASHBOARD_BG_REFRESH_TTL_MS,
): boolean {
  const age = getBranchDashboardCacheAgeMs(key);
  return age != null && age < maxAgeMs;
}

export function writeBranchDashboardCache(key: string, data: BranchDashboardCachePayload): void {
  cache.write(key, data);
}

export function patchBranchDashboardCache(
  key: string,
  patch: Partial<BranchDashboardCachePayload>,
): void {
  const existing = readBranchDashboardCacheIncludingStale(key) ?? readBranchDashboardCache(key);
  const base = existing ?? EMPTY_PAYLOAD;
  writeBranchDashboardCache(key, {
    ...base,
    ...patch,
    topCategories:
      patch.topCategories && patch.topCategories.length > 0 ? patch.topCategories : base.topCategories,
    trendingMenusData:
      patch.trendingMenusData && patch.trendingMenusData.length > 0
        ? patch.trendingMenusData
        : base.trendingMenusData,
    recentOrders:
      patch.recentOrders && patch.recentOrders.length > 0 ? patch.recentOrders : base.recentOrders,
    recentOrderItemsMeta: patch.recentOrderItemsMeta ?? base.recentOrderItemsMeta,
    dashboardData: patch.dashboardData ?? base.dashboardData,
  });
}
