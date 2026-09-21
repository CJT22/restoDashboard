import React, { useState } from 'react';
import {
  TableRoom,
  TableStatus,
  OrderItem
} from '../types';
import { MENU_ITEMS_PRESET } from '../data/mockRestaurantData';
import { getStatusColors } from '../utils/statusColors';
import {
  X,
  Check,
  Clock,
  Users,
  UtensilsCrossed,
  Plus,
  Trash2,
  CheckCircle2,
  UserCheck,
  Link2,
  Ban
} from 'lucide-react';

interface TableDetailModalProps {
  table: TableRoom | null;
  onClose: () => void;
  onUpdateTable: (updatedTable: TableRoom) => void;
}

export const TableDetailModal: React.FC<TableDetailModalProps> = ({
  table,
  onClose,
  onUpdateTable,
}) => {
  if (!table) return null;

  const [selectedStatus, setSelectedStatus] = useState<TableStatus>(table.status);
  const [guestName, setGuestName] = useState(table.guestName || '');
  const [partySize, setPartySize] = useState<number>(table.partySize || table.capacity);
  const [notes, setNotes] = useState(table.notes || '');
  const [showAddDishMenu, setShowAddDishMenu] = useState(false);
  const [customDishName, setCustomDishName] = useState('');
  const [customDishCategory, setCustomDishCategory] = useState<'main' | 'starter' | 'drink' | 'dessert'>('main');

  const pendingCount = table.orders.filter((o) => o.status === 'pending').length;
  const servedCount = table.orders.filter((o) => o.status === 'served').length;
  const totalBill = table.orders.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Status changes
  const handleStatusChange = (newStatus: TableStatus) => {
    setSelectedStatus(newStatus);
    onUpdateTable({
      ...table,
      status: newStatus,
      // If setting to available, ask or preserve info
    });
  };

  // Toggle order item status (pending <-> served)
  const handleToggleItemStatus = (itemId: string) => {
    const updatedOrders = table.orders.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          status: (item.status === 'pending' ? 'served' : 'pending') as 'pending' | 'served',
        };
      }
      return item;
    });

    onUpdateTable({
      ...table,
      orders: updatedOrders,
    });
  };

  // Mark all items as served
  const handleMarkAllServed = () => {
    const updatedOrders = table.orders.map((item) => ({
      ...item,
      status: 'served' as const,
    }));
    onUpdateTable({
      ...table,
      orders: updatedOrders,
    });
  };

  // Add preset dish
  const handleAddPresetDish = (preset: typeof MENU_ITEMS_PRESET[0]) => {
    const newOrder: OrderItem = {
      id: `ord-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: preset.name,
      category: preset.category,
      quantity: 1,
      status: 'pending',
      orderedAt: 'Just now',
      price: preset.price,
    };

    onUpdateTable({
      ...table,
      status: table.status === 'available' ? 'occupied' : table.status,
      orders: [...table.orders, newOrder],
    });
    setShowAddDishMenu(false);
  };

  // Add custom dish
  const handleAddCustomDish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDishName.trim()) return;

    const newOrder: OrderItem = {
      id: `ord-${Date.now()}`,
      name: customDishName.trim(),
      category: customDishCategory,
      quantity: 1,
      status: 'pending',
      orderedAt: 'Just now',
      price: customDishCategory === 'drink' ? 14 : 26,
    };

    onUpdateTable({
      ...table,
      status: table.status === 'available' ? 'occupied' : table.status,
      orders: [...table.orders, newOrder],
    });
    setCustomDishName('');
    setShowAddDishMenu(false);
  };

  // Remove order item
  const handleRemoveItem = (itemId: string) => {
    const updatedOrders = table.orders.filter((i) => i.id !== itemId);
    onUpdateTable({
      ...table,
      orders: updatedOrders,
    });
  };

  // Save guest & notes
  const handleSaveDetails = () => {
    onUpdateTable({
      ...table,
      status: selectedStatus,
      guestName: guestName.trim() || undefined,
      partySize: Number(partySize) || table.capacity,
      notes: notes.trim() || undefined,
    });
  };

  // Clear / Checkout table
  const handleClearTable = () => {
    onUpdateTable({
      ...table,
      status: 'available',
      guestName: undefined,
      guestPhone: undefined,
      partySize: undefined,
      seatedTime: undefined,
      notes: undefined,
      orders: [],
    });
    onClose();
  };

  return (
    <div 
      id="table-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        id="table-detail-drawer"
        className="w-full max-w-2xl bg-[#141628] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100"
      >
        {/* Header Bar */}
        <div className="p-6 border-b border-white/10 flex items-start justify-between bg-gradient-to-r from-white/[0.04] to-transparent">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-lg">
              {table.code}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">{table.name}</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono">
                  Floor {table.floor} • Cap: {table.capacity}
                </span>
                {table.adminTableId != null && (
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono flex items-center gap-1"
                    title={`Synced with restoAdmin table #${table.adminTableId} (Blue Moon)`}
                  >
                    <Link2 className="w-3 h-3" />
                    Synced to: {table.adminTableName || `#${table.adminTableId}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {table.type === 'room' ? 'Private KTV Room' : table.type === 'booth' ? 'Dining Booth' : 'Dining Table'}
                {table.serverName ? ` • Server: ${table.serverName}` : ''}
              </p>
            </div>
          </div>

          <button
            id="btn-close-modal"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          {/* Quick Status Selector */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Current Table Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { status: 'available' as TableStatus, icon: Check, id: 'status-btn-available' },
                { status: 'occupied' as TableStatus, icon: Users, id: 'status-btn-occupied' },
                { status: 'reserved' as TableStatus, icon: Clock, id: 'status-btn-reserved' },
                { status: 'not_available' as TableStatus, icon: Ban, id: 'status-btn-not-available' },
              ]).map(({ status: s, icon: Icon, id }) => (
                <button
                  key={s}
                  id={id}
                  onClick={() => handleStatusChange(s)}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    selectedStatus === s
                      ? getStatusColors(s).activeButtonClass
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {getStatusColors(s).label}
                </button>
              ))}
            </div>
          </div>

          {/* Guest / Reservation Information Panel */}
          <div className="p-4 rounded-2xl bg-[#1a1c30] border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                Guest & Booking Information
              </span>
              {table.seatedTime && (
                <span className="text-[11px] text-amber-400 font-mono">
                  Seated: {table.seatedTime}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Guest Name</label>
                <input
                  id="input-guest-name"
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Dr. Vance, Walk-in"
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Party Size</label>
                <input
                  id="input-party-size"
                  type="number"
                  min="1"
                  max={table.capacity * 2}
                  value={partySize}
                  onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Dietary / Service Notes</label>
              <input
                id="input-table-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Anniversary, Peanut Allergy, Chilled wine"
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                id="btn-save-guest-info"
                onClick={handleSaveDetails}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
              >
                Update Guest Info
              </button>
            </div>
          </div>

          {/* Orders Section (Pending vs Served) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <UtensilsCrossed className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-bold text-white">Order Tracking</span>
                </div>
                <div className="text-xs text-slate-400">
                  {table.orders.length} dishes • {pendingCount} Pending • {servedCount} Served
                </div>
              </div>

              <div className="flex items-center gap-2">
                {pendingCount > 0 && (
                  <button
                    id="btn-mark-all-served"
                    onClick={handleMarkAllServed}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Mark All Served
                  </button>
                )}

                <button
                  id="btn-toggle-add-dish"
                  onClick={() => setShowAddDishMenu(!showAddDishMenu)}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  Add Dish
                </button>
              </div>
            </div>

            {/* Add Dish Selector Dropdown */}
            {showAddDishMenu && (
              <div className="p-4 rounded-2xl bg-[#1b1e36] border border-white/15 space-y-3 animate-in fade-in duration-150">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Quick Add from Menu:
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                  {MENU_ITEMS_PRESET.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => handleAddPresetDish(preset)}
                      className="text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 flex items-center justify-between text-xs transition-colors"
                    >
                      <span className="truncate text-slate-200">{preset.name}</span>
                      <span className="text-slate-400 font-mono ml-2 shrink-0">${preset.price}</span>
                    </button>
                  ))}
                </div>

                {/* Custom Item Input */}
                <form onSubmit={handleAddCustomDish} className="pt-2 border-t border-white/10 flex gap-2">
                  <input
                    type="text"
                    value={customDishName}
                    onChange={(e) => setCustomDishName(e.target.value)}
                    placeholder="Custom special or bottle..."
                    className="flex-1 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <select
                    value={customDishCategory}
                    onChange={(e) => setCustomDishCategory(e.target.value as any)}
                    className="px-2 py-1.5 rounded-xl bg-[#141628] border border-white/10 text-xs text-slate-300"
                  >
                    <option value="starter">Starter</option>
                    <option value="main">Main</option>
                    <option value="drink">Drink</option>
                    <option value="dessert">Dessert</option>
                  </select>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                  >
                    Add
                  </button>
                </form>
              </div>
            )}

            {/* List of Ordered Dishes */}
            {table.orders.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center text-slate-500 text-xs">
                No active orders for this table yet. Click "Add Dish" or change status to Occupied.
              </div>
            ) : (
              <div className="space-y-2">
                {table.orders.map((item) => {
                  const isPending = item.status === 'pending';
                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-2xl border flex items-center justify-between transition-all duration-200 ${
                        isPending
                          ? 'bg-amber-950/20 border-amber-500/30'
                          : 'bg-white/[0.03] border-white/5 opacity-85'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Interactive Clickable Status Toggle */}
                        <button
                          onClick={() => handleToggleItemStatus(item.id)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                            isPending
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500 hover:text-black'
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
                          }`}
                          title={isPending ? 'Click to mark as Served' : 'Click to mark as Pending'}
                        >
                          {isPending ? <Clock className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                        </button>

                        <div>
                          <div className="text-sm font-semibold text-white flex items-center gap-2">
                            <span>{item.quantity}x {item.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-slate-400 uppercase font-mono">
                              {item.category}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2">
                            <span>Ordered {item.orderedAt}</span>
                            {item.notes && <span className="text-amber-300 italic">• {item.notes}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-300">
                          ${item.price * item.quantity}
                        </span>

                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                          isPending
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {isPending ? 'Pending' : 'Served'}
                        </span>

                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-white/10 bg-[#0f1120] flex items-center justify-between">
          <div className="text-xs text-slate-400 font-mono">
            Subtotal: <span className="text-white font-bold text-sm">${totalBill.toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-3">
            {table.status === 'occupied' && (
              <button
                id="btn-checkout-clear-table"
                onClick={handleClearTable}
                className="px-4 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-colors"
              >
                Clear Table
              </button>
            )}

            <button
              id="btn-done-modal"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
