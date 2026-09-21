import React, { useState } from 'react';
import { TableRoom, OrderItem } from '../types';
import { 
  Flame, 
  Check, 
  Clock, 
  AlertTriangle, 
  UtensilsCrossed, 
  CheckCircle2, 
  Layers
} from 'lucide-react';

interface OrderQueueViewProps {
  tables: TableRoom[];
  onUpdateTable: (table: TableRoom) => void;
  onSelectTable: (table: TableRoom) => void;
  currentFloor: 1 | 2;
  onSelectFloor: (floor: 1 | 2) => void;
}

export const OrderQueueView: React.FC<OrderQueueViewProps> = ({
  tables,
  onUpdateTable,
  onSelectTable,
  currentFloor,
  onSelectFloor,
}) => {
  const [filterFloor, setFilterFloor] = useState<'all' | 1 | 2>(currentFloor);
  const [orderStatusTab, setOrderStatusTab] = useState<'pending' | 'all' | 'served'>('pending');

  // Collect all orders with their parent table info
  interface FlattenedOrder {
    table: TableRoom;
    order: OrderItem;
  }

  const flattenedOrders: FlattenedOrder[] = [];
  tables.forEach((table) => {
    if (filterFloor !== 'all' && table.floor !== filterFloor) return;
    table.orders.forEach((order) => {
      if (orderStatusTab === 'pending' && order.status !== 'pending') return;
      if (orderStatusTab === 'served' && order.status !== 'served') return;
      flattenedOrders.push({ table, order });
    });
  });

  const handleToggleItemStatus = (table: TableRoom, orderId: string) => {
    const updatedOrders = table.orders.map((o) => {
      if (o.id === orderId) {
        return {
          ...o,
          status: (o.status === 'pending' ? 'served' : 'pending') as 'pending' | 'served',
        };
      }
      return o;
    });

    onUpdateTable({
      ...table,
      orders: updatedOrders,
    });
  };

  const handleMarkAllTableOrdersServed = (table: TableRoom) => {
    const updatedOrders = table.orders.map((o) => ({
      ...o,
      status: 'served' as const,
    }));
    onUpdateTable({
      ...table,
      orders: updatedOrders,
    });
  };

  // Group by table
  const activeTablesWithOrders = tables.filter((t) => {
    if (filterFloor !== 'all' && t.floor !== filterFloor) return false;
    if (orderStatusTab === 'pending') {
      return t.orders.some((o) => o.status === 'pending');
    }
    return t.orders.length > 0;
  });

  return (
    <div id="order-queue-view" className="flex-1 h-screen overflow-y-auto bg-gradient-to-br from-[#0c0d1c] via-[#14122d] to-[#1e1542] p-8 text-slate-100 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <UtensilsCrossed className="w-6 h-6 text-amber-400" />
            Live Kitchen & Order Expediter Queue
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Track dishes awaiting preparation, expedite hot plates, and update served status in real time
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

      {/* Tabs for Order Status */}
      <div className="flex items-center justify-between my-6">
        <div className="flex items-center gap-2">
          <button
            id="tab-orders-pending"
            onClick={() => setOrderStatusTab('pending')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all ${
              orderStatusTab === 'pending'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            <Flame className="w-4 h-4" />
            Pending Dishes Only
          </button>

          <button
            id="tab-orders-all"
            onClick={() => setOrderStatusTab('all')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all ${
              orderStatusTab === 'all'
                ? 'bg-white/20 text-white'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            All Orders ({tables.reduce((acc, t) => acc + t.orders.length, 0)})
          </button>

          <button
            id="tab-orders-served"
            onClick={() => setOrderStatusTab('served')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all ${
              orderStatusTab === 'served'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            Served Dishes
          </button>
        </div>
      </div>

      {/* Tables Order Cards Grid */}
      {activeTablesWithOrders.length === 0 ? (
        <div className="p-16 rounded-3xl bg-white/[0.02] border border-dashed border-white/10 text-center flex flex-col items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
          <h3 className="text-lg font-bold text-white">All Clear! No Pending Orders</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            Every seated table has received their dishes. New orders will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {activeTablesWithOrders.map((table) => {
            const pendingOrders = table.orders.filter((o) => o.status === 'pending');
            const servedOrders = table.orders.filter((o) => o.status === 'served');

            return (
              <div
                key={table.id}
                className="p-5 rounded-3xl bg-[#141628]/95 border border-white/10 shadow-2xl flex flex-col justify-between"
              >
                <div>
                  {/* Table Header */}
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
                        {table.guestName ? `Guest: ${table.guestName}` : 'Walk-in Table'} 
                        {table.seatedTime ? ` • ${table.seatedTime}` : ''}
                      </div>
                    </div>

                    {pendingOrders.length > 0 ? (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold font-mono animate-pulse">
                        {pendingOrders.length} to serve
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                        All Served
                      </span>
                    )}
                  </div>

                  {/* List of orders for this table */}
                  <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                    {table.orders
                      .filter((o) => {
                        if (orderStatusTab === 'pending') return o.status === 'pending';
                        if (orderStatusTab === 'served') return o.status === 'served';
                        return true;
                      })
                      .map((item) => {
                        const isPending = item.status === 'pending';

                        return (
                          <div
                            key={item.id}
                            className={`p-3 rounded-2xl border flex items-center justify-between transition-all ${
                              isPending
                                ? 'bg-amber-950/20 border-amber-500/30 shadow-sm'
                                : 'bg-white/[0.03] border-white/5 opacity-80'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleToggleItemStatus(table, item.id)}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                                  isPending
                                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-black border border-amber-500/40'
                                    : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40 border border-emerald-500/40'
                                }`}
                                title={isPending ? 'Mark as Served' : 'Mark as Pending'}
                              >
                                {isPending ? <Clock className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                              </button>

                              <div>
                                <div className="text-xs font-semibold text-white">
                                  {item.quantity}x {item.name}
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                                  <span>Ordered {item.orderedAt}</span>
                                  {item.notes && <span className="text-amber-300 italic">• {item.notes}</span>}
                                </div>
                              </div>
                            </div>

                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                              isPending ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                            }`}>
                              {isPending ? 'Pending' : 'Served'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Table card action buttons */}
                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                  <button
                    onClick={() => onSelectTable(table)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    View Table Details &rarr;
                  </button>

                  {pendingOrders.length > 0 && (
                    <button
                      onClick={() => handleMarkAllTableOrdersServed(table)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Mark All Served
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
