import { TableStatus } from '../types';

export interface StatusColorScheme {
  label: string;
  /** Translucent zone fill so the floor plan art stays visible underneath. */
  fillRgba: string;
  glowRgba: string;
  borderClass: string;
  legendDotClass: string;
  legendTextClass: string;
  /** Composed classes for the active/selected state of a status-picker button. */
  activeButtonClass: string;
}

const STATUS_COLORS: Record<TableStatus, StatusColorScheme> = {
  available: {
    label: 'Available',
    fillRgba: 'rgba(16, 185, 129, 0.24)',
    glowRgba: 'rgba(16, 185, 129, 0.4)',
    borderClass: 'border-emerald-400/70',
    legendDotClass: 'bg-emerald-400',
    legendTextClass: 'text-emerald-300',
    activeButtonClass: 'bg-emerald-500/20 border-emerald-500 text-emerald-300',
  },
  occupied: {
    label: 'Occupied',
    fillRgba: 'rgba(245, 158, 11, 0.24)',
    glowRgba: 'rgba(245, 158, 11, 0.4)',
    borderClass: 'border-amber-400/70',
    legendDotClass: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]',
    legendTextClass: 'text-amber-300',
    activeButtonClass: 'bg-amber-500/20 border-amber-500 text-amber-300',
  },
  // Reserved and Not Available are display-only: set from restoAdmin's Table
  // Settings, never from the dashboard. Blue/red match restoAdmin's badges.
  reserved: {
    label: 'Reserved',
    fillRgba: 'rgba(14, 165, 233, 0.24)',
    glowRgba: 'rgba(14, 165, 233, 0.4)',
    borderClass: 'border-sky-400/70',
    legendDotClass: 'bg-sky-400',
    legendTextClass: 'text-sky-300',
    activeButtonClass: 'bg-sky-500/20 border-sky-500 text-sky-300',
  },
  unavailable: {
    label: 'Not Available',
    fillRgba: 'rgba(244, 63, 94, 0.24)',
    glowRgba: 'rgba(244, 63, 94, 0.4)',
    borderClass: 'border-rose-400/70',
    legendDotClass: 'bg-rose-400',
    legendTextClass: 'text-rose-300',
    activeButtonClass: 'bg-rose-500/20 border-rose-500 text-rose-300',
  },
};

// Every status, in the order the floor plan's legend lists them.
export const ALL_TABLE_STATUSES: TableStatus[] = ['available', 'occupied', 'reserved', 'unavailable'];

export function getStatusColors(status: TableStatus): StatusColorScheme {
  return STATUS_COLORS[status];
}
