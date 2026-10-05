import React, { useState } from 'react';
import { TableRoom, AdminOrderSummary } from '../types';
import {
  confirmOrder,
  cancelOrder,
  formatOrderType,
  formatItemCount,
  groupOrderLines,
  MAX_LISTED_ORDER_ITEMS,
} from '../services/orderSync';
import { getStatusColors } from '../utils/statusColors';
import { zoneKindLabel } from '../utils/zoneLabels';
import {
  getRoomTiming,
  getTimerTone,
  formatDuration,
  formatHours,
  formatWait,
  useNow,
  TIMER_TEXT_CLASS,
} from '../utils/roomTimer';
import { SettlePaymentModal } from './SettlePaymentModal';
import { UtensilsCrossed, Check, Ban, Wallet, CheckCircle2 } from 'lucide-react';

interface OrderQueueViewProps {
  tables: TableRoom[];
  onOrderChanged: (tableId: string, order: AdminOrderSummary | undefined) => void;
  onSelectTable: (table: TableRoom) => void;
  currentFloor: 1 | 2;
  onSelectFloor: (floor: 1 | 2) => void;
}

type FloorFilter = 'all' | 1 | 2;
const FLOORS: (1 | 2)[] = [1, 2];
const FLOOR_LABEL: Record<1 | 2, string> = { 1: '1st Floor', 2: '2nd Floor' };

const peso = (n: number) => `₱${n.toFixed(2)}`;

// Pending(3)/Confirmed(2) — the orders that still need action here.
// Settled/Cancelled orders aren't "active" (see App.tsx).
const hasActiveOrder = (t: TableRoom) =>
  !!t.activeOrder && (t.activeOrder.status === 2 || t.activeOrder.status === 3);

// Oldest order first, like a queue: the table that's waited longest is the
// first one to deal with. Orders whose start time isn't known yet go last.
const orderStartMs = (t: TableRoom) => {
  const ms = t.activeOrder?.createdAt ? Date.parse(t.activeOrder.createdAt) : NaN;
  return Number.isFinite(ms) ? ms : Infinity;
};

type BreakdownRow = { key: string; label: React.ReactNode; amount: number; muted?: boolean };

// The card's receipt: room charge, up to MAX_LISTED_ORDER_ITEMS item rows,
// "+N more items" carrying the rest of the items' amount, and whatever else
// restoAdmin's total holds (tax, discounts) — so the rows always add up to
// the total shown under them, with nothing priced left out.
function orderBreakdown(order: AdminOrderSummary, roomRate: number): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const serviceCharge = order.serviceCharge ?? 0;
  if (serviceCharge > 0) {
    // Booked hours, the same derivation as the order detail's stepper.
    const hours = roomRate > 0 ? Math.max(1, Math.round((serviceCharge / roomRate) * 2) / 2) : 0;
    rows.push({
      key: 'room',
      label: roomRate > 0 ? `Room charge · ${formatHours(hours)}` : 'Service charge',
      amount: serviceCharge,
    });
  }

  const lines = groupOrderLines(order.items);
  for (const line of lines.slice(0, MAX_LISTED_ORDER_ITEMS)) {
    rows.push({
      key: `item-${line.menuId}`,
      label: (
        <>
          <span className="text-slate-400 tabular-nums">{line.quantity}×</span> {line.name}
        </>
      ),
      amount: line.lineTotal,
    });
  }
  const hidden = lines.slice(MAX_LISTED_ORDER_ITEMS);
  if (hidden.length > 0) {
    rows.push({
      key: 'more',
      label: `+${hidden.length} more item${hidden.length === 1 ? '' : 's'}`,
      amount: hidden.reduce((sum, l) => sum + l.lineTotal, 0),
      muted: true,
    });
  }

  const itemsTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const other = order.grandTotal - itemsTotal - serviceCharge;
  if (Math.abs(other) >= 0.005) {
    rows.push({ key: 'other', label: other > 0 ? 'Tax & other charges' : 'Discount', amount: other, muted: true });
  }
  return rows;
}

export const OrderQueueView: React.FC<OrderQueueViewProps> = ({
  tables,
  onOrderChanged,
  onSelectTable,
  currentFloor,
  onSelectFloor,
}) => {
  const [filterFloor, setFilterFloor] = useState<FloorFilter>(currentFloor);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [settlingTable, setSettlingTable] = useState<TableRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allActive = tables.filter(hasActiveOrder);
  const countOnFloor = (floor: FloorFilter) =>
    floor === 'all' ? allActive.length : allActive.filter((t) => t.floor === floor).length;

  const activeTables = allActive
    .filter((t) => filterFloor === 'all' || t.floor === filterFloor)
    .sort((a, b) => orderStartMs(a) - orderStartMs(b));

  // Ticks every second for the room countdowns and "opened … ago".
  const nowMs = useNow(activeTables.length > 0);

  const selectFloor = (floor: FloorFilter) => {
    setFilterFloor(floor);
    if (floor !== 'all') onSelectFloor(floor);
  };

  const handleConfirm = async (table: TableRoom) => {
    const order = table.activeOrder;
    if (!order) return;
    setActionLoadingId(table.id);
    setError(null);
    try {
      const result = await confirmOrder(order.id);
      if (result.ok) {
        onOrderChanged(table.id, { ...order, status: 2 });
      } else {
        setError(result.message || 'Failed to confirm order');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to confirm order');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (table: TableRoom) => {
    const order = table.activeOrder;
    if (!order) return;
    setActionLoadingId(table.id);
    setError(null);
    try {
      const result = await cancelOrder(order.id);
      if (result.ok) {
        onOrderChanged(table.id, undefined);
        setCancelConfirmId(null);
      } else {
        setError(result.message || 'Failed to cancel order');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel order');
    } finally {
      setActionLoadingId(null);
    }
  };

  const renderCard = (table: TableRoom) => {
    const order = table.activeOrder as AdminOrderSummary;
    const isLoading = actionLoadingId === table.id;
    const roomRate = order.roomRate || table.adminRoomCharge || 0;
    const timing = getRoomTiming({ ...order, roomRate }, nowMs);
    const startMs = orderStartMs(table);
    const rows = orderBreakdown(order, roomRate);

    return (
      <div
        key={table.id}
        className="h-full p-5 rounded-3xl bg-[#15172b]/90 border border-white/10 shadow-xl flex flex-col"
      >
        {/* Header — same as an All Tables & Rooms card */}
        <button type="button" onClick={() => onSelectTable(table)} className="text-left group">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 min-h-10 flex flex-col justify-center">
              <h3 className="font-bold text-white text-sm truncate group-hover:text-indigo-400 transition-colors">
                {table.name}
              </h3>
              <span className="text-[10px] text-slate-400 truncate">
                Floor {table.floor} • {zoneKindLabel(table)}
                {timing && (
                  <>
                    {' • '}
                    <span className={`font-mono font-semibold tabular-nums ${TIMER_TEXT_CLASS[getTimerTone(timing)]}`}>
                      {timing.expired
                        ? `Expired · ${formatDuration(timing.remainingMs)} over`
                        : `${formatDuration(timing.remainingMs)} left`}
                    </span>
                  </>
                )}
              </span>
            </div>
            <span
              className={`shrink-0 text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${getStatusColors(table.status).activeButtonClass}`}
            >
              {getStatusColors(table.status).label}
            </span>
          </div>
        </button>

        <div className="mt-2 text-xs text-slate-300 truncate">
          {formatOrderType(order.orderType)} • {formatItemCount(groupOrderLines(order.items).length)}
          {Number.isFinite(startMs) && (
            <span className="text-slate-500">
              {' • '}
              {formatWait(nowMs - startMs) === 'just now' ? 'opened just now' : `opened ${formatWait(nowMs - startMs)} ago`}
            </span>
          )}
        </div>

        {/* Receipt */}
        <div className="mt-3 pt-3 border-t border-white/10 space-y-1 text-xs">
          {rows.length === 0 ? (
            <div className="text-slate-500">No items yet.</div>
          ) : (
            rows.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3">
                <span className={`min-w-0 truncate ${r.muted ? 'text-slate-400 italic' : 'text-slate-200'}`}>{r.label}</span>
                <span className={`shrink-0 font-mono tabular-nums ${r.muted ? 'text-slate-400' : 'text-slate-300'}`}>
                  {r.amount < 0 ? `−${peso(-r.amount)}` : peso(r.amount)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-white/10 flex items-baseline justify-between">
          <span className="text-xs text-slate-400">Total</span>
          <span className="text-sm text-white font-mono font-bold tabular-nums">{peso(order.grandTotal)}</span>
        </div>

        {/* Actions — pinned to the bottom so they line up across a row */}
        <div className="mt-auto pt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {cancelConfirmId === table.id ? (
              <>
                <span className="text-[11px] text-rose-300">Cancel order?</span>
                <button
                  onClick={() => handleCancel(table)}
                  disabled={isLoading}
                  className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1"
                >
                  <Ban className="w-3.5 h-3.5" /> Confirm
                </button>
                <button
                  onClick={() => setCancelConfirmId(null)}
                  className="px-2 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-xs"
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setCancelConfirmId(table.id)}
                  className="px-2.5 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-semibold"
                >
                  Cancel
                </button>

                {/* Only for a Pending order from restoAdmin — dashboard orders are confirmed on creation. */}
                {order.status === 3 && (
                  <button
                    onClick={() => handleConfirm(table)}
                    disabled={isLoading}
                    className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Confirm
                  </button>
                )}

                {order.status === 2 && (
                  <button
                    onClick={() => setSettlingTable(table)}
                    className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-md shadow-emerald-600/20"
                  >
                    <Wallet className="w-3.5 h-3.5" /> Settle
                  </button>
                )}
              </>
            )}
          </div>

          {cancelConfirmId !== table.id && (
            <button
              onClick={() => onSelectTable(table)}
              className="shrink-0 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
            >
              View Order &rarr;
            </button>
          )}
        </div>
      </div>
    );
  };

  // Empty for this floor while the other floor has orders: say so, rather
  // than an "All Clear" that reads as if nothing's open anywhere.
  const otherFloors = filterFloor === 'all' ? [] : FLOORS.filter((f) => f !== filterFloor && countOnFloor(f) > 0);

  return (
    <div id="order-queue-view" className="flex-1 h-screen overflow-y-auto bg-gradient-to-br from-[#0c0d1c] via-[#14122d] to-[#1e1542] p-8 text-slate-100 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <UtensilsCrossed className="w-6 h-6 text-amber-400" />
            Active Orders
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Open orders, longest-waiting first. Confirm, cancel or settle them right here.
          </p>
        </div>

        {/* Floor filter — same control as All Tables & Rooms */}
        <div className="flex items-center gap-1.5 bg-[#16182a] p-1 rounded-2xl border border-white/10">
          {(['all', ...FLOORS] as FloorFilter[]).map((floor) => (
            <button
              key={floor}
              onClick={() => selectFloor(floor)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterFloor === floor ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              {floor === 'all' ? 'All Floors' : FLOOR_LABEL[floor]}
              <span className="tabular-nums opacity-70">{countOnFloor(floor)}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
          {error}
        </div>
      )}

      {activeTables.length === 0 ? (
        <div className="mt-8 p-16 rounded-3xl bg-white/[0.02] border border-dashed border-white/10 text-center flex flex-col items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
          {otherFloors.length > 0 ? (
            <>
              <h3 className="text-lg font-bold text-white">No active orders on the {FLOOR_LABEL[filterFloor as 1 | 2]}</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                {otherFloors.map((f) => `${countOnFloor(f)} on the ${FLOOR_LABEL[f]}`).join(' · ')}.
              </p>
              <button
                onClick={() => selectFloor('all')}
                className="mt-4 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
              >
                Show all floors
              </button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-white">All Clear! No Orders Need Action</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">New orders will appear here as soon as they're placed.</p>
            </>
          )}
        </div>
      ) : (
        // All Floors groups cards under floor headings, like All Tables &
        // Rooms; each floor keeps its own oldest-first order.
        <div className="space-y-8 mt-6">
          {(filterFloor === 'all' ? FLOORS : [filterFloor])
            .map((floor) => ({ floor, tables: activeTables.filter((t) => t.floor === floor) }))
            .filter((g) => g.tables.length > 0)
            .map((g) => (
              <section key={g.floor}>
                {filterFloor === 'all' && (
                  <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    {FLOOR_LABEL[g.floor]}
                    <span className="text-xs font-normal text-slate-500 tabular-nums">{g.tables.length}</span>
                  </h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {g.tables.map(renderCard)}
                </div>
              </section>
            ))}
        </div>
      )}

      {settlingTable && settlingTable.activeOrder && (
        <SettlePaymentModal
          orderId={settlingTable.activeOrder.id}
          table={settlingTable}
          onClose={() => setSettlingTable(null)}
          onSettled={() => onOrderChanged(settlingTable.id, undefined)}
        />
      )}
    </div>
  );
};
