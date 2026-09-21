// 'reserved'/'not_available' mirror restoAdmin's own STATUS enum (see
// restoAdmin/src/components/users/Tables.tsx) so a zone linked to an admin
// table can represent any state admin can put it in without losing information.
export type TableStatus = 'available' | 'occupied' | 'reserved' | 'not_available';

export type OrderItemCategory = 'starter' | 'main' | 'drink' | 'dessert';

export interface OrderItem {
  id: string;
  name: string;
  category: OrderItemCategory;
  quantity: number;
  status: 'pending' | 'served';
  orderedAt: string; // e.g. "12m ago"
  price: number;
  notes?: string;
}

export type TableType = 'table' | 'booth' | 'room' | 'bar';

export interface TableRoom {
  id: string;
  name: string;
  code: string; // e.g. "T-01", "KTV-A"
  type: TableType;
  floor: 1 | 2;
  capacity: number;
  status: TableStatus;
  guestName?: string;
  guestPhone?: string;
  partySize?: number;
  seatedTime?: string;
  serverName?: string;
  notes?: string;
  orders: OrderItem[];
  // When set, this zone is linked to that restoAdmin restaurant_tables.IDNo
  // (Blue Moon branch only) — its status stays in sync with restoAdmin's
  // Table Settings in both directions. See src/services/adminSync.ts.
  adminTableId?: number;
  // Display name (restoAdmin's TABLE_NUMBER, e.g. "OUTSIDE", "BAR") for the
  // linked table above, so the UI can show what a zone is synced to without
  // an extra lookup. Kept in sync alongside adminTableId.
  adminTableName?: string;
  // Zone geometry on the interactive map: x/y is the top-left corner,
  // all four values are percentages (0-100) of the floor plan container.
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloorStats {
  totalTables: number;
  occupiedCount: number;
  availableCount: number;
  pendingOrdersCount: number;
  servedOrdersCount: number;
}
