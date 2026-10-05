import React, { useEffect, useRef, useState } from 'react';
import { TableRoom, AdminOrderSummary } from '../types';
import {
  getActiveOrderForTable,
  addItemsToOrder,
  updateItemQty,
  deleteItem,
  confirmOrder,
  cancelOrder,
  updateOrderRoomCharge,
  formatOrderType,
  formatItemCount,
  groupOrderLines,
  OrderLineGroup,
  UpdateItemResult,
} from '../services/orderSync';
import { getAdminTables } from '../services/adminSync';
import { getStatusColors } from '../utils/statusColors';
import { zoneKindLabel } from '../utils/zoneLabels';
import { getRoomTiming, formatDuration, formatHours, formatClockTime, useNow, getTimerTone, TIMER_TEXT_CLASS, TimerTone } from '../utils/roomTimer';
import { NewOrderScreen } from './NewOrderScreen';
import { AddItemsScreen } from './AddItemsScreen';
import { QuickAddDrinks } from './QuickAddDrinks';
import { useMenuCatalog } from './OrderScreen';
import { CatalogItem } from '../services/menuCatalog';
import { SettlePaymentModal } from './SettlePaymentModal';
import { QtyStepper } from './QtyStepper';
import {
  X,
  Check,
  Users,
  UtensilsCrossed,
  Plus,
  AlertTriangle,
  Wallet,
  Ban,
  CalendarClock
} from 'lucide-react';

const roundToHalf = (v: number) => Math.round(v * 2) / 2;

// The room-timer row's background/border, tinted to match its countdown
// colour (see getTimerTone) so an ending or expired room stands out here too.
const TIMER_ROW_CLASS: Record<TimerTone, string> = {
  normal: 'bg-white/[0.03] border-white/5',
  endingSoon: 'bg-yellow-400/10 border-yellow-400/30',
  expired: 'bg-rose-500/10 border-rose-500/30',
};

interface TableDetailModalProps {
  table: TableRoom | null;
  onClose: () => void;
  // Applies an order-related change by table id, merging into the latest
  // state rather than a snapshot — see App.tsx's handleOrderChanged for why
  // a full-object replace isn't safe for these.
  onOrderChanged: (tableId: string, order: AdminOrderSummary | undefined) => void;
}

export const TableDetailModal: React.FC<TableDetailModalProps> = ({
  table,
  onClose,
  onOrderChanged,
}) => {
  if (!table) return null;

  const [, setLoadingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<any[] | null>(null);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { catalog } = useMenuCatalog();
  const [showAddItems, setShowAddItems] = useState(false);
  // The Quick Add Drinks tap being saved, so repeat taps can't race it.
  const [savingDrinkId, setSavingDrinkId] = useState<number | null>(null);
  // The item whose −/+ change is in flight, so repeat taps can't race it.
  const [savingItemId, setSavingItemId] = useState<number | null>(null);

  // This table's hourly room-charge rate (0 = no room charge), fetched on
  // demand — the dashboard equivalent of restoAdmin's own order-detail
  // room-charge stepper (Orders.tsx's saveDetailRoomChargeQty).
  const [roomChargeRate, setRoomChargeRate] = useState(0);
  const [roomChargeSaving, setRoomChargeSaving] = useState(false);

  // Real, admin-sourced order for this zone's linked table. Fetched here on
  // open and stored on the shared table via onOrderChanged, so OrderQueueView
  // and other views see the same data without re-fetching it themselves —
  // App.tsx's SSE subscription keeps it current after that.
  useEffect(() => {
    if (table.adminTableId == null) return;
    const tableId = table.id;
    let cancelled = false;
    setLoadingOrder(true);
    setOrderError(null);
    getActiveOrderForTable(table.adminTableId)
      .then((order) => {
        if (cancelled) return;
        onOrderChanged(tableId, order ?? undefined);
      })
      .catch((err: any) => {
        if (!cancelled) setOrderError(err.message || 'Failed to load the active order from restoAdmin');
      })
      .finally(() => {
        if (!cancelled) setLoadingOrder(false);
      });
    return () => {
      cancelled = true;
    };
    // Refetch only when the selected zone (or its admin link) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id, table.adminTableId]);

  useEffect(() => {
    if (table.adminTableId == null) return;
    let cancelled = false;
    getAdminTables()
      .then((tables) => {
        if (cancelled) return;
        const match = tables.find((t) => t.id === table.adminTableId);
        setRoomChargeRate(match?.roomCharge || 0);
      })
      .catch(() => {
        if (!cancelled) setRoomChargeRate(0);
      });
    return () => {
      cancelled = true;
    };
  }, [table.adminTableId]);

  const activeOrder = table.activeOrder;
  const orderItems = activeOrder?.items ?? [];
  const orderRows = groupOrderLines(orderItems);
  const tableId = table.id;

  // Derived from the order's current SERVICE_CHARGE (which already includes
  // the room charge — see AdminOrderSummary.serviceCharge) and this table's
  // rate; re-derives automatically whenever the order refreshes.
  const roomChargeQty =
    roomChargeRate > 0 ? Math.max(1, Math.round(((activeOrder?.serviceCharge ?? 0) / roomChargeRate) * 2) / 2) : 0;

  // Hourly room countdown, same as the map zone's (src/utils/roomTimer.ts).
  // Falls back to this modal's own fetched rate if the order doesn't carry one.
  const timedOrder = activeOrder ? { ...activeOrder, roomRate: activeOrder.roomRate || roomChargeRate } : undefined;
  const nowMs = useNow(getRoomTiming(timedOrder, 0) != null);
  const timing = getRoomTiming(timedOrder, nowMs);

  // Once this zone has shown an order, that order going away (cancelled,
  // settled — here or from restoAdmin) closes the modal back to the map
  // rather than falling through to the New Order form below.
  const hadOrderRef = useRef(false);
  useEffect(() => {
    if (activeOrder) hadOrderRef.current = true;
    else if (hadOrderRef.current) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder]);

  const refreshOrder = async () => {
    if (table.adminTableId == null) return;
    const order = await getActiveOrderForTable(table.adminTableId);
    onOrderChanged(tableId, order ?? undefined);
  };

  const handleRoomChargeChange = async (nextQty: number) => {
    if (!activeOrder || roomChargeRate <= 0 || roomChargeSaving) return;
    setRoomChargeSaving(true);
    setOrderError(null);
    try {
      const result = await updateOrderRoomCharge(activeOrder.id, roundToHalf(Math.max(1, nextQty)));
      if (result.ok) {
        await refreshOrder();
      } else {
        setOrderError(result.message || 'Failed to update room charge');
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to update room charge');
    } finally {
      setRoomChargeSaving(false);
    }
  };

  // One row per menu item, however many lines restoAdmin holds for it (see
  // groupOrderLines). A ±1 acts on the row's newest line, leaving older ones
  // (often already prepared) alone; a newest line down to its last unit is
  // deleted instead, so the row drops by one and its other lines keep theirs.
  // Callers hold the lock and clear the alerts.
  const stepRow = async (group: OrderLineGroup, delta: 1 | -1) => {
    const newest = group.lines[group.lines.length - 1];
    const result: UpdateItemResult =
      delta < 0 && newest.quantity <= 1
        ? await deleteItem(newest.id)
        : await updateItemQty(newest.id, newest.quantity + delta);
    if (result.ok) {
      await refreshOrder();
    } else if (result.kind === 'insufficient') {
      setInsufficient(result.insufficient ?? []);
    } else {
      setOrderError(result.message || 'Failed to update item');
    }
  };

  // −/+ on an item row: saves each step straight to restoAdmin, like the
  // room-charge stepper. Minimum 1 — removing is the trash button's job.
  const handleRowStep = async (group: OrderLineGroup, delta: 1 | -1) => {
    if (savingItemId != null || savingDrinkId != null) return;
    if (delta < 0 && group.quantity <= 1) return;
    setSavingItemId(group.id);
    setOrderError(null);
    setInsufficient(null);
    try {
      await stepRow(group, delta);
    } catch (err: any) {
      setOrderError(err.message || 'Failed to update item');
    } finally {
      setSavingItemId(null);
    }
  };

  // Trash removes the item entirely: every line it has on the order.
  const handleDeleteRow = async (group: OrderLineGroup) => {
    if (savingItemId != null || savingDrinkId != null) return;
    setSavingItemId(group.id);
    setOrderError(null);
    try {
      for (const line of group.lines) {
        const result = await deleteItem(line.id);
        if (!result.ok) {
          setOrderError(result.message || 'Failed to delete item');
          break;
        }
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to delete item');
    } finally {
      // Also after a partial failure, so the rows show what's really left.
      await refreshOrder().catch(() => {});
      setSavingItemId(null);
    }
  };

  // A Quick Add Drinks tap saves straight to restoAdmin, for a table's next
  // round without opening Add Items. A drink already on the order goes on its
  // row the same way as that row's +, rather than adding a new line per tap.
  const handleQuickDrink = async (drink: CatalogItem) => {
    if (!activeOrder || savingDrinkId != null || savingItemId != null) return;
    const existing = orderRows.find((row) => row.menuId === drink.id);
    setSavingDrinkId(drink.id);
    setOrderError(null);
    setInsufficient(null);
    try {
      if (existing) {
        await stepRow(existing, 1);
        return;
      }
      const result = await addItemsToOrder(activeOrder.id, [{ menuId: drink.id, qty: 1, unitPrice: drink.price }]);
      if (result.ok) {
        await refreshOrder();
      } else if (result.kind === 'insufficient') {
        setInsufficient(result.insufficient ?? []);
      } else {
        setOrderError(result.message || `Failed to add ${drink.name}`);
      }
    } catch (err: any) {
      setOrderError(err.message || `Failed to add ${drink.name}`);
    } finally {
      setSavingDrinkId(null);
    }
  };

  const handleConfirm = async () => {
    if (!activeOrder) return;
    setActionLoading(true);
    setOrderError(null);
    try {
      const result = await confirmOrder(activeOrder.id);
      if (result.ok) {
        onOrderChanged(tableId, { ...activeOrder, status: 2 });
      } else {
        setOrderError(result.message || 'Failed to confirm order');
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to confirm order');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!activeOrder) return;
    setActionLoading(true);
    setOrderError(null);
    try {
      const result = await cancelOrder(activeOrder.id);
      if (result.ok) {
        onOrderChanged(tableId, undefined);
        setIsConfirmingCancel(false);
      } else {
        setOrderError(result.message || 'Failed to cancel order');
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to cancel order');
    } finally {
      setActionLoading(false);
    }
  };

  // A linked zone with no open order goes straight to the New Order form —
  // no intermediate "No Active Order" screen. Once the order is created,
  // activeOrder is set and this same component renders the detail view.
  // (hadOrderRef: skip this for the one render between an order clearing
  // and the effect above closing the modal, so the form doesn't flash.)
  if (table.adminTableId != null && !activeOrder && !hadOrderRef.current) {
    return (
      <NewOrderScreen
        table={table}
        onClose={onClose}
        onOrderChanged={(order) => onOrderChanged(tableId, order)}
      />
    );
  }

  return (
    <div
      id="table-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="table-detail-drawer"
        className="w-full max-w-2xl bg-[#141628] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100"
      >
        {/* Header Bar */}
        <div className="p-6 border-b border-white/10 flex items-start justify-between bg-gradient-to-r from-white/[0.04] to-transparent">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-lg">
              {table.code}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">{table.name}</h2>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase border flex items-center gap-1.5 ${getStatusColors(table.status).activeButtonClass}`}
                >
                  {table.status === 'occupied' ? (
                    <Users className="w-3 h-3" />
                  ) : table.status === 'reserved' ? (
                    <CalendarClock className="w-3 h-3" />
                  ) : table.status === 'unavailable' ? (
                    <Ban className="w-3 h-3" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  {getStatusColors(table.status).label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Floor {table.floor} • {zoneKindLabel(table, roomChargeRate)}
                {table.serverName ? ` • Server: ${table.serverName}` : ''}
              </p>
            </div>
          </div>

          <button
            id="btn-close-modal"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* Table status is a pure reflection of restoAdmin's order-driven
              state now — no manual selector here anymore (see App.tsx's
              applyRemoteStatus). Status shows in the header badge above. */}

          {/* Order Section (real, restoAdmin-sourced order) — the modal's
              primary content now that there's no separate guest/booking
              panel competing for space. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UtensilsCrossed className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold text-white">Order</span>
              </div>
              {activeOrder && (
                <div className="text-xs text-slate-400">
                  {formatOrderType(activeOrder.orderType)} • {formatItemCount(orderRows.length)}
                </div>
              )}
            </div>

            {table.adminTableId == null && (
              <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200">
                  {/* Shouldn't happen: every zone in src/data/floorLayout.json is
                      linked. Linking needs the dormant layout editor (see
                      docs/layout-editor.md), so there's no action here. */}
                  This zone isn't linked to a restoAdmin table, so orders can't be placed from here.
                  Please let a developer know.
                </div>
              </div>
            )}

            {orderError && (
              <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
                {orderError}
              </div>
            )}

            {insufficient && insufficient.length > 0 && (
              <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
                <div className="font-semibold mb-1">Insufficient inventory</div>
                {insufficient.map((i, idx) => (
                  <div key={idx}>
                    {i.ingredientName ?? i.name}: need {i.required}, have {i.available} {i.unit}
                  </div>
                ))}
              </div>
            )}

            {activeOrder && (
              <>
                {roomChargeRate > 0 && (
                  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                    <div className="text-sm text-white">
                      Room Charge — {roomChargeQty}h × ₱{roomChargeRate.toLocaleString()}
                      <span className="text-slate-500 text-xs ml-1.5">(1 hour minimum)</span>
                    </div>
                    <QtyStepper
                      amount={`₱${(roomChargeQty * roomChargeRate).toFixed(2)}`}
                      onDecrement={() => handleRoomChargeChange(roomChargeQty - 0.5)}
                      onIncrement={() => handleRoomChargeChange(roomChargeQty + 0.5)}
                      decrementDisabled={roomChargeSaving || roomChargeQty <= 1}
                      incrementDisabled={roomChargeSaving}
                      onReset={() => handleRoomChargeChange(1)}
                      resetDisabled={roomChargeSaving || roomChargeQty <= 1}
                      resetLabel="Reset to 1 hour"
                    />
                  </div>
                )}

                {timing && (
                  <div
                    className={`px-3 py-2 rounded-2xl border flex items-center justify-between text-xs ${TIMER_ROW_CLASS[getTimerTone(timing)]}`}
                  >
                    <span className="text-white">
                      {formatHours(timing.hours)} booked · {formatClockTime(timing.startMs)} – {formatClockTime(timing.endMs)}
                    </span>
                    <span className={`font-mono font-bold tabular-nums ${TIMER_TEXT_CLASS[getTimerTone(timing)]}`}>
                      {timing.expired
                        ? `EXPIRED +${formatDuration(timing.remainingMs)}`
                        : `${formatDuration(timing.remainingMs)} left`}
                    </span>
                  </div>
                )}

                {/* Items table */}
                {orderRows.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center text-slate-500 text-xs">
                    No items on this order.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {orderRows.map((item) => (
                      <div
                        key={item.menuId}
                        className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-3"
                      >
                        <div className="text-sm text-white min-w-0 truncate" title={item.name}>
                          {item.quantity}x {item.name}
                        </div>
                        <QtyStepper
                          amount={`₱${item.lineTotal.toFixed(2)}`}
                          onDecrement={() => handleRowStep(item, -1)}
                          onIncrement={() => handleRowStep(item, 1)}
                          decrementDisabled={savingItemId != null || item.quantity <= 1}
                          incrementDisabled={savingItemId != null}
                          onRemove={() => handleDeleteRow(item)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowAddItems(true)}
                  className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Add Items
                </button>

                {catalog && (
                  <QuickAddDrinks
                    drinks={catalog.quickDrinks}
                    qtyOf={(menuId) => orderRows.find((row) => row.menuId === menuId)?.quantity ?? 0}
                    onAdd={handleQuickDrink}
                    busyId={savingDrinkId}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-white/10 bg-[#0f1120] flex items-center justify-between">
          <div className="text-xs text-slate-400 font-mono">
            Grand Total: <span className="text-white font-bold text-sm">₱{(activeOrder?.grandTotal ?? 0).toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-2">
            {activeOrder && (
              <>
                {isConfirmingCancel ? (
                  <>
                    <span className="text-xs text-rose-300">Cancel this order?</span>
                    <button
                      onClick={handleCancel}
                      disabled={actionLoading}
                      className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Ban className="w-3.5 h-3.5" /> Confirm
                    </button>
                    <button
                      onClick={() => setIsConfirmingCancel(false)}
                      className="px-2.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-xs"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsConfirmingCancel(true)}
                    className="px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-semibold"
                  >
                    Cancel Order
                  </button>
                )}

                {/* Dashboard orders are confirmed on creation; this only shows
                    for a Pending order that came from restoAdmin. */}
                {activeOrder.status === 3 && (
                  <button
                    onClick={handleConfirm}
                    disabled={actionLoading}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" /> Confirm
                  </button>
                )}

                {activeOrder.status === 2 && (
                  <button
                    onClick={() => setShowSettleModal(true)}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                  >
                    <Wallet className="w-3.5 h-3.5" /> Settle
                  </button>
                )}
              </>
            )}

            <button
              id="btn-done-modal"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {showAddItems && activeOrder && (
        <AddItemsScreen
          table={table}
          order={activeOrder}
          onClose={() => setShowAddItems(false)}
          onAdded={refreshOrder}
        />
      )}

      {showSettleModal && activeOrder && (
        <SettlePaymentModal
          orderId={activeOrder.id}
          table={table}
          onClose={() => setShowSettleModal(false)}
          onSettled={() => onOrderChanged(tableId, undefined)}
        />
      )}
    </div>
  );
};
