import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid,
  Layers,
  UtensilsCrossed,
  Clock,
  Wifi,
  RotateCw,
  Check,
  Users
} from 'lucide-react';
import { TableRoom } from '../types';

interface SidebarProps {
  currentFloor: 1 | 2;
  activeNav: 'floorplan' | 'directory' | 'orders';
  onSelectNav: (nav: 'floorplan' | 'directory' | 'orders') => void;
  showAvailableFilter: boolean;
  onToggleAvailableFilter: () => void;
  showOccupiedFilter: boolean;
  onToggleOccupiedFilter: () => void;
  tables: TableRoom[];
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

  // Compute live stats for current floor & restaurant
  const floorTables = tables.filter((t) => t.floor === currentFloor);
  const totalOnFloor = floorTables.length;
  const occupiedOnFloor = floorTables.filter((t) => t.status === 'occupied').length;
  const availableOnFloor = floorTables.filter((t) => t.status === 'available').length;
  
  // Tables with a Pending/Confirmed order needing action (Confirm/Cancel/Settle)
  const activeOrdersCount = tables.filter(
    (t) => t.activeOrder && (t.activeOrder.status === 2 || t.activeOrder.status === 3)
  ).length;

  const handleManualRefresh = () => {
    if (isRefreshing) return;
    refreshDoneRef.current = false;
    setIsRefreshing(true);
    setTimeout(() => {
      refreshDoneRef.current = true;
    }, 600);
  };

  // Only stop spinning on an animation loop boundary so the icon always
  // completes its current 360° turn before losing the highlight color,
  // instead of snapping back mid-rotation the moment the refresh finishes.
  const handleRefreshIconIteration = () => {
    if (refreshDoneRef.current) {
      setIsRefreshing(false);
    }
  };

  return (
    <aside 
      id="restaurant-sidebar"
      className="w-80 h-screen flex flex-col bg-[#11121d]/95 backdrop-blur-xl border-r border-white/10 text-slate-200 select-none overflow-y-auto overflow-x-hidden z-20 shrink-0 custom-scrollbar"
    >
      {/* Top Clock & Status section matching screenshot */}
      <div className="p-6 pb-4 border-b border-white/5">
        <div className="text-3xl font-bold tracking-tight text-white font-mono flex items-baseline justify-between">
          <span>{timeString}</span>
        </div>
        <div className="text-[11px] font-semibold tracking-wider text-slate-400 mt-1 uppercase">
          {dateString}
        </div>

        {/* Status indicator badge & Refresh icon */}
        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1 h-10 flex items-center justify-between px-3.5 rounded-xl bg-[#1a1c2e] border border-white/10 shadow-inner">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold text-slate-200">Connected</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          <button
            id="btn-sync-refresh"
            onClick={handleManualRefresh}
            title="Sync & Refresh Status"
            className="w-10 h-10 rounded-xl bg-[#1a1c2e] border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all shadow-inner"
          >
            <RotateCw
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`}
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

      {/* Floor Statistics Footer */}
      <div className="mt-auto p-6 pt-3 border-t border-white/5 bg-[#0e0f1a]">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">
          {currentFloor === 1 ? '1st Floor' : '2nd Floor'}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Available</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {availableOnFloor} <span className="text-xs text-slate-400 font-normal">/ {totalOnFloor}</span>
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Occupied</div>
            <div className="text-base font-bold text-amber-400 font-mono mt-0.5">
              {occupiedOnFloor} <span className="text-xs text-slate-400 font-normal">/ {totalOnFloor}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
