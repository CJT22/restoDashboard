import React, { useEffect, useMemo, useState } from 'react';
import { TableRoom, AdminOrderSummary } from '../types';
import { getMenu, createOrder, addItemsToOrder, getActiveOrderForTable, AdminMenuItem } from '../services/orderSync';
import { getAdminTables } from '../services/adminSync';
import { X, Plus, Minus, Trash2, AlertTriangle, ClipboardList, ChevronDown } from 'lucide-react';

const roundToHalf = (v: number) => Math.round(v * 2) / 2;

interface NewOrderModalProps {
  table: TableRoom; // must have adminTableId set — caller gates on this
  onClose: () => void;
  onOrderChanged: (order: AdminOrderSummary) => void;
}

type LineItem = { menuId: number; name: string; unitPrice: number; qty: number };

const ORDER_TYPES: { value: string; label: string }[] = [
  { value: 'DINE_IN', label: 'Dine In' },
  { value: 'TAKE_OUT', label: 'Take Out' },
  { value: 'DELIVERY', label: 'Delivery' },
];

function generateOrderNo(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `ORD-${date}-${time}`;
}

export const NewOrderModal: React.FC<NewOrderModalProps> = ({ table, onClose, onOrderChanged }) => {
  const [menu, setMenu] = useState<AdminMenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  const [orderType, setOrderType] = useState('DINE_IN');
  const [orderNo, setOrderNo] = useState(generateOrderNo);
  const [selectedMenuId, setSelectedMenuId] = useState('');
  const [qty, setQty] = useState(1);
  const [items, setItems] = useState<LineItem[]>([]);

  // This table's hourly room-charge rate (0 = no room charge on this table),
  // fetched on demand from the same tables endpoint EditTableModal's linking
  // picker already uses — see restoAdmin's "Create New Order" room charge
  // stepper (Orders.tsx) for the equivalent admin-side feature.
  const [roomChargeRate, setRoomChargeRate] = useState(0);
  const [roomChargeQty, setRoomChargeQty] = useState(1);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<any[] | null>(null);
  const [conflict, setConflict] = useState<{ orderId: number; orderNo: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMenu()
      .then((rows) => {
        if (!cancelled) setMenu(rows);
      })
      .catch((err: any) => {
        if (!cancelled) setMenuError(err.message || 'Could not load the menu from restoAdmin');
      })
      .finally(() => {
        if (!cancelled) setLoadingMenu(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const hasRoomCharge = roomChargeRate > 0;
  const itemsSubtotal = useMemo(() => items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0), [items]);
  const roomChargeTotal = hasRoomCharge ? roomChargeQty * roomChargeRate : 0;
  const subtotal = itemsSubtotal + roomChargeTotal;

  const handleAddItem = () => {
    if (!selectedMenuId) return;
    const menuItem = menu.find((m) => String(m.id) === selectedMenuId);
    if (!menuItem || qty <= 0) return;
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.menuId === menuItem.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + qty };
        return copy;
      }
      return [...prev, { menuId: menuItem.id, name: menuItem.name, unitPrice: menuItem.price, qty }];
    });
    setSelectedMenuId('');
    setQty(1);
  };

  const handleRemoveItem = (menuId: number) => {
    setItems((prev) => prev.filter((it) => it.menuId !== menuId));
  };

  const resetAlerts = () => {
    setError(null);
    setInsufficient(null);
  };

  const handleSubmit = async () => {
    if (!orderNo.trim() || (items.length === 0 && !hasRoomCharge)) return;
    resetAlerts();
    setSubmitting(true);
    try {
      const payloadItems = items.map((it) => ({ menuId: it.menuId, qty: it.qty, unitPrice: it.unitPrice }));
      const result = await createOrder(
        table.adminTableId as number,
        orderType,
        orderNo.trim(),
        payloadItems,
        hasRoomCharge ? roomChargeQty : undefined
      );
      if (result.ok) {
        const fresh = await getActiveOrderForTable(table.adminTableId as number);
        if (fresh) onOrderChanged(fresh);
        onClose();
        return;
      }
      if (result.kind === 'conflict') {
        setConflict({ orderId: result.existingOrderId ?? 0, orderNo: result.existingOrderNo ?? '' });
        setError(result.message ?? null);
      } else if (result.kind === 'insufficient') {
        setInsufficient(result.insufficient ?? []);
      } else {
        setError(result.message ?? 'Failed to create order');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToExisting = async () => {
    if (!conflict || items.length === 0) return;
    resetAlerts();
    setSubmitting(true);
    try {
      const payloadItems = items.map((it) => ({ menuId: it.menuId, qty: it.qty, unitPrice: it.unitPrice }));
      const result = await addItemsToOrder(conflict.orderId, payloadItems);
      if (result.ok) {
        const fresh = await getActiveOrderForTable(table.adminTableId as number);
        if (fresh) onOrderChanged(fresh);
        onClose();
        return;
      }
      if (result.kind === 'insufficient') {
        setInsufficient(result.insufficient ?? []);
      } else {
        setError(result.message ?? 'Failed to add items to the existing order');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add items to the existing order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-[#141628] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100">
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-white/[0.04] to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">New Order</h3>
              <p className="text-xs text-slate-400">
                {table.name} • {table.adminTableName || `Table #${table.adminTableId}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Order No</label>
              <input
                type="text"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Order Type</label>
              {/* appearance-none + the custom ChevronDown replace the native
                  select arrow, which browsers render flush against the edge
                  regardless of padding (see EditTableModal.tsx). */}
              <div className="relative">
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="w-full appearance-none px-3 py-2 pr-9 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {ORDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value} className="bg-[#1a1c30]">
                      {t.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {hasRoomCharge && (
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Room Charge</label>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                <div className="text-sm text-white">
                  {roomChargeQty}h × ₱{roomChargeRate.toLocaleString()}
                  <span className="text-slate-500 text-xs ml-1.5">(1 hour minimum)</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRoomChargeQty((prev) => roundToHalf(Math.max(1, prev - 0.5)))}
                    disabled={roomChargeQty <= 1}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-xs text-slate-300 w-14 text-right">₱{roomChargeTotal.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => setRoomChargeQty((prev) => roundToHalf(prev + 0.5))}
                    className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Order Items</label>
            {loadingMenu ? (
              <p className="text-xs text-slate-500">Loading menu…</p>
            ) : menuError ? (
              <p className="text-xs text-rose-400">{menuError}</p>
            ) : (
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1 min-w-0">
                  <select
                    value={selectedMenuId}
                    onChange={(e) => setSelectedMenuId(e.target.value)}
                    className="w-full appearance-none h-10 px-3 pr-9 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="" className="bg-[#1a1c30]">
                      Select an item…
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
                  value={qty}
                  onChange={(e) => setQty(parseInt(e.target.value) || 1)}
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
            )}
          </div>

          {items.length === 0 ? (
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center text-slate-500 text-xs">
              No items added yet.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <div
                  key={it.menuId}
                  className="p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between"
                >
                  <div className="text-sm text-white">
                    {it.qty}x {it.name}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-300">₱{(it.unitPrice * it.qty).toFixed(2)}</span>
                    <button
                      onClick={() => handleRemoveItem(it.menuId)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {insufficient && insufficient.length > 0 && (
            <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-1">Insufficient inventory</div>
                {insufficient.map((i, idx) => (
                  <div key={idx}>
                    {i.ingredientName ?? i.name}: need {i.required}, have {i.available} {i.unit}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && !conflict && (
            <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
              {error}
            </div>
          )}

          {conflict && (
            <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 space-y-2">
              <div>
                This table already has an active order (#{conflict.orderNo}). Add these items to that order
                instead?
              </div>
              <button
                onClick={handleAddToExisting}
                disabled={submitting || items.length === 0}
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Add Items to Order #{conflict.orderNo}
              </button>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-white/10 bg-[#0f1120] flex items-center justify-between">
          <div className="text-xs text-slate-400 font-mono">
            Total: <span className="text-white font-bold text-sm">₱{subtotal.toFixed(2)}</span>
          </div>
          {!conflict && (
            <button
              onClick={handleSubmit}
              disabled={submitting || !orderNo.trim() || (items.length === 0 && !hasRoomCharge)}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-indigo-600/20"
            >
              {submitting ? 'Creating…' : 'Create Order'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
