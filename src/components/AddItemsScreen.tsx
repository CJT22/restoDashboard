import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TableRoom, AdminOrderSummary } from '../types';
import { addItemsToOrder, groupOrderLines } from '../services/orderSync';
import { formatZoneSubtitle } from '../utils/zoneLabels';
import { QuickAddDrinks } from './QuickAddDrinks';
import { OrderScreen, CartLineList, InsufficientAlert, useOrderCart, useMenuCatalog } from './OrderScreen';

interface AddItemsScreenProps {
  table: TableRoom;
  order: AdminOrderSummary;
  onClose: () => void;
  // Called after restoAdmin accepted the items; the caller refreshes the order.
  onAdded: () => Promise<void> | void;
}

// Adds items to an order that's already open. Items are staged here and sent
// in one call, so picking a round can't half-save, and a mis-tap is fixed
// before anything reaches restoAdmin. restoAdmin records them as new lines
// alongside the existing ones, as it does for the staff app's additional orders.
export const AddItemsScreen: React.FC<AddItemsScreenProps> = ({ table, order, onClose, onAdded }) => {
  const { catalog, error: catalogError } = useMenuCatalog();
  const cart = useOrderCart();
  const [showExisting, setShowExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<any[] | null>(null);

  const handleSubmit = async () => {
    if (cart.lines.length === 0) return;
    setError(null);
    setInsufficient(null);
    setSubmitting(true);
    try {
      const result = await addItemsToOrder(
        order.id,
        cart.lines.map((l) => ({ menuId: l.menuId, qty: l.qty, unitPrice: l.unitPrice }))
      );
      if (result.ok) {
        await onAdded();
        onClose();
        return;
      }
      if (result.kind === 'insufficient') {
        setInsufficient(result.insufficient ?? []);
      } else {
        setError(result.message || 'Failed to add items');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add items');
    } finally {
      setSubmitting(false);
    }
  };

  const aside = (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {order.items.length > 0 && (
          <div className="rounded-2xl bg-white/[0.02] border border-white/5">
            <button
              type="button"
              onClick={() => setShowExisting((v) => !v)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs text-slate-400"
              aria-expanded={showExisting}
            >
              <span>
                Already on this order · {order.items.reduce((sum, it) => sum + it.quantity, 0)}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showExisting ? 'rotate-180' : ''}`} />
            </button>
            {showExisting && (
              <div className="px-3 pb-2.5 space-y-1">
                {groupOrderLines(order.items).map((it) => (
                  <div key={it.menuId} className="flex justify-between gap-2 text-xs text-slate-300">
                    <span className="truncate" title={it.name}>
                      {it.quantity}x {it.name}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 shrink-0">₱{it.lineTotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            Adding{cart.unitCount > 0 && <span className="text-slate-500 font-normal"> · {cart.unitCount}</span>}
          </label>
          <CartLineList cart={cart} emptyText="Tap items on the menu to add them to this order." />
        </div>

        {insufficient && insufficient.length > 0 && <InsufficientAlert items={insufficient} />}

        {error && (
          <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">{error}</div>
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
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-slate-400">Adding</span>
            <span className="text-lg font-bold text-white font-mono tabular-nums">₱{cart.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-baseline justify-between text-[11px] text-slate-500">
            <span>Current order total</span>
            <span className="font-mono tabular-nums">₱{order.grandTotal.toFixed(2)}</span>
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || cart.lines.length === 0}
          className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold shadow-lg shadow-indigo-600/20"
        >
          {submitting ? 'Adding…' : 'Add to Order'}
        </button>
      </div>
    </>
  );

  return (
    <OrderScreen
      title="Add Items"
      subtitle={formatZoneSubtitle(table)}
      catalog={catalog}
      catalogError={catalogError}
      qtyOf={cart.qtyOf}
      onAdd={cart.add}
      onDecrement={(item) => cart.decrement(item.id)}
      dirty={cart.lines.length > 0 && !submitting}
      onClose={onClose}
      aside={aside}
    />
  );
};
