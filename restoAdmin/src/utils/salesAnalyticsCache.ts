import type { ApiBranchSalesItem, ApiDailySalesItem, ApiMenuReportRow } from '../services/analyticsService';
import { createTwoTierCache } from './twoTierCache';

export type SalesAnalyticsProfitDriver = {
  row: ApiMenuReportRow;
  profit: number;
  branchId: number | null;
  branchName: string;
};

export type SalesAnalyticsCachePayload = {
  dailySalesCurrent: ApiDailySalesItem[];
  dailySalesPrevious: ApiDailySalesItem[];
  branchSalesData: ApiBranchSalesItem[];
  profitDriversData: SalesAnalyticsProfitDriver[];
  reconAdjustCurrent: { byDate: Record<string, number>; total: number };
  reconAdjustPreviousTotal: number;
};

const cache = createTwoTierCache<SalesAnalyticsCachePayload>({
  sessionKey: 'resto_sales_analytics_cache_v1',
  localKey: 'resto_sales_analytics_cache_v1_local',
  maxEntries: 10,
});

const LOCAL_CACHE_TTL_MS = 30 * 1000;
const STALE_LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;

const EMPTY_PAYLOAD: SalesAnalyticsCachePayload = {
  dailySalesCurrent: [],
  dailySalesPrevious: [],
  branchSalesData: [],
  profitDriversData: [],
  reconAdjustCurrent: { byDate: {}, total: 0 },
  reconAdjustPreviousTotal: 0,
};

function payloadFromEntry(entry: SalesAnalyticsCachePayload): SalesAnalyticsCachePayload {
  return {
    ...EMPTY_PAYLOAD,
    ...entry,
    reconAdjustCurrent: entry.reconAdjustCurrent ?? { byDate: {}, total: 0 },
  };
}

export function buildSalesAnalyticsCacheKey(params: {
  start: string;
  end: string;
  branchId: string | null;
}): string {
  return `sa:${params.start}|${params.end}|${params.branchId ?? 'all'}`;
}

export function hasSalesAnalyticsCacheData(
  cached: SalesAnalyticsCachePayload | null,
): cached is SalesAnalyticsCachePayload {
  if (!cached) return false;
  const hasDaily = cached.dailySalesCurrent.some(
    (d) => Number(d.total_sales ?? d.net_sales ?? 0) > 0,
  );
  const hasBranch = cached.branchSalesData.some((b) => Number(b.total_sales ?? 0) > 0);
  return hasDaily || hasBranch || cached.profitDriversData.length > 0;
}

export function hasSalesAnalyticsCoreData(cached: SalesAnalyticsCachePayload): boolean {
  const hasDaily = cached.dailySalesCurrent.some(
    (d) => Number(d.total_sales ?? d.net_sales ?? 0) > 0,
  );
  const hasBranch = cached.branchSalesData.some((b) => Number(b.total_sales ?? 0) > 0);
  return hasDaily || hasBranch;
}

export function readSalesAnalyticsCache(key: string): SalesAnalyticsCachePayload | null {
  const entry = cache.read(key, LOCAL_CACHE_TTL_MS);
  return entry ? payloadFromEntry(entry) : null;
}

export function readSalesAnalyticsCacheIncludingStale(
  key: string,
): SalesAnalyticsCachePayload | null {
  const entry = cache.read(key, STALE_LOCAL_CACHE_TTL_MS);
  return entry ? payloadFromEntry(entry) : null;
}

export function writeSalesAnalyticsCache(key: string, data: SalesAnalyticsCachePayload): void {
  if (!hasSalesAnalyticsCacheData(data)) return;
  cache.write(key, data);
}

export function patchSalesAnalyticsCache(
  key: string,
  patch: Partial<SalesAnalyticsCachePayload>,
): void {
  const existing = readSalesAnalyticsCacheIncludingStale(key) ?? readSalesAnalyticsCache(key);
  const base = existing ?? EMPTY_PAYLOAD;
  writeSalesAnalyticsCache(key, {
    ...base,
    ...patch,
    dailySalesCurrent:
      patch.dailySalesCurrent && patch.dailySalesCurrent.length > 0
        ? patch.dailySalesCurrent
        : base.dailySalesCurrent,
    dailySalesPrevious:
      patch.dailySalesPrevious && patch.dailySalesPrevious.length > 0
        ? patch.dailySalesPrevious
        : base.dailySalesPrevious,
    branchSalesData:
      patch.branchSalesData && patch.branchSalesData.length > 0
        ? patch.branchSalesData
        : base.branchSalesData,
    profitDriversData:
      patch.profitDriversData && patch.profitDriversData.length > 0
        ? patch.profitDriversData
        : base.profitDriversData,
    reconAdjustCurrent: patch.reconAdjustCurrent ?? base.reconAdjustCurrent,
    reconAdjustPreviousTotal:
      patch.reconAdjustPreviousTotal != null
        ? patch.reconAdjustPreviousTotal
        : base.reconAdjustPreviousTotal,
  });
}
