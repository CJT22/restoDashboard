import type { BranchPerformanceData } from '../components/dashboard/BranchPerformanceCard';
import { createTwoTierCache } from './twoTierCache';

export type AdminDashboardTrendPeriod = 'weekly' | 'monthly' | 'yearly';

export type AdminDashboardTrendPoint = {
  name: string;
  totalSales: number;
  totalExpenses: number;
  date?: string;
};

export type BranchChartsCacheEntry = {
  trendMonthly: AdminDashboardTrendPoint[];
  topProducts: { name: string; sales: number }[];
};

export type AdminDashboardCachePayload = {
  summary?: {
    totalSales: number;
    totalExpenses: number;
    totalRevenue: number;
  };
  branchCardsData: BranchPerformanceData[];
  branchRevenueDistribution: { name: string; value: number }[];
  topProductsData: { name: string; sales: number }[];
  expenseCategoryByBranch: Record<number, Record<string, number>>;
  expenseRentByBranch?: Record<number, number>;
  expenseSalaryByBranch?: Record<number, number>;
  trendByPeriod: Partial<Record<AdminDashboardTrendPeriod, AdminDashboardTrendPoint[]>>;
  /** Per-branch monthly trend + top products for instant branch-card focus. */
  branchChartsById?: Record<string, BranchChartsCacheEntry>;
};

const cache = createTwoTierCache<AdminDashboardCachePayload>({
  sessionKey: 'resto_admin_dashboard_cache_v1',
  localKey: 'resto_admin_dashboard_cache_v1_local',
  maxEntries: 10,
});

/** Short TTL — financial KPIs must not diverge across users for hours. */
const LOCAL_CACHE_TTL_MS = 30 * 1000;
/** Instant paint only; always revalidate on mount (see AdminDashboard). */
const STALE_LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Almost never skip refresh — live MTD sales change continuously.
 * Tiny window only avoids duplicate fetch right after prefetch write.
 */
export const ADMIN_DASHBOARD_BG_REFRESH_TTL_MS = 10 * 1000;

const EMPTY_PAYLOAD: AdminDashboardCachePayload = {
  branchCardsData: [],
  branchRevenueDistribution: [],
  topProductsData: [],
  expenseCategoryByBranch: {},
  trendByPeriod: {},
};

export function buildAdminDashboardCacheKey(params: {
  start: string;
  end: string;
  branchId: string | null;
}): string {
  return `ad:${params.start}|${params.end}|${params.branchId ?? 'all'}`;
}

export function hasAdminDashboardCacheData(
  cached: AdminDashboardCachePayload | null,
): cached is AdminDashboardCachePayload {
  if (!cached) return false;
  const hasTrend = Object.values(cached.trendByPeriod ?? {}).some((rows) => (rows?.length ?? 0) > 0);
  return (
    cached.branchCardsData.length > 0 ||
    cached.branchRevenueDistribution.length > 0 ||
    cached.topProductsData.length > 0 ||
    hasTrend
  );
}

function payloadFromEntry(entry: AdminDashboardCachePayload): AdminDashboardCachePayload {
  return {
    ...EMPTY_PAYLOAD,
    ...entry,
    trendByPeriod: entry.trendByPeriod ?? {},
  };
}

export function readAdminDashboardCache(key: string): AdminDashboardCachePayload | null {
  const entry = cache.read(key, LOCAL_CACHE_TTL_MS);
  return entry ? payloadFromEntry(entry) : null;
}

/** Fresh session cache, or local cache up to STALE_LOCAL_CACHE_TTL_MS (stale-while-revalidate). */
export function readAdminDashboardCacheIncludingStale(
  key: string,
): AdminDashboardCachePayload | null {
  const entry = cache.read(key, STALE_LOCAL_CACHE_TTL_MS);
  return entry ? payloadFromEntry(entry) : null;
}

/** Age of cached entry in ms, or null if missing. Checks session then local. */
export function getAdminDashboardCacheAgeMs(key: string): number | null {
  return cache.ageMs(key);
}

/** True when cache is young enough to skip a background network refresh. */
export function isAdminDashboardCacheFresh(
  key: string,
  maxAgeMs: number = ADMIN_DASHBOARD_BG_REFRESH_TTL_MS,
): boolean {
  const age = getAdminDashboardCacheAgeMs(key);
  return age != null && age < maxAgeMs;
}

export function writeAdminDashboardCache(key: string, data: AdminDashboardCachePayload): void {
  cache.write(key, data);
}

/** Merge partial updates without dropping other cached sections (e.g. trend vs branch cards). */
export function patchAdminDashboardCache(
  key: string,
  patch: Partial<Omit<AdminDashboardCachePayload, 'trendByPeriod'>> & {
    trendByPeriod?: Partial<Record<AdminDashboardTrendPeriod, AdminDashboardTrendPoint[]>>;
  },
): void {
  const existing = readAdminDashboardCacheIncludingStale(key) ?? readAdminDashboardCache(key);
  const base = existing ?? EMPTY_PAYLOAD;
  writeAdminDashboardCache(key, {
    ...base,
    ...patch,
    branchCardsData:
      patch.branchCardsData && patch.branchCardsData.length > 0
        ? patch.branchCardsData
        : base.branchCardsData,
    branchRevenueDistribution:
      patch.branchRevenueDistribution && patch.branchRevenueDistribution.length > 0
        ? patch.branchRevenueDistribution
        : base.branchRevenueDistribution,
    topProductsData:
      patch.topProductsData && patch.topProductsData.length > 0
        ? patch.topProductsData
        : base.topProductsData,
    expenseCategoryByBranch:
      patch.expenseCategoryByBranch && Object.keys(patch.expenseCategoryByBranch).length > 0
        ? patch.expenseCategoryByBranch
        : base.expenseCategoryByBranch,
    expenseRentByBranch:
      patch.expenseRentByBranch && Object.keys(patch.expenseRentByBranch).length > 0
        ? patch.expenseRentByBranch
        : base.expenseRentByBranch,
    expenseSalaryByBranch:
      patch.expenseSalaryByBranch && Object.keys(patch.expenseSalaryByBranch).length > 0
        ? patch.expenseSalaryByBranch
        : base.expenseSalaryByBranch,
    trendByPeriod: {
      ...base.trendByPeriod,
      ...(patch.trendByPeriod ?? {}),
    },
    branchChartsById: patch.branchChartsById
      ? { ...base.branchChartsById, ...patch.branchChartsById }
      : base.branchChartsById,
  });
}
