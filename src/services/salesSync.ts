// Branch-wide paid sales for the Total Sales info-panel widget, via this
// project's own backend (server/index.ts /api/admin/sales), which reads
// restoAdmin's billing stats. The date range for each period is worked out
// server-side in Manila time.

import { useEffect, useState } from 'react';
import { subscribeToOrderUpdates } from './orderSync';
import { adminFetch } from './auth';

export type SalesPeriod = 'today' | 'yesterday' | 'week' | 'month';

export const SALES_PERIODS: { value: SalesPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yest.' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export interface SalesSummary {
  period: SalesPeriod;
  startDate: string;
  endDate: string;
  totalPaid: number;
  paidCount: number;
}

async function fetchSalesJson(path: string) {
  const res = await adminFetch(path);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || 'Failed to load sales from restoAdmin');
  }
  return json.data;
}

export function getSales(period: SalesPeriod): Promise<SalesSummary> {
  return fetchSalesJson(`/api/admin/sales?period=${period}`);
}

// Backup refresh, for payments that don't send an order event.
const SALES_POLL_MS = 60_000;
// Several order events tend to arrive together (items, status, table); one
// refetch after they settle is enough.
const SALES_EVENT_DEBOUNCE_MS = 1_000;

// Loads sales for a period and keeps them current: refetches after any
// order event and every minute as a fallback. `data` is only ever the
// selected period's — never the previous period's while the new one loads.
// `error` means the latest attempt failed (the last good data is kept).
export function useLiveSales<T extends { period: SalesPeriod }>(
  load: (period: SalesPeriod) => Promise<T>,
  period: SalesPeriod
): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      load(period)
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };
    refresh();

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToOrderUpdates(() => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, SALES_EVENT_DEBOUNCE_MS);
    });
    const poll = setInterval(refresh, SALES_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(poll);
      unsubscribe();
    };
  }, [load, period]);

  return { data: data?.period === period ? data : null, error };
}
