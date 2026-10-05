import React, { useState } from 'react';
import { Beer, ChevronDown, Minus, Plus } from 'lucide-react';
import { CatalogItem } from '../services/menuCatalog';

interface QuickAddDrinksProps {
  drinks: CatalogItem[];
  // Units of this item in the cart (order screens) or on the order (detail).
  qtyOf: (menuId: number) => number;
  onAdd: (item: CatalogItem) => void;
  // Order screens pass this to show −/qty/+ once an item is in the cart. The
  // order detail saves every tap straight to restoAdmin, so it leaves it out:
  // each card stays an Add button, with what's already on the order shown
  // beside the price (fixing a mistake is the order row's −/trash).
  onDecrement?: (item: CatalogItem) => void;
  // The drink whose tap is being saved, if any; disables every card meanwhile.
  busyId?: number | null;
  defaultExpanded?: boolean;
}

// Best-selling everyday drinks (beer, soju, soda, shakes, water…) one tap
// away, for a table's next round — the dashboard's take on the staff app's
// Quick Add Drinks carousel.
export const QuickAddDrinks: React.FC<QuickAddDrinksProps> = ({
  drinks,
  qtyOf,
  onAdd,
  onDecrement,
  busyId = null,
  defaultExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (drinks.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <span className="w-6 h-6 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center">
          <Beer className="w-3.5 h-3.5" />
        </span>
        <span className="text-xs font-bold text-white flex-1">Quick Add Drinks</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-3 custom-scrollbar">
          {drinks.map((d) => {
            const qty = qtyOf(d.id);
            const inCart = qty > 0 && onDecrement != null;
            return (
              <div
                key={d.id}
                className={`w-28 shrink-0 rounded-xl border p-2 flex flex-col gap-1.5 ${
                  qty > 0 ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-white/[0.03] border-white/10'
                }`}
              >
                <div className="text-[11px] font-semibold text-white leading-tight line-clamp-2 min-h-[2lh]" title={d.name}>
                  {d.name}
                </div>
                <div className="text-[11px] text-amber-300 font-mono tabular-nums flex items-center justify-between gap-1">
                  <span>₱{d.price.toLocaleString()}</span>
                  {!onDecrement && qty > 0 && <span className="text-indigo-300">×{qty}</span>}
                </div>
                {inCart ? (
                  <div className="h-7 rounded-lg bg-indigo-600 flex items-center justify-between text-white">
                    <button
                      type="button"
                      onClick={() => onDecrement(d)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10"
                      aria-label={`Remove one ${d.name}`}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-xs font-bold tabular-nums">{qty}</span>
                    <button
                      type="button"
                      onClick={() => onAdd(d)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10"
                      aria-label={`Add one ${d.name}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAdd(d)}
                    disabled={busyId != null}
                    className="h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-semibold flex items-center justify-center gap-1"
                  >
                    {busyId === d.id ? 'Adding…' : (
                      <>
                        <Plus className="w-3 h-3" /> Add
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
