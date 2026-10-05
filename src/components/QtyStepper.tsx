import React from 'react';
import { Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';

interface QtyStepperProps {
  // Pre-formatted amount shown between the buttons (e.g. "₱300.00").
  amount: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  // The trailing slot holds either a remove (trash) button for order items
  // or a reset button for the room charge (back to its minimum). The slot is
  // always reserved so −/amount/+ line up across every row in a list.
  onRemove?: () => void;
  onReset?: () => void;
  resetDisabled?: boolean;
  resetLabel?: string;
}

// The − ₱amount + control shared by the room-charge row and order-item rows
// on the order screens' carts and in TableDetailModal. Fixed widths keep the columns aligned.
export const QtyStepper: React.FC<QtyStepperProps> = ({
  amount,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  onRemove,
  onReset,
  resetDisabled,
  resetLabel = 'Reset',
}) => (
  <div className="flex items-center gap-2 shrink-0">
    <button
      type="button"
      onClick={onDecrement}
      disabled={decrementDisabled}
      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300"
      aria-label="Decrease"
    >
      <Minus className="w-3.5 h-3.5" />
    </button>
    <span className="font-mono text-xs text-slate-300 w-20 text-center tabular-nums">{amount}</span>
    <button
      type="button"
      onClick={onIncrement}
      disabled={incrementDisabled}
      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300"
      aria-label="Increase"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
    <div className="w-7 h-7 flex items-center justify-center">
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
          title="Remove item"
          aria-label="Remove item"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      {!onRemove && onReset && (
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500"
          title={resetLabel}
          aria-label={resetLabel}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  </div>
);
