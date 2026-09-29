import { getManilaMonthToDateRange } from './manilaDateTime';
import { createTwoTierCache } from './twoTierCache';

type AnalyticsReportKind = 'menu' | 'category' | 'payment' | 'receipt';

const reportCache = (report: AnalyticsReportKind) =>
  createTwoTierCache<unknown>({
    sessionKey: `resto_${report}_report_cache_v1`,
    localKey: `resto_${report}_report_cache_v1_local`,
    maxEntries: 10,
  });

const CACHES: Record<AnalyticsReportKind, ReturnType<typeof reportCache>> = {
  menu: reportCache('menu'),
  category: reportCache('category'),
  payment: reportCache('payment'),
  receipt: reportCache('receipt'),
};

const LOCAL_CACHE_TTL_MS = 30 * 1000;
const STALE_LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;

export function buildAnalyticsReportCacheKey(
  prefix: string,
  params: {
    start: string;
    end: string;
    branchId: string | null;
    extra?: string;
  },
): string {
  const branch = params.branchId ?? 'all';
  const extra = params.extra ? `|${params.extra}` : '';
  return `${prefix}:${params.start}|${params.end}|${branch}${extra}`;
}

export function readAnalyticsReportCache<T>(report: AnalyticsReportKind, key: string): T | null {
  return CACHES[report].read(key, LOCAL_CACHE_TTL_MS) as T | null;
}

export function readAnalyticsReportCacheIncludingStale<T>(
  report: AnalyticsReportKind,
  key: string,
): T | null {
  return CACHES[report].read(key, STALE_LOCAL_CACHE_TTL_MS) as T | null;
}

export function writeAnalyticsReportCache<T>(
  report: AnalyticsReportKind,
  key: string,
  data: T,
): void {
  CACHES[report].write(key, data);
}

export function hasNonEmptyRows<T extends { totalSales?: number; netAmount?: number; total?: number }>(
  rows: T[] | null | undefined,
  valueKey: 'totalSales' | 'netAmount' | 'total' = 'totalSales',
): boolean {
  if (!rows?.length) return false;
  return rows.some((r) => Number(r[valueKey] ?? 0) !== 0 || rows.length > 1);
}

export function getCurrentMonthRange(): { start: string; end: string } {
  return getManilaMonthToDateRange();
}
