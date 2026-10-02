import React, { useState } from 'react';
import { TableRoom, AdminOrderSummary } from '../types';
import { confirmOrder, cancelOrder, formatOrderType, formatItemCount } from '../services/orderSync';
import { SettlePaymentModal } from './SettlePaymentModal';
import {
  UtensilsCrossed,
  Check,
  Ban,
  Wallet,
  CheckCircle2,
} from 'lucide-react';

interface OrderQueueViewProps {
  tables: TableRoom[];
  onOrderChanged: (tableId: string, order: AdminOrderSummary | undefined) => void;
  onSelectTable: (table: TableRoom) => void;
  currentFloor: 1 | 2;
  onSelectFloor: (floor: 1 | 2) => void;
}

export const OrderQueueView: React.FC<OrderQueueViewProps> = ({
  tables,
  onOrderChanged,
  onSelectTable,
  currentFloor,
  onSelectFloor,
}) => {
  const [filterFloor, setFilterFloor] = useState<'all' | 1 | 2>(currentFloor);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [settlingTable, setSettlingTable] = useState<TableRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tables with a Pending(3)/Confirmed(2) order — the ones actually needing
  // action here. Settled/Cancelled orders aren't "active" (see App.tsx).
  const activeTables = tables.filter((t) => {
    if (filterFloor !== 'all' && t.floor !== filterFloor) return false;
    return !!t.activeOrder && (t.activeOrder.status === 2 || t.activeOrder.status === 3);
  });

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
            Tables with an order awaiting confirmation or payment — confirm, cancel, or settle right here
          </p>
        </div>

        {/* Floor Filter Buttons */}
        <div className="flex items-center gap-1.5 bg-[#16182a] p-1 rounded-2xl border border-white/10">
          <button
            onClick={() => setFilterFloor('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterFloor === 'all' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            All Floors
          </button>
          <button
            onClick={() => {
              setFilterFloor(1);
              onSelectFloor(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterFloor === 1 ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            1st Floor
          </button>
          <button
            onClick={() => {
              setFilterFloor(2);
              onSelectFloor(2);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterFloor === 2 ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            2nd Floor
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Table Cards Grid */}
      {activeTables.length === 0 ? (
        <div className="mt-8 p-16 rounded-3xl bg-white/[0.02] border border-dashed border-white/10 text-center flex flex-col items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
          <h3 className="text-lg font-bold text-white">All Clear! No Orders Need Action</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            New orders will appear here as soon as they're placed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-8">
          {activeTables.map((table) => {
            const order = table.activeOrder as AdminOrderSummary;
            const isLoading = actionLoadingId === table.id;

            return (
              <div
                key={table.id}
                className="p-5 rounded-3xl bg-[#141628]/95 border border-white/10 shadow-2xl flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between border-b border-white/10 pb-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-lg border border-indigo-500/30">
                          {table.code}
                        </span>
                        <h3 className="font-bold text-white text-sm">{table.name}</h3>
                        <span className="text-[10px] text-slate-400">Floor {table.floor}</span>
                      </div>
                      <div className="text-xs text-slate-300 mt-1">
                        {formatOrderType(order.orderType)} • {formatItemCount(order.items.length)}
                      </div>
                    </div>
                  </div>

                  <div className="text-sm text-white font-mono font-bold">
                    ₱{order.grandTotal.toFixed(2)}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 space-y-2">
                  <button
                    onClick={() => onSelectTable(table)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    View Table Details &rarr;
                  </button>

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
                      <button
                        onClick={() => setCancelConfirmId(table.id)}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    )}

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
                  </div>
                </div>
              </div>
            );
          })}
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
