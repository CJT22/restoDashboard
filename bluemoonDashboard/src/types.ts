export type TableStatus = 'available' | 'occupied';

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
