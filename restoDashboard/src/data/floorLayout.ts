import { InfoPanel, TableRoom } from '../types';
import layout from './floorLayout.json';

// The restaurant's fixed floor plan: every zone (with its restoAdmin table
// link) and every info panel (with its widgets and each widget's starting
// floor). Positions are percentages of the 16:9 floor plan images.
//
// This file is the single source of truth — devices don't keep their own
// copy, so every screen shows the same layout. To change it, re-enable the
// layout editor and paste its draft over floorLayout.json; see
// docs/layout-editor.md.

// A zone as stored in the layout: its runtime fields (status, activeOrder,
// adminRoomCharge) come live from restoAdmin instead.
export type LayoutZone = Omit<TableRoom, 'status' | 'activeOrder' | 'adminRoomCharge' | 'serverName'>;

export interface FloorLayout {
  zones: LayoutZone[];
  panels: InfoPanel[];
}

export const FLOOR_LAYOUT = layout as FloorLayout;

// Zones as the app starts with them, before restoAdmin reports live status.
export function zonesFromLayout(zones: LayoutZone[]): TableRoom[] {
  return zones.map((zone) => ({ ...zone, status: 'available' }));
}

// The inverse, for the layout editor's draft: just the layout fields, so a
// copied draft can be pasted straight over floorLayout.json.
export function toFloorLayout(tables: TableRoom[], panels: InfoPanel[]): FloorLayout {
  return {
    zones: tables.map(({ id, name, code, type, floor, capacity, adminTableId, adminTableName, x, y, width, height }) => ({
      id, name, code, type, floor, capacity, adminTableId, adminTableName, x, y, width, height,
    })),
    panels,
  };
}
