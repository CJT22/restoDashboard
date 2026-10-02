import React, { useState } from 'react';
import { TableRoom, TableStatus } from '../types';
import { getStatusColors } from '../utils/statusColors';
import { formatItemCount } from '../services/orderSync';
import {
  Search,
  Flame
} from 'lucide-react';

interface TableDirectoryViewProps {
  tables: TableRoom[];
  onSelectTable: (table: TableRoom) => void;
  currentFloor: 1 | 2;
  onSelectFloor: (floor: 1 | 2) => void;
}

export const TableDirectoryView: React.FC<TableDirectoryViewProps> = ({
  tables,
  onSelectTable,
  currentFloor,
  onSelectFloor,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TableStatus | 'needs_action'>('all');

  const filteredTables = tables.filter((table) => {
    // Floor filter
    if (table.floor !== currentFloor) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = table.name.toLowerCase().includes(q);
      const matchCode = table.code.toLowerCase().includes(q);
      if (!matchName && !matchCode) return false;
    }

    // Status filter — 'needs_action' means a Pending/Confirmed order (Confirm/Cancel/Settle available)
    if (statusFilter === 'needs_action') {
      return !!table.activeOrder && (table.activeOrder.status === 2 || table.activeOrder.status === 3);
    }
    if (statusFilter !== 'all' && table.status !== statusFilter) {
      return false;
    }

    return true;
  });

  return (
    <div id="table-directory-view" className="flex-1 h-screen overflow-y-auto bg-gradient-to-br from-[#0c0d1c] via-[#14122d] to-[#1e1542] p-8 text-slate-100 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Tables & KTV Rooms</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time occupancy and live kitchen order progress
          </p>
        </div>

        {/* Floor selector toggle */}
        <div className="flex items-center gap-2 bg-[#16182a] p-1 rounded-2xl border border-white/10">
          <button
            id="tab-dir-floor-1"
            onClick={() => onSelectFloor(1)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              currentFloor === 1
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            1st Floor (Main Dining)
          </button>
          <button
            id="tab-dir-floor-2"
            onClick={() => onSelectFloor(2)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              currentFloor === 2
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            2nd Floor (KTV Rooms)
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 my-6">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="input-search-tables"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search table code or name..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              statusFilter === 'all' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white bg-white/5'
            }`}
          >
            All ({tables.filter(t => t.floor === currentFloor).length})
          </button>

          <button
            onClick={() => setStatusFilter('needs_action')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              statusFilter === 'needs_action' ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40' : 'text-amber-400/70 hover:text-amber-300 bg-white/5'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            Needs Action
          </button>

          <button
            onClick={() => setStatusFilter('occupied')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              statusFilter === 'occupied' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white bg-white/5'
            }`}
          >
            Occupied
          </button>

          <button
            onClick={() => setStatusFilter('available')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              statusFilter === 'available' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white bg-white/5'
            }`}
          >
            Available
          </button>
        </div>
      </div>

      {/* Grid of Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTables.map((table) => {
          const activeOrder = table.activeOrder;

          return (
            <div
              key={table.id}
              id={`dir-card-${table.id}`}
              onClick={() => onSelectTable(table)}
              className="cursor-pointer p-5 rounded-3xl bg-[#15172b]/90 border border-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-200 shadow-xl flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-indigo-300 font-bold text-sm font-mono">
                      {table.code}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm group-hover:text-indigo-400 transition-colors">
                        {table.name}
                      </h3>
                      <span className="text-[10px] text-slate-400">
                        {table.type === 'room' ? 'Private Room' : table.type === 'booth' ? 'Booth' : 'Table'} • Cap: {table.capacity}
                      </span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${getStatusColors(table.status).activeButtonClass}`}
                  >
                    {getStatusColors(table.status).label}
                  </span>
                </div>
              </div>

              {/* Order summary */}
              <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                {activeOrder ? (
                  <span className="px-2 py-0.5 rounded-full font-bold border bg-indigo-500/15 text-indigo-300 border-indigo-500/30">
                    {formatItemCount(activeOrder.items.length)} • ₱{activeOrder.grandTotal.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-slate-500 text-[11px]">No active order</span>
                )}

                <span className="text-[11px] text-indigo-400 font-medium">
                  Update &rarr;
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
