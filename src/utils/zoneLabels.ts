import { TableRoom } from '../types';

// Whether a zone is a room: restoAdmin bills it an hourly ROOM_CHARGE
// (ROOM 1–13, FAMILY ROOM, ON AIR 1/2 today). Read from restoAdmin rather
// than floorLayout.json's `type`, which says "table" for every zone. A screen
// that fetched the rate itself can pass it as a fallback for before the
// first sync has filled in adminRoomCharge.
export function isRoomZone(table: TableRoom, fallbackRate = 0): boolean {
  return (table.adminRoomCharge ?? fallbackRate) > 0;
}

export function zoneKindLabel(table: TableRoom, fallbackRate = 0): string {
  return isRoomZone(table, fallbackRate) ? 'Room' : 'Table';
}

// "P1 • Floor 1 • Table" — how the order screens and Settle Order name a zone.
export function formatZoneSubtitle(table: TableRoom, fallbackRate = 0): string {
  return `${table.name} • Floor ${table.floor} • ${zoneKindLabel(table, fallbackRate)}`;
}
