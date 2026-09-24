import { useEffect, useState } from 'react';
import { AdminOrderSummary } from '../types';

// Countdown for an hourly room's booking (the linked table has a ROOM_CHARGE),
// derived purely from data restoAdmin already stores — nothing here is
// persisted. Booked hours come from SERVICE_CHARGE / rate (the same derivation
// TableDetailModal's room-charge stepper uses), and the booking ends at order
// creation + booked hours. An hours change in either app just moves the end
// time, so extending an expired room brings its countdown back and cutting
// hours below the time already used flips it straight to overtime.
// Tables without a room charge get no timer at all.
export interface RoomTiming {
  hours: number;
  startMs: number;
  endMs: number;
  remainingMs: number; // negative once expired = overtime
  expired: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export function getRoomTiming(order: AdminOrderSummary | undefined, nowMs: number): RoomTiming | null {
  const rate = order?.roomRate ?? 0;
  // Without SERVICE_CHARGE the booked hours are unknown — show nothing
  // rather than a countdown that might be wrong.
  if (!order?.createdAt || rate <= 0 || order.serviceCharge == null) return null;
  const startMs = Date.parse(order.createdAt);
  if (!Number.isFinite(startMs)) return null;

  const hours = Math.max(1, Math.round((order.serviceCharge / rate) * 2) / 2);
  const endMs = startMs + hours * HOUR_MS;
  const remainingMs = endMs - nowMs;
  return { hours, startMs, endMs, remainingMs, expired: remainingMs <= 0 };
}

// h:mm:ss, e.g. 1:05:09.
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 2 -> "2h", 1.5 -> "1.5h".
export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Current time, re-rendering the caller every second while `enabled`.
export function useNow(enabled: boolean = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}
