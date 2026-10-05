import React, { useEffect, useState } from 'react';
import { TableRoom, AdminOrderSummary } from '../types';
import { createOrder, addItemsToOrder, getActiveOrderForTable, ORDER_TYPES } from '../services/orderSync';
import { getAdminTables } from '../services/adminSync';
import { QtyStepper } from './QtyStepper';
import { QuickAddDrinks } from './QuickAddDrinks';
import { OrderScreen, CartLineList, InsufficientAlert, useOrderCart, useMenuCatalog } from './OrderScreen';

const roundToHalf = (v: number) => Math.round(v * 2) / 2;

interface NewOrderScreenProps {
  table: TableRoom; // must have adminTableId set — caller gates on this
  // Dismissed without creating an order. On success the screen only calls
  // onOrderChanged — the caller decides what to show next.
  onClose: () => void;
  onOrderChanged: (order: AdminOrderSummary) => void;
}

export const NewOrderScreen: React.FC<NewOrderScreenProps> = ({ table, onClose, onOrderChanged }) => {
  const { catalog, error: catalogError } = useMenuCatalog();
  const cart = useOrderCart();
  const [orderType, setOrderType] = useState('DINE_IN');

  // This table's hourly room-charge rate (0 = no room charge on this table),
  // fetched on demand from the same tables endpoint EditTableModal's linking
  // picker already uses — see restoAdmin's "Create New Order" room charge
  // stepper (Orders.tsx) for the equivalent admin-side feature.
  const [roomChargeRate, setRoomChargeRate] = useState(0);
  const [roomChargeQty, setRoomChargeQty] = useState(1);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<any[] | null>(null);
  const [conflict, setConflict] = useState<{ orderId: number } | null>(null);

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
  const roomChargeTotal = hasRoomCharge ? roomChargeQty * roomChargeRate : 0;
  const total = cart.subtotal + roomChargeTotal;

  const resetAlerts = () => {
    setError(null);
    setInsufficient(null);
  };

  const payloadItems = () => cart.lines.map((l) => ({ menuId: l.menuId, qty: l.qty, unitPrice: l.unitPrice }));

  const handleSubmit = async () => {
    if (cart.lines.length === 0 && !hasRoomCharge) return;
    resetAlerts();
    setSubmitting(true);
    try {
      const result = await createOrder(
        table.adminTableId as number,
        orderType,
        payloadItems(),
        hasRoomCharge ? roomChargeQty : undefined
      );
      if (result.ok) {
        const fresh = await getActiveOrderForTable(table.adminTableId as number);
        // No onClose on success: once the zone has an active order, the
        // parent TableDetailModal swaps this screen for the order detail view.
        if (fresh) onOrderChanged(fresh);
        else onClose();
        return;
      }
      if (result.kind === 'conflict') {
        setConflict({ orderId: result.existingOrderId ?? 0 });
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
    if (!conflict || cart.lines.length === 0) return;
    resetAlerts();
    setSubmitting(true);
    try {
      const result = await addItemsToOrder(conflict.orderId, payloadItems());
      if (result.ok) {
        const fresh = await getActiveOrderForTable(table.adminTableId as number);
        if (fresh) onOrderChanged(fresh);
        else onClose();
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

  const aside = (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* No Order No field: restoAdmin still gets a unique order number,
            but the backend generates it (server/adminClient.ts) and the
            dashboard never shows it. */}
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">Order Type</label>
          <div className="grid grid-cols-3 gap-1.5">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setOrderType(t.value)}
                className={`h-9 rounded-xl text-xs font-semibold border transition-colors ${
                  orderType === t.value
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {hasRoomCharge && (
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Room Charge</label>
            <div className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2">
              <div className="text-sm text-white">
                {roomChargeQty}h × ₱{roomChargeRate.toLocaleString()}
                <span className="block text-slate-500 text-[11px]">1 hour minimum</span>
              </div>
              <QtyStepper
                amount={`₱${roomChargeTotal.toFixed(2)}`}
                onDecrement={() => setRoomChargeQty((prev) => roundToHalf(Math.max(1, prev - 0.5)))}
                onIncrement={() => setRoomChargeQty((prev) => roundToHalf(prev + 0.5))}
                decrementDisabled={roomChargeQty <= 1}
                onReset={() => setRoomChargeQty(1)}
                resetDisabled={roomChargeQty <= 1}
                resetLabel="Reset to 1 hour"
              />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            Order Items{cart.unitCount > 0 && <span className="text-slate-500 font-normal"> · {cart.unitCount}</span>}
          </label>
          <CartLineList cart={cart} emptyText="Tap items on the menu to add them." />
        </div>

        {insufficient && insufficient.length > 0 && <InsufficientAlert items={insufficient} />}

        {error && !conflict && (
          <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">{error}</div>
        )}

        {conflict && (
          <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
            This table already has an active order. Add these items to it instead?
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 bg-[#0f1120] p-4 space-y-3">
        {catalog && (
          <QuickAddDrinks
            drinks={catalog.quickDrinks}
            qtyOf={cart.qtyOf}
            onAdd={cart.add}
            onDecrement={(d) => cart.decrement(d.id)}
          />
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-400">Total</span>
          <span className="text-lg font-bold text-white font-mono tabular-nums">₱{total.toFixed(2)}</span>
        </div>
        {conflict ? (
          <button
            onClick={handleAddToExisting}
            disabled={submitting || cart.lines.length === 0}
            className="w-full h-11 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold"
          >
            {submitting ? 'Adding…' : 'Add Items to Existing Order'}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting || (cart.lines.length === 0 && !hasRoomCharge)}
            className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-indigo-600/20"
          >
            {submitting ? 'Creating…' : 'Create Order'}
          </button>
        )}
      </div>
    </>
  );

  return (
    <OrderScreen
      title="New Order"
      subtitle={`${table.name} • ${table.adminTableName || `Table #${table.adminTableId}`}`}
      catalog={catalog}
      catalogError={catalogError}
      qtyOf={cart.qtyOf}
      onAdd={cart.add}
      onDecrement={(item) => cart.decrement(item.id)}
      dirty={cart.lines.length > 0}
      onClose={onClose}
      aside={aside}
    />
  );
};
