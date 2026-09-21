import { TableStatus } from '../types';

export interface StatusColorScheme {
  label: string;
  /** Translucent zone fill so the floor plan art stays visible underneath. */
  fillRgba: string;
  glowRgba: string;
  borderClass: string;
  legendDotClass: string;
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
    activeButtonClass: 'bg-emerald-500/20 border-emerald-500 text-emerald-300',
  },
  occupied: {
    label: 'Occupied',
    fillRgba: 'rgba(245, 158, 11, 0.24)',
    glowRgba: 'rgba(245, 158, 11, 0.4)',
    borderClass: 'border-amber-400/70',
    legendDotClass: 'bg-amber-400',
    activeButtonClass: 'bg-amber-500/20 border-amber-500 text-amber-300',
  },
  reserved: {
    label: 'Reserved',
    fillRgba: 'rgba(59, 130, 246, 0.24)',
    glowRgba: 'rgba(59, 130, 246, 0.4)',
    borderClass: 'border-blue-400/70',
    legendDotClass: 'bg-blue-400',
    activeButtonClass: 'bg-blue-500/20 border-blue-500 text-blue-300',
  },
  not_available: {
    label: 'Not Available',
    fillRgba: 'rgba(244, 63, 94, 0.24)',
    glowRgba: 'rgba(244, 63, 94, 0.4)',
    borderClass: 'border-rose-400/70',
    legendDotClass: 'bg-rose-400',
    activeButtonClass: 'bg-rose-500/20 border-rose-500 text-rose-300',
  },
};

export function getStatusColors(status: TableStatus): StatusColorScheme {
  return STATUS_COLORS[status];
}
