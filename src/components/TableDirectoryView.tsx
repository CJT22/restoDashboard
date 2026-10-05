import React, { useState } from 'react';
import { TableRoom, TableStatus } from '../types';
import { getStatusColors } from '../utils/statusColors';
import { zoneKindLabel } from '../utils/zoneLabels';
import { getRoomTiming, getTimerTone, formatDuration, useNow, TIMER_TEXT_CLASS } from '../utils/roomTimer';
import { formatItemCount, groupOrderLines } from '../services/orderSync';
import { Search, SearchX, X } from 'lucide-react';

interface TableDirectoryViewProps {
  tables: TableRoom[];
  onSelectTable: (table: TableRoom) => void;
  currentFloor: 1 | 2;
  onSelectFloor: (floor: 1 | 2) => void;
}

type FloorFilter = 'all' | 1 | 2;
type StatusFilter = 'all' | TableStatus;

const FLOORS: (1 | 2)[] = [1, 2];
const FLOOR_LABEL: Record<1 | 2, string> = { 1: '1st Floor', 2: '2nd Floor' };

// Chip order. Reserved and Not Available are only set from restoAdmin and
// are rare, so their chips appear only while a zone has that status.
const STATUS_CHIPS: TableStatus[] = ['occupied', 'available', 'reserved', 'unavailable'];
const ALWAYS_SHOWN: TableStatus[] = ['occupied', 'available'];

// By name, with numbers in numeric order: ROOM 3 before ROOM 4 and M2 before
// M10. floorLayout.json lists zones in the order they were drawn instead.
const byName = (a: TableRoom, b: TableRoom) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export const TableDirectoryView: React.FC<TableDirectoryViewProps> = ({
  tables,
  onSelectTable,
  currentFloor,
  onSelectFloor,
}) => {
  // Same floor behaviour as Active Orders: opens on the map's floor, picking
  // a floor moves the map too, and All Floors leaves the map where it is.
  const [floorFilter, setFloorFilter] = useState<FloorFilter>(currentFloor);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const selectFloor = (floor: FloorFilter) => {
    setFloorFilter(floor);
    if (floor !== 'all') onSelectFloor(floor);
  };

  // Floor + search, before the status filter, so each chip's count says how
  // many cards picking it would show.
  const query = searchQuery.trim().toLowerCase();
  const inScope = tables
    .filter((t) => floorFilter === 'all' || t.floor === floorFilter)
    .filter((t) => !query || t.name.toLowerCase().includes(query) || t.code.toLowerCase().includes(query));
  const countOf = (status: TableStatus) => inScope.filter((t) => t.status === status).length;
  const visible = inScope.filter((t) => statusFilter === 'all' || t.status === statusFilter).sort(byName);

  const groups = (floorFilter === 'all' ? FLOORS : [floorFilter])
    .map((floor) => ({ floor, tables: visible.filter((t) => t.floor === floor) }))
    .filter((g) => g.tables.length > 0);

  // Ticks every second only while some visible room has a running timer.
  const timedOrder = (t: TableRoom) =>
    t.activeOrder ? { ...t.activeOrder, roomRate: t.activeOrder.roomRate || t.adminRoomCharge } : undefined;
  const nowMs = useNow(visible.some((t) => getRoomTiming(timedOrder(t), 0) != null));

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  const renderCard = (table: TableRoom) => {
    const activeOrder = table.activeOrder;
    const timing = getRoomTiming(timedOrder(table), nowMs);
    const action = activeOrder ? 'View Order' : table.adminTableId != null ? 'New Order' : 'Details';

    return (
      <button
        type="button"
        key={table.id}
        id={`dir-card-${table.id}`}
        onClick={() => onSelectTable(table)}
        className="h-full w-full text-left cursor-pointer p-5 rounded-3xl bg-[#15172b]/90 border border-white/10 hover:border-white/20 hover:scale-[1.02] focus-visible:outline-none focus-visible:border-indigo-500 transition-all duration-200 shadow-xl flex flex-col justify-between group"
      >
        <div className="flex items-start justify-between gap-3">
          {/* min-h-10 keeps the header the height the old 40px code badge gave it. */}
          <div className="min-w-0 min-h-10 flex flex-col justify-center">
            <h3 className="font-bold text-white text-sm truncate group-hover:text-indigo-400 transition-colors">
              {table.name}
            </h3>
            <span className="text-[10px] text-slate-400 truncate">
              {zoneKindLabel(table)}
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

        {/* Fixed height, so cards with an order chip line up with those without. */}
        <div className="mt-4 pt-3 border-t border-white/10 h-[22px] box-content flex items-center justify-between gap-2 text-xs">
          {activeOrder ? (
            <span className="px-2 py-0.5 rounded-full font-bold border bg-indigo-500/15 text-indigo-300 border-indigo-500/30 truncate">
              {formatItemCount(groupOrderLines(activeOrder.items).length)} • ₱{activeOrder.grandTotal.toFixed(2)}
            </span>
          ) : (
            <span className="text-slate-500 text-[11px]">No active order</span>
          )}

          <span className="shrink-0 text-[11px] text-indigo-400 font-medium">{action} &rarr;</span>
        </div>
      </button>
    );
  };

  const chipClass = (active: boolean, activeClass: string) =>
    `px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
      active ? activeClass : 'border-transparent text-slate-400 hover:text-white bg-white/5'
    }`;

  return (
    <div id="table-directory-view" className="flex-1 h-screen overflow-y-auto bg-gradient-to-br from-[#0c0d1c] via-[#14122d] to-[#1e1542] p-8 text-slate-100 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">All Tables & Rooms</h1>
          <p className="text-xs text-slate-400 mt-1">
            Every table and room with its status and open order. Tap one to start or view its order.
          </p>
        </div>

        {/* Floor filter — same control as Active Orders */}
        <div className="flex items-center gap-1.5 bg-[#16182a] p-1 rounded-2xl border border-white/10">
          {(['all', ...FLOORS] as FloorFilter[]).map((floor) => (
            <button
              key={floor}
              id={`tab-dir-floor-${floor}`}
              onClick={() => selectFloor(floor)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                floorFilter === floor ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              {floor === 'all' ? 'All Floors' : FLOOR_LABEL[floor]}
            </button>
          ))}
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
            placeholder="Search tables and rooms…"
            className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setStatusFilter('all')} className={chipClass(statusFilter === 'all', 'border-transparent bg-white/15 text-white')}>
            All <span className="tabular-nums opacity-70">{inScope.length}</span>
          </button>
          {STATUS_CHIPS.filter((s) => ALWAYS_SHOWN.includes(s) || countOf(s) > 0 || statusFilter === s).map((s) => {
            const colors = getStatusColors(s);
            return (
              <button key={s} onClick={() => setStatusFilter(s)} className={chipClass(statusFilter === s, colors.activeButtonClass)}>
                <span className={`w-1.5 h-1.5 rounded-full ${colors.legendDotClass}`} />
                {colors.label} <span className="tabular-nums opacity-70">{countOf(s)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="p-16 rounded-3xl bg-white/[0.02] border border-dashed border-white/10 text-center flex flex-col items-center justify-center">
          <SearchX className="w-10 h-10 text-slate-500 mb-3" />
          <h3 className="text-base font-bold text-white">No tables or rooms match</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">Try another search or status, or clear the filters.</p>
          <button
            onClick={clearFilters}
            className="mt-4 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.floor}>
              {floorFilter === 'all' && (
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
    </div>
  );
};
