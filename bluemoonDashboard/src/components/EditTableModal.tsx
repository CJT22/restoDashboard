import React, { useState, useEffect } from 'react';
import { TableRoom, TableStatus } from '../types';
import { getStatusColors } from '../utils/statusColors';
import { X, Trash2, Check, Square } from 'lucide-react';

interface EditTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: TableRoom | null; // null if creating new table
  newRect: { x: number; y: number; width: number; height: number } | null;
  currentFloor: 1 | 2;
  onSave: (table: TableRoom) => void;
  onDelete?: (tableId: string) => void;
}

export const EditTableModal: React.FC<EditTableModalProps> = ({
  isOpen,
  onClose,
  table,
  newRect,
  currentFloor,
  onSave,
  onDelete,
}) => {
  if (!isOpen) return null;

  const isEditing = Boolean(table);

  const [name, setName] = useState(table?.name || '');
  const [code, setCode] = useState(table?.code || '');
  const [capacity, setCapacity] = useState<number>(table?.capacity || 4);
  const [status, setStatus] = useState<TableStatus>(table?.status || 'available');

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    setIsConfirmingDelete(false);
    if (table) {
      setName(table.name);
      setCode(table.code);
      setCapacity(table.capacity);
      setStatus(table.status);
    } else {
      // Auto-suggest next name/code based on timestamp
      const randomNum = Math.floor(10 + Math.random() * 89);
      setName(`Table ${randomNum}`);
      setCode(`T-${randomNum}`);
      setCapacity(4);
      setStatus('available');
    }
  }, [table, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (isEditing && table) {
      onSave({
        ...table,
        name: name.trim(),
        code: code.trim() || name.slice(0, 5).toUpperCase(),
        capacity: Number(capacity) || 4,
        status,
      });
    } else if (newRect) {
      const newTable: TableRoom = {
        id: `tbl-${Date.now()}`,
        name: name.trim(),
        code: code.trim() || name.slice(0, 5).toUpperCase(),
        type: 'table',
        floor: currentFloor,
        capacity: Number(capacity) || 4,
        status,
        x: newRect.x,
        y: newRect.y,
        width: newRect.width,
        height: newRect.height,
        orders: [],
      };
      onSave(newTable);
    }
    onClose();
  };

  return (
    <div 
      id="edit-table-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[#141628] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Square className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">
                {isEditing ? `Edit ${table?.name}` : 'Name Your New Zone'}
              </h3>
              <p className="text-xs text-slate-400">
                Floor {currentFloor} {newRect ? `• Size: ${Math.round(newRect.width)}%×${Math.round(newRect.height)}%` : ''}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Table / Room Name
            </label>
            <input
              id="input-new-table-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Table 15, VIP Cellar, Booth 3"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Short Code / Tag
              </label>
              <input
                id="input-new-table-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. T-15"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Seating Capacity
              </label>
              <input
                id="input-new-table-capacity"
                type="number"
                min="1"
                max="50"
                value={capacity}
                onChange={(e) => setCapacity(parseInt(e.target.value) || 1)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Initial Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStatus('available')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  status === 'available'
                    ? getStatusColors('available').activeButtonClass
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                Available
              </button>

              <button
                type="button"
                onClick={() => setStatus('occupied')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  status === 'occupied'
                    ? getStatusColors('occupied').activeButtonClass
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                Occupied
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            {isEditing && table && onDelete ? (
              isConfirmingDelete ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(table.id);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/30 flex items-center gap-1 animate-in fade-in duration-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Confirm Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDelete(false)}
                    className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-xs"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(true)}
                  className="px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Zone
                </button>
              )
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                id="btn-save-edit-table"
                type="submit"
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                {isEditing ? 'Save Changes' : 'Create Zone'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
