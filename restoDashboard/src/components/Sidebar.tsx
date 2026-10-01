import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  Clock
} from 'lucide-react';
import { TableRoom } from '../types';
import { ConnectionStatus } from '../services/adminSync';
import { getRoomTiming, getTimerTone, formatDuration, formatWait, TIMER_TEXT_CLASS, RoomTiming } from '../utils/roomTimer';
import { morphLayers } from '../utils/morphLayers';

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

// Matches the sidebar's duration-300 width transition.
const SIDEBAR_TRANSITION_MS = 300;

const FLOOR_LABELS: Record<1 | 2, string> = { 1: '1st Floor', 2: '2nd Floor' };

interface SidebarProps {
  // Collapsed shows only the slim icon rail (see SidebarRail below).
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
  collapsed,
  onToggleCollapsed,
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

  // The rail's compact clock: "4:07" over "PM".
  const [railTime, railPeriod = ''] = currentTime
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .split(' ');
  const railClock = { time: railTime, period: railPeriod };

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

  // Collapsing/expanding morphs between the two layouts instead of swapping
  // them: the outgoing one stays mounted (inert, fading out) for the length
  // of the transition, while icons both share glide to their new spots (see
  // morphLayers and the data-morph tags below).
  const [exitingLayer, setExitingLayer] = useState<'full' | 'rail' | null>(null);
  const [prevCollapsed, setPrevCollapsed] = useState(collapsed);
  if (collapsed !== prevCollapsed) {
    setPrevCollapsed(collapsed);
    setExitingLayer(collapsed ? 'full' : 'rail');
  }
  useEffect(() => {
    if (!exitingLayer) return;
    const timer = setTimeout(() => setExitingLayer(null), SIDEBAR_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [exitingLayer, collapsed]);

  const asideRef = useRef<HTMLElement>(null);
  const morphOverlayRef = useRef<HTMLDivElement>(null);
  const isFirstLayoutRef = useRef(true);
  useLayoutEffect(() => {
    if (isFirstLayoutRef.current) {
      isFirstLayoutRef.current = false;
      return;
    }
    const aside = asideRef.current;
    const overlay = morphOverlayRef.current;
    const from = aside?.querySelector<HTMLElement>(`[data-layer="${collapsed ? 'full' : 'rail'}"]`);
    const to = aside?.querySelector<HTMLElement>(`[data-layer="${collapsed ? 'rail' : 'full'}"]`);
    if (!overlay || !from || !to) return;
    // The button that was pressed is going inert; keep keyboard focus on
    // its counterpart in the new layout.
    if (from.contains(document.activeElement)) {
      to.querySelector<HTMLElement>('[data-sidebar-toggle]')?.focus({ preventScroll: true });
    }
    return morphLayers({ from, to, overlay, duration: SIDEBAR_TRANSITION_MS });
  }, [collapsed]);

  const showFull = !collapsed || exitingLayer === 'full';
  const showRail = collapsed || exitingLayer === 'rail';

  return (
    <aside
      ref={asideRef}
      id="restaurant-sidebar"
      aria-label="Sidebar"
      className={`relative h-screen bg-[#11121d]/95 border-r border-white/10 text-slate-200 select-none overflow-hidden z-20 shrink-0 transition-[width] duration-300 ease-out motion-reduce:transition-none ${
        collapsed ? 'w-16' : 'w-80'
      }`}
    >
      {showRail && (
        <SidebarRail
          key="rail"
          inert={!collapsed}
          onExpand={onToggleCollapsed}
          clock={railClock}
          badge={badge}
          syncedAgo={syncedAgo}
          isRefreshing={isRefreshing}
          refreshFailed={refreshFailed}
          onRefresh={handleManualRefresh}
          onRefreshIconIteration={handleRefreshIconIteration}
          activeNav={activeNav}
          onSelectNav={onSelectNav}
          tableCount={tables.length}
          activeOrdersCount={activeOrdersCount}
          showAvailableFilter={showAvailableFilter}
          onToggleAvailableFilter={onToggleAvailableFilter}
          showOccupiedFilter={showOccupiedFilter}
          onToggleOccupiedFilter={onToggleOccupiedFilter}
          attentionCount={attentionRooms.length}
          hasExpired={hasExpired}
        />
      )}
      {showFull && (
        // Held at the full width so nothing reflows while the shell animates;
        // the shell's overflow-hidden reveals it as it widens.
        <div
          key="full"
          data-layer="full"
          inert={collapsed}
          className="absolute inset-y-0 left-0 w-80 flex flex-col overflow-y-auto overflow-x-hidden custom-scrollbar"
        >
          {/* Branch, clock & live connection status */}
          <div className="p-6 pb-4 border-b border-white/5">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold tracking-wide text-white uppercase truncate">Blue Moon</div>
                <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Floor Dashboard</div>
              </div>
              <button
                id="btn-collapse-sidebar"
                data-sidebar-toggle
                onClick={onToggleCollapsed}
                title="Collapse sidebar (more room for the floor plan)"
                aria-label="Collapse sidebar"
                aria-expanded={true}
                className="w-8 h-8 -mr-1 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
              >
                <PanelLeftClose data-morph="toggle" className="w-4 h-4" />
              </button>
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
                  data-morph="refresh"
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
              <LayoutGrid data-morph="nav-floorplan" className={`w-5 h-5 ${activeNav === 'floorplan' ? 'text-indigo-400' : 'text-slate-400'}`} />
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
                <Layers data-morph="nav-directory" className={`w-5 h-5 ${activeNav === 'directory' ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span className="font-semibold">All Tables & Rooms</span>
              </div>
              <span data-morph="count-directory" className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono">
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
                <UtensilsCrossed data-morph="nav-orders" className={`w-5 h-5 ${activeNav === 'orders' ? 'text-amber-400' : 'text-slate-400'}`} />
                <span className="font-semibold">Active Orders</span>
              </div>
              {activeOrdersCount > 0 ? (
                <span data-morph="count-orders" className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold animate-pulse">
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
              <span
                className={`text-[10px] text-indigo-400 font-medium transition-opacity duration-300 ${
                  showAvailableFilter || showOccupiedFilter ? 'opacity-100' : 'opacity-0'
                }`}
              >
                Filter active
              </span>
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
                  <Check data-morph="filter-available" className="w-5 h-5" />
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

              {/* Toggle switch pill: the knob slides the 24px track (w-12 minus
                  p-0.5 padding and the w-5 knob) rather than flipping justify, which can't animate */}
              <div className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-300 flex items-center ${
                showAvailableFilter ? 'bg-white' : 'bg-white/10'
              }`}>
                <div className={`w-5 h-5 rounded-full shadow-md transition-[translate,background-color] duration-300 ease-out ${
                  showAvailableFilter ? 'translate-x-6 bg-emerald-600' : 'translate-x-0 bg-slate-400'
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
                  <Users data-morph="filter-occupied" className="w-5 h-5" />
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

              <div className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-300 flex items-center ${
                showOccupiedFilter ? 'bg-white' : 'bg-white/10'
              }`}>
                <div className={`w-5 h-5 rounded-full shadow-md transition-[translate,background-color] duration-300 ease-out ${
                  showOccupiedFilter ? 'translate-x-6 bg-orange-500' : 'translate-x-0 bg-slate-400'
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
                <CheckCircle2 data-morph="attention-clear" className="w-5 h-5 text-emerald-400" />
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
        </div>
      )}
      {/* Icons gliding between the two layouts fly here, above both */}
      <div ref={morphOverlayRef} aria-hidden="true" className="absolute inset-0 z-10 pointer-events-none" />
    </aside>
  );
};

// The rail's square buttons; ACTIVE matches the expanded sidebar's selected
// nav item.
const RAIL_BUTTON_CLASSES =
  'relative w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95';
const RAIL_BUTTON_IDLE = 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]';
const RAIL_BUTTON_ACTIVE = 'bg-gradient-to-r from-white/[0.12] to-white/[0.04] text-white shadow-lg border border-white/15';

const RailDivider = () => <div className="w-8 h-px shrink-0 bg-white/10 my-1" />;

// A count pinned to a rail button's top-right corner. `morph` pairs it with
// the expanded sidebar's matching count pill.
const RailCount: React.FC<{ value: number; className: string; morph?: string }> = ({ value, className, morph }) => (
  <span
    data-morph={morph}
    className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full border text-[10px] leading-4 text-center font-mono font-bold ${className}`}
  >
    {value}
  </span>
);

interface SidebarRailProps {
  onExpand: () => void;
  clock: { time: string; period: string };
  badge: (typeof CONNECTION_BADGE)[ConnectionStatus];
  syncedAgo: string | null;
  isRefreshing: boolean;
  refreshFailed: boolean;
  onRefresh: () => void;
  onRefreshIconIteration: () => void;
  activeNav: SidebarProps['activeNav'];
  onSelectNav: SidebarProps['onSelectNav'];
  tableCount: number;
  activeOrdersCount: number;
  showAvailableFilter: boolean;
  onToggleAvailableFilter: () => void;
  showOccupiedFilter: boolean;
  onToggleOccupiedFilter: () => void;
  attentionCount: number;
  hasExpired: boolean;
  // True while this is the outgoing layout of a collapse/expand.
  inert: boolean;
}

// The collapsed sidebar: what staff reach for mid-service, still one tap
// away in 64px. Labels move into tooltips. The needs-attention button opens
// the full sidebar, since its room list doesn't fit here.
const SidebarRail: React.FC<SidebarRailProps> = ({
  onExpand,
  clock,
  badge,
  syncedAgo,
  isRefreshing,
  refreshFailed,
  onRefresh,
  onRefreshIconIteration,
  activeNav,
  onSelectNav,
  tableCount,
  activeOrdersCount,
  showAvailableFilter,
  onToggleAvailableFilter,
  showOccupiedFilter,
  onToggleOccupiedFilter,
  attentionCount,
  hasExpired,
  inert,
}) => {
  const synced = syncedAgo == null ? '' : syncedAgo === 'just now' ? ' · synced just now' : ` · synced ${syncedAgo} ago`;
  const refreshHint = refreshFailed ? 'Refresh failed, tap to try again' : 'Tap to reload all statuses & orders from restoAdmin';

  return (
    <div
      data-layer="rail"
      inert={inert}
      className="absolute inset-y-0 left-0 w-16 flex flex-col items-center gap-2 py-4 overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
    >
      <button
        id="btn-expand-sidebar"
        data-sidebar-toggle
        onClick={onExpand}
        title="Expand sidebar"
        aria-label="Expand sidebar"
        aria-expanded={false}
        className={`${RAIL_BUTTON_CLASSES} ${RAIL_BUTTON_IDLE}`}
      >
        <PanelLeftOpen data-morph="toggle" className="w-5 h-5" />
      </button>

      <div className="py-1 text-center font-mono leading-none">
        <div className="text-sm font-bold text-white tabular-nums">{clock.time}</div>
        <div className="mt-0.5 text-[9px] font-semibold tracking-wider text-slate-500">{clock.period}</div>
      </div>

      {/* Refresh, with the live connection state as its corner dot */}
      <button
        id="btn-rail-refresh"
        onClick={onRefresh}
        title={`${badge.label}${synced}\n${badge.detail}\n${refreshHint}`}
        aria-label={`Connection: ${badge.label}. Reload from restoAdmin`}
        className={`${RAIL_BUTTON_CLASSES} bg-[#1a1c2e] border border-white/10 shadow-inner text-slate-300 hover:text-white hover:bg-white/10`}
      >
        <RotateCw
          data-morph="refresh"
          className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : refreshFailed ? 'text-rose-400' : ''}`}
          onAnimationIteration={onRefreshIconIteration}
        />
        <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${badge.dotClass}`} />
      </button>

      <RailDivider />

      <button
        id="rail-nav-floor-plan"
        onClick={() => onSelectNav('floorplan')}
        title="Floor Plan"
        aria-label="Floor Plan"
        aria-current={activeNav === 'floorplan' ? 'page' : undefined}
        className={`${RAIL_BUTTON_CLASSES} ${activeNav === 'floorplan' ? RAIL_BUTTON_ACTIVE : RAIL_BUTTON_IDLE}`}
      >
        <LayoutGrid data-morph="nav-floorplan" className={`w-5 h-5 ${activeNav === 'floorplan' ? 'text-indigo-400' : ''}`} />
      </button>
      <button
        id="rail-nav-all-tables"
        onClick={() => onSelectNav('directory')}
        title={`All Tables & Rooms (${tableCount})`}
        aria-label="All Tables & Rooms"
        aria-current={activeNav === 'directory' ? 'page' : undefined}
        className={`${RAIL_BUTTON_CLASSES} ${activeNav === 'directory' ? RAIL_BUTTON_ACTIVE : RAIL_BUTTON_IDLE}`}
      >
        <Layers data-morph="nav-directory" className={`w-5 h-5 ${activeNav === 'directory' ? 'text-indigo-400' : ''}`} />
        <RailCount morph="count-directory" value={tableCount} className="bg-[#2a2c40] text-slate-300 border-white/10" />
      </button>
      <button
        id="rail-nav-order-queue"
        onClick={() => onSelectNav('orders')}
        title={activeOrdersCount > 0 ? `Active Orders (${activeOrdersCount})` : 'Active Orders (none)'}
        aria-label="Active Orders"
        aria-current={activeNav === 'orders' ? 'page' : undefined}
        className={`${RAIL_BUTTON_CLASSES} ${activeNav === 'orders' ? RAIL_BUTTON_ACTIVE : RAIL_BUTTON_IDLE}`}
      >
        <UtensilsCrossed data-morph="nav-orders" className={`w-5 h-5 ${activeNav === 'orders' ? 'text-amber-400' : ''}`} />
        {activeOrdersCount > 0 && (
          <RailCount morph="count-orders" value={activeOrdersCount} className="bg-[#3a2a12] text-amber-300 border-amber-500/40 animate-pulse" />
        )}
      </button>

      <RailDivider />

      {/* Quick Control & Filter, as the expanded sidebar's two switches */}
      <button
        id="rail-control-available-tables"
        onClick={onToggleAvailableFilter}
        title={showAvailableFilter ? 'Available Zones: on (tap to turn off)' : 'Available Zones: tap to show available'}
        aria-label="Available Zones filter"
        aria-pressed={showAvailableFilter}
        className={`${RAIL_BUTTON_CLASSES} duration-300 ${
          showAvailableFilter
            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/20'
            : 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
        }`}
      >
        <Check data-morph="filter-available" className="w-5 h-5" />
      </button>
      <button
        id="rail-control-occupied-tables"
        onClick={onToggleOccupiedFilter}
        title={showOccupiedFilter ? 'Occupied Zones: on (tap to turn off)' : 'Occupied Zones: tap to show occupied'}
        aria-label="Occupied Zones filter"
        aria-pressed={showOccupiedFilter}
        className={`${RAIL_BUTTON_CLASSES} duration-300 ${
          showOccupiedFilter
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-orange-500/20'
            : 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
        }`}
      >
        <Users data-morph="filter-occupied" className="w-5 h-5" />
      </button>

      <RailDivider />

      <button
        id="rail-needs-attention"
        onClick={onExpand}
        title={
          attentionCount > 0
            ? `Needs attention: ${attentionCount} ${attentionCount === 1 ? 'room' : 'rooms'} expired or ending soon (tap to see)`
            : 'All rooms on time'
        }
        aria-label="Needs attention"
        className={`${RAIL_BUTTON_CLASSES} ${RAIL_BUTTON_IDLE}`}
      >
        {attentionCount > 0 ? (
          <>
            <Clock className={`w-5 h-5 ${hasExpired ? 'text-rose-400' : 'text-yellow-300'}`} />
            <RailCount
              value={attentionCount}
              className={
                hasExpired ? 'bg-[#3a1a24] text-rose-300 border-rose-500/40' : 'bg-[#33300f] text-yellow-300 border-yellow-500/40'
              }
            />
          </>
        ) : (
          <CheckCircle2 data-morph="attention-clear" className="w-5 h-5 text-emerald-400/70" />
        )}
      </button>
    </div>
  );
};
