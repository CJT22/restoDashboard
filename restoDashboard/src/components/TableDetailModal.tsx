import React, { useEffect, useState } from 'react';
import { TableRoom, TableStatus, AdminOrderLineItem, AdminOrderSummary } from '../types';
import {
  getActiveOrderForTable,
  getMenu,
  AdminMenuItem,
  addItemsToOrder,
  updateItemQty,
  deleteItem,
  confirmOrder,
  cancelOrder,
  updateOrderRoomCharge,
  getOrderStatusLabel,
  getOrderStatusColorClass,
} from '../services/orderSync';
import { getAdminTables } from '../services/adminSync';
import { getStatusColors } from '../utils/statusColors';
import { getRoomTiming, formatDuration, formatHours, formatClockTime, useNow } from '../utils/roomTimer';
import { NewOrderModal } from './NewOrderModal';
import { SettlePaymentModal } from './SettlePaymentModal';
import {
  X,
  Check,
  Users,
  UtensilsCrossed,
  Plus,
  Minus,
  Pencil,
  Trash2,
  Link2,
  AlertTriangle,
  Wallet,
  Ban,
  ChevronDown
} from 'lucide-react';

const roundToHalf = (v: number) => Math.round(v * 2) / 2;

interface TableDetailModalProps {
  table: TableRoom | null;
  onClose: () => void;
  // Applies an order-related change by table id, merging into the latest
  // state rather than a snapshot — see App.tsx's handleOrderChanged for why
  // a full-object replace isn't safe for these.
  onOrderChanged: (tableId: string, order: AdminOrderSummary | undefined) => void;
  onOpenLinkModal: (table: TableRoom) => void;
}

export const TableDetailModal: React.FC<TableDetailModalProps> = ({
  table,
  onClose,
  onOrderChanged,
  onOpenLinkModal,
}) => {
  if (!table) return null;

  const [loadingOrder, setLoadingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<any[] | null>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [menu, setMenu] = useState<AdminMenuItem[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState(1);

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

  // Menu for the inline "add item" row, fetched once a real order exists to add to.
  useEffect(() => {
    if (table.adminTableId == null) return;
    getMenu()
      .then(setMenu)
      .catch(() => setMenu([]));
  }, [table.adminTableId]);

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

  const handleAddItem = async () => {
    if (!activeOrder || !selectedMenuId) return;
    const menuItem = menu.find((m) => String(m.id) === selectedMenuId);
    if (!menuItem || addQty <= 0) return;
    setOrderError(null);
    setInsufficient(null);
    try {
      const result = await addItemsToOrder(activeOrder.id, [
        { menuId: menuItem.id, qty: addQty, unitPrice: menuItem.price },
      ]);
      if (result.ok) {
        setSelectedMenuId('');
        setAddQty(1);
        await refreshOrder();
      } else if (result.kind === 'insufficient') {
        setInsufficient(result.insufficient ?? []);
      } else {
        setOrderError(result.message || 'Failed to add item');
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to add item');
    }
  };

  const handleStartEditItem = (item: AdminOrderLineItem) => {
    setEditingItemId(item.id);
    setEditQty(item.quantity);
  };

  const handleSubmitEditItem = async () => {
    if (editingItemId == null || editQty <= 0) return;
    setOrderError(null);
    setInsufficient(null);
    try {
      const result = await updateItemQty(editingItemId, editQty);
      if (result.ok) {
        setEditingItemId(null);
        await refreshOrder();
      } else if (result.kind === 'insufficient') {
        setInsufficient(result.insufficient ?? []);
      } else {
        setOrderError(result.message || 'Failed to update item');
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to update item');
    }
  };

  const handleDeleteItem = async (item: AdminOrderLineItem) => {
    setOrderError(null);
    try {
      const result = await deleteItem(item.id);
      if (result.ok) {
        await refreshOrder();
      } else {
        setOrderError(result.message || 'Failed to delete item');
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to delete item');
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
                  {table.status === 'occupied' ? <Users className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                  {getStatusColors(table.status).label}
                </span>
                {table.adminTableId != null && (
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono flex items-center gap-1"
                    title={`Synced with restoAdmin table #${table.adminTableId} (Blue Moon)`}
                  >
                    <Link2 className="w-3 h-3" />
                    Synced to: {table.adminTableName || `#${table.adminTableId}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Floor {table.floor} • Cap: {table.capacity} •{' '}
                {table.type === 'room' ? 'Private KTV Room' : table.type === 'booth' ? 'Dining Booth' : 'Dining Table'}
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
                {activeOrder && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${getOrderStatusColorClass(activeOrder.status)}`}>
                    {getOrderStatusLabel(activeOrder.status)}
                  </span>
                )}
              </div>
              {activeOrder && (
                <div className="text-xs text-slate-400">
                  #{activeOrder.orderNo} • {activeOrder.orderType ?? 'DINE_IN'} • {orderItems.length} item(s)
                </div>
              )}
            </div>

            {table.adminTableId != null && !activeOrder && !loadingOrder && (
              <div className="p-10 rounded-3xl bg-white/[0.02] border-2 border-dashed border-white/10 text-center flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
                  <UtensilsCrossed className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">No Active Order</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    This table is free — start a new order whenever guests are ready.
                  </p>
                </div>
                <button
                  id="btn-open-new-order"
                  onClick={() => setShowNewOrderModal(true)}
                  className="mt-1 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-lg shadow-indigo-600/25 flex items-center gap-2 transition-all"
                >
                  <Plus className="w-4 h-4" /> Create New Order
                </button>
              </div>
            )}

            {table.adminTableId == null && (
              <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200">
                  This zone isn't linked to a restoAdmin table yet, so orders can't be placed from here.
                  <button
                    onClick={() => onOpenLinkModal(table)}
                    className="block mt-1.5 text-indigo-300 hover:text-indigo-200 font-semibold underline"
                  >
                    Link this zone to a Blue Moon table
                  </button>
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
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleRoomChargeChange(roomChargeQty - 0.5)}
                        disabled={roomChargeSaving || roomChargeQty <= 1}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="font-mono text-xs text-slate-300 w-16 text-right">
                        ₱{(roomChargeQty * roomChargeRate).toFixed(2)}
                      </span>
                      <button
                        onClick={() => handleRoomChargeChange(roomChargeQty + 0.5)}
                        disabled={roomChargeSaving}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {timing && (
                  <div className="px-3 py-2 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      {formatHours(timing.hours)} booked · {formatClockTime(timing.startMs)} – {formatClockTime(timing.endMs)}
                    </span>
                    <span className="font-mono font-bold text-white tabular-nums">
                      {timing.expired
                        ? `EXPIRED +${formatDuration(timing.remainingMs)}`
                        : `${formatDuration(timing.remainingMs)} left`}
                    </span>
                  </div>
                )}

                {/* Items table */}
                {orderItems.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center text-slate-500 text-xs">
                    No items on this order.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {orderItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between"
                      >
                        {editingItemId === item.id ? (
                          <>
                            <div className="text-sm text-white">{item.name}</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={1}
                                value={editQty}
                                onChange={(e) => setEditQty(parseInt(e.target.value) || 1)}
                                className="w-16 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-sm text-white text-center focus:outline-none focus:border-indigo-500"
                              />
                              <button
                                onClick={handleSubmitEditItem}
                                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingItemId(null)}
                                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm text-white">
                              {item.quantity}x {item.name}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-slate-300">₱{item.lineTotal.toFixed(2)}</span>
                              <button
                                onClick={() => handleStartEditItem(item)}
                                className="text-slate-500 hover:text-indigo-400 p-1"
                                title="Edit quantity"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="text-slate-500 hover:text-rose-400 p-1"
                                title="Remove item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Inline add-item row */}
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={selectedMenuId}
                      onChange={(e) => setSelectedMenuId(e.target.value)}
                      className="w-full appearance-none h-10 px-3 pr-9 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="" className="bg-[#1a1c30]">
                        Select an item to add…
                      </option>
                      {menu.map((m) => (
                        <option key={m.id} value={m.id} className="bg-[#1a1c30]">
                          {m.name} — ₱{m.price}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={addQty}
                    onChange={(e) => setAddQty(parseInt(e.target.value) || 1)}
                    className="w-16 h-10 px-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white text-center focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleAddItem}
                    disabled={!selectedMenuId}
                    className="h-10 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center justify-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
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

      {showNewOrderModal && table.adminTableId != null && (
        <NewOrderModal
          table={table}
          onClose={() => setShowNewOrderModal(false)}
          onOrderChanged={(order) => onOrderChanged(tableId, order)}
        />
      )}

      {showSettleModal && activeOrder && (
        <SettlePaymentModal
          orderId={activeOrder.id}
          orderNo={activeOrder.orderNo}
          onClose={() => setShowSettleModal(false)}
          onSettled={() => onOrderChanged(tableId, undefined)}
        />
      )}
    </div>
  );
};
