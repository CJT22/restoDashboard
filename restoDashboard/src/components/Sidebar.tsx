import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid,
  Layers,
  UtensilsCrossed,
  Wifi,
  WifiOff,
  AlertTriangle,
  RotateCw,
  Check,
  CheckCircle2,
  Users
} from 'lucide-react';
import { TableRoom } from '../types';
import { ConnectionStatus } from '../services/adminSync';
import { getRoomTiming, getTimerTone, formatDuration, formatWait, TIMER_TEXT_CLASS, RoomTiming } from '../utils/roomTimer';

// The sidebar's connection badge, per ConnectionStatus (see adminSync.ts).
const CONNECTION_BADGE: Record<
  ConnectionStatus,
  { label: string; detail: string; icon: React.ComponentType<{ className?: string }>; iconClass: string; dotClass: string }
> = {
  connecting: {
    label: 'Connecting…',
    detail: 'Connecting to the live sync server',
    icon: Wifi,
    iconClass: 'text-slate-400',
    dotClass: 'bg-slate-400 animate-pulse',
  },
  live: {
    label: 'Live',
    detail: 'Receiving live updates from restoAdmin',
    icon: Wifi,
    iconClass: 'text-emerald-400',
    dotClass: 'bg-emerald-400 animate-pulse',
  },
  adminOffline: {
    label: 'restoAdmin offline',
    detail: "The sync server can't reach restoAdmin, so live updates are paused. Retrying automatically.",
    icon: AlertTriangle,
    iconClass: 'text-amber-400',
    dotClass: 'bg-amber-400',
  },
  offline: {
    label: 'Offline',
    detail: "Can't reach the dashboard's sync server, so live updates are paused. Retrying automatically.",
    icon: WifiOff,
    iconClass: 'text-rose-400',
    dotClass: 'bg-rose-400',
  },
};

const FLOOR_LABELS: Record<1 | 2, string> = { 1: '1st Floor', 2: '2nd Floor' };

interface SidebarProps {
  currentFloor: 1 | 2;
  activeNav: 'floorplan' | 'directory' | 'orders';
  onSelectNav: (nav: 'floorplan' | 'directory' | 'orders') => void;
  showAvailableFilter: boolean;
  onToggleAvailableFilter: () => void;
  showOccupiedFilter: boolean;
  onToggleOccupiedFilter: () => void;
  tables: TableRoom[];
  onSelectFloor: (floor: 1 | 2) => void;
  onSelectTable: (table: TableRoom) => void;
  connectionStatus: ConnectionStatus;
  // When the last full refresh from restoAdmin succeeded (null = not yet).
  lastSyncedAt: number | null;
  // Reloads every zone's status and order from restoAdmin; rejects on failure.
  onRefresh: () => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentFloor,
  activeNav,
  onSelectNav,
  showAvailableFilter,
  onToggleAvailableFilter,
  showOccupiedFilter,
  onToggleOccupiedFilter,
  tables,
  onSelectFloor,
  onSelectTable,
  connectionStatus,
  lastSyncedAt,
  onRefresh,
}) => {
  // Live clock matching the screenshot "1:44:22 PM", "TUESDAY, SEPTEMBER 15"
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshDoneRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = currentTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const dateString = currentTime
    .toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    .toUpperCase();

  // Per-floor available/occupied counts for the footer's floor cards.
  const floorStats = ([1, 2] as const).map((floor) => {
    const onFloor = tables.filter((t) => t.floor === floor);
    return {
      floor,
      total: onFloor.length,
      available: onFloor.filter((t) => t.status === 'available').length,
      occupied: onFloor.filter((t) => t.status === 'occupied').length,
    };
  });

  // Tables with a Pending/Confirmed order needing action (Confirm/Cancel/Settle)
  const activeOrdersCount = tables.filter(
    (t) => t.activeOrder && (t.activeOrder.status === 2 || t.activeOrder.status === 3)
  ).length;

  // Needs attention: rooms (both floors) that are expired or in their last
  // 15 minutes, most urgent first (most overdue, then least time left).
  // Rides the clock's own 1s tick, so it needs no timer of its own.
  const nowMs = currentTime.getTime();
  const attentionRooms = tables
    .map((table) => ({ table, timing: getRoomTiming(table.activeOrder, nowMs) }))
    .filter((row): row is { table: TableRoom; timing: RoomTiming } => row.timing != null && getTimerTone(row.timing) !== 'normal')
    .sort((a, b) => a.timing.remainingMs - b.timing.remainingMs);
  const hasExpired = attentionRooms.some((row) => row.timing.expired);

  // Refresh really reloads from restoAdmin (App's resyncFromAdmin). The icon
  // spins for at least one turn, and turns red for a few seconds if the
  // refresh failed.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshFailedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refreshFailedTimerRef.current) clearTimeout(refreshFailedTimerRef.current);
  }, []);

  const handleManualRefresh = () => {
    if (isRefreshing) return;
    refreshDoneRef.current = false;
    setIsRefreshing(true);
    setRefreshFailed(false);
    const minSpin = new Promise((resolve) => setTimeout(resolve, 600));
    Promise.allSettled([onRefresh(), minSpin]).then(([result]) => {
      refreshDoneRef.current = true;
      if (result.status === 'rejected') {
        setRefreshFailed(true);
        if (refreshFailedTimerRef.current) clearTimeout(refreshFailedTimerRef.current);
        refreshFailedTimerRef.current = setTimeout(() => setRefreshFailed(false), 4000);
      }
    });
  };

  // Only stop spinning on an animation loop boundary so the icon always
  // completes its current 360° turn before losing the highlight color,
  // instead of snapping back mid-rotation the moment the refresh finishes.
  const handleRefreshIconIteration = () => {
    if (refreshDoneRef.current) {
      setIsRefreshing(false);
    }
  };

  const badge = CONNECTION_BADGE[connectionStatus];
  const BadgeIcon = badge.icon;
  const syncedAgo = lastSyncedAt != null ? formatWait(nowMs - lastSyncedAt) : null;

  return (
    <aside 
      id="restaurant-sidebar"
      className="w-80 h-screen flex flex-col bg-[#11121d]/95 backdrop-blur-xl border-r border-white/10 text-slate-200 select-none overflow-y-auto overflow-x-hidden z-20 shrink-0 custom-scrollbar"
    >
      {/* Branch, clock & live connection status */}
      <div className="p-6 pb-4 border-b border-white/5">
        <div className="mb-4">
          <div className="text-sm font-bold tracking-wide text-white uppercase truncate">Blue Moon</div>
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Floor Dashboard</div>
        </div>

        <div className="text-3xl font-bold tracking-tight text-white font-mono flex items-baseline justify-between">
          <span>{timeString}</span>
        </div>
        <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1 uppercase">
          {dateString}
        </div>

        {/* Live connection badge (real state, see adminSync.ts) & refresh */}
        <div className="flex items-center gap-2 mt-4">
          <div
            id="connection-status"
            title={badge.detail}
            className="flex-1 min-w-0 h-10 flex items-center justify-between gap-2 px-3.5 rounded-xl bg-[#1a1c2e] border border-white/10 shadow-inner"
          >
            <div className="flex items-center gap-2 min-w-0">
              <BadgeIcon className={`w-4 h-4 shrink-0 ${badge.iconClass}`} />
              <span className="text-xs font-semibold text-slate-200 truncate">{badge.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {syncedAgo && (
                <span className="text-[10px] text-slate-500" title="Last full refresh from restoAdmin">
                  {syncedAgo === 'just now' ? 'synced just now' : `synced ${syncedAgo} ago`}
                </span>
              )}
              <span className={`w-2 h-2 rounded-full ${badge.dotClass}`} />
            </div>
          </div>

          <button
            id="btn-sync-refresh"
            onClick={handleManualRefresh}
            title={refreshFailed ? 'Refresh failed, try again' : 'Reload all statuses & orders from restoAdmin'}
            className="w-10 h-10 rounded-xl bg-[#1a1c2e] border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all shadow-inner"
          >
            <RotateCw
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : refreshFailed ? 'text-rose-400' : ''}`}
              onAnimationIteration={handleRefreshIconIteration}
            />
          </button>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="p-6 py-4 space-y-2">
        <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-2">
          Navigation
        </div>

        {/* Nav item: Floor Plan */}
        <button
          id="nav-floor-plan"
          onClick={() => onSelectNav('floorplan')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 ${
            activeNav === 'floorplan'
              ? 'bg-gradient-to-r from-white/[0.12] to-white/[0.04] text-white shadow-lg border border-white/15'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <LayoutGrid className={`w-5 h-5 ${activeNav === 'floorplan' ? 'text-indigo-400' : 'text-slate-400'}`} />
          <span className="font-semibold">Floor Plan</span>
        </button>

        {/* Nav item: All Tables & Rooms */}
        <button
          id="nav-all-tables"
          onClick={() => onSelectNav('directory')}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 ${
            activeNav === 'directory'
              ? 'bg-gradient-to-r from-white/[0.12] to-white/[0.04] text-white shadow-lg border border-white/15'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <div className="flex items-center gap-3">
            <Layers className={`w-5 h-5 ${activeNav === 'directory' ? 'text-indigo-400' : 'text-slate-400'}`} />
            <span className="font-semibold">All Tables & Rooms</span>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono">
            {tables.length}
          </span>
        </button>

        {/* Nav item: Order Queue */}
        <button
          id="nav-order-queue"
          onClick={() => onSelectNav('orders')}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-200 ${
            activeNav === 'orders'
              ? 'bg-gradient-to-r from-white/[0.12] to-white/[0.04] text-white shadow-lg border border-white/15'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
          }`}
        >
          <div className="flex items-center gap-3">
            <UtensilsCrossed className={`w-5 h-5 ${activeNav === 'orders' ? 'text-amber-400' : 'text-slate-400'}`} />
            <span className="font-semibold">Active Orders</span>
          </div>
          {activeOrdersCount > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold animate-pulse">
              {activeOrdersCount}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
              None
            </span>
          )}
        </button>
      </div>

      {/* QUICK CONTROL / SERVICE FILTERS - Exactly the 2 requested buttons */}
      <div className="p-6 py-4 border-t border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            Quick Control & Filter
          </div>
          {(showAvailableFilter || showOccupiedFilter) && (
            <span className="text-[10px] text-indigo-400 font-medium">Filter active</span>
          )}
        </div>

        {/* Button 1: Available Tables/Rooms (Emerald glow when on) */}
        <div
          id="control-available-tables"
          onClick={onToggleAvailableFilter}
          className={`cursor-pointer p-3.5 rounded-2xl flex items-center justify-between transition-all duration-300 ${
            showAvailableFilter
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20'
              : 'bg-[#161829] border border-white/10 text-slate-300 hover:border-white/20'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              showAvailableFilter ? 'bg-white/20 text-white' : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              <Check className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">
                Available Zones
              </div>
              <div className={`text-[11px] ${showAvailableFilter ? 'text-white/80' : 'text-slate-400'}`}>
                {showAvailableFilter ? 'Showing available tables' : 'Tap to show available'}
              </div>
            </div>
          </div>

          {/* Toggle switch pill */}
          <div className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 flex items-center ${
            showAvailableFilter ? 'bg-white justify-end' : 'bg-white/10 justify-start'
          }`}>
            <div className={`w-5 h-5 rounded-full shadow-md transition-all ${
              showAvailableFilter ? 'bg-emerald-600' : 'bg-slate-400'
            }`} />
          </div>
        </div>

        {/* Button 2: Occupied Tables/Rooms (Amber/Orange glow when on) */}
        <div
          id="control-occupied-tables"
          onClick={onToggleOccupiedFilter}
          className={`cursor-pointer p-3.5 rounded-2xl flex items-center justify-between transition-all duration-300 ${
            showOccupiedFilter
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-orange-500/20'
              : 'bg-[#161829] border border-white/10 text-slate-300 hover:border-white/20'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              showOccupiedFilter ? 'bg-white/20 text-white' : 'bg-amber-500/10 text-amber-400'
            }`}>
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">
                Occupied Zones
              </div>
              <div className={`text-[11px] ${showOccupiedFilter ? 'text-white/80' : 'text-slate-400'}`}>
                {showOccupiedFilter ? 'Showing occupied tables' : 'Tap to show occupied'}
              </div>
            </div>
          </div>

          <div className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 flex items-center ${
            showOccupiedFilter ? 'bg-white justify-end' : 'bg-white/10 justify-start'
          }`}>
            <div className={`w-5 h-5 rounded-full shadow-md transition-all ${
              showOccupiedFilter ? 'bg-orange-500' : 'bg-slate-400'
            }`} />
          </div>
        </div>
      </div>

      {/* Needs attention: expired / ending-soon rooms, both floors. Fills the
          sidebar's free height and scrolls on its own when the list is long. */}
      <div className="flex-1 min-h-[150px] flex flex-col p-6 py-4 border-t border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Needs Attention</div>
          {attentionRooms.length > 0 && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-mono font-bold border ${
                hasExpired
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  : 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30'
              }`}
            >
              {attentionRooms.length}
            </span>
          )}
        </div>

        {attentionRooms.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/10 text-center p-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div className="text-xs font-semibold text-slate-300">All rooms on time</div>
            <div className="text-[11px] text-slate-500">Expired rooms and ones ending within 15 minutes show here.</div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-1">
            {attentionRooms.map(({ table, timing }) => (
              <button
                key={table.id}
                onClick={() => onSelectTable(table)}
                title={`${table.name}: ${timing.expired ? 'expired' : 'ending soon'}, tap to view`}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 text-left transition-colors"
              >
                <span className="text-[10px] font-mono font-bold text-slate-400 bg-white/5 rounded px-1.5 py-0.5 shrink-0">
                  {table.floor}F
                </span>
                <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-200">{table.name}</span>
                <span className={`text-xs font-bold tabular-nums shrink-0 ${TIMER_TEXT_CLASS[getTimerTone(timing)]}`}>
                  {timing.expired ? `+${formatDuration(timing.remainingMs)}` : `${formatDuration(timing.remainingMs)} left`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Both floors at a glance; tap one to switch to it */}
      <div className="p-6 pt-3 border-t border-white/5 bg-[#0e0f1a]">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Floors</div>
        <div className="grid grid-cols-2 gap-2">
          {floorStats.map(({ floor, total, available, occupied }) => {
            const isCurrent = floor === currentFloor;
            return (
              <button
                key={floor}
                onClick={() => onSelectFloor(floor)}
                aria-pressed={isCurrent}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  isCurrent
                    ? 'bg-indigo-500/10 border-indigo-400/40'
                    : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/15'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] uppercase tracking-wider font-semibold ${isCurrent ? 'text-indigo-300' : 'text-slate-400'}`}>
                    {FLOOR_LABELS[floor]} <span className="text-slate-500 normal-case tracking-normal font-normal">/ {total}</span>
                  </span>
                  {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Currently viewing" />}
                </div>
                <div
                  className="mt-1 flex items-center gap-3 font-mono"
                  title={`${available} available, ${occupied} occupied (of ${total})`}
                >
                  <span className="flex items-center gap-1.5 text-base font-bold text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {available}
                  </span>
                  <span className="flex items-center gap-1.5 text-base font-bold text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    {occupied}
                  </span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${total > 0 ? (occupied / total) * 100 : 0}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
