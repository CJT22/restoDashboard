// Mirrors restoAdmin's own restaurant_tables.STATUS (see
// restoAdmin/src/components/users/Tables.tsx) — just Available/Occupied.
// Table status is a pure reflection of order lifecycle (restoAdmin already
// flips it automatically on order create/confirm/settle/cancel) for any
// linked zone; the dashboard never sets it directly. See App.tsx's
// applyRemoteStatus and src/services/adminSync.ts.
export type TableStatus = 'available' | 'occupied';

// Real order data sourced from restoAdmin (orders/order_items), not
// dashboard-local — see src/services/orderSync.ts. A zone has at most one
// active order at a time, matching restoAdmin's own one-order-per-table rule.
export interface AdminOrderLineItem {
  id: number; // order_items.IDNo
  menuId: number;
  name: string; // MENU_NAME
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface AdminOrderSummary {
  id: number; // orders.IDNo
  orderNo: string;
  orderType: string | null;
  status: number; // restoAdmin's STATUS enum (3=Pending, 2=Confirmed, 1=Settled, -1=Cancelled)
  subtotal: number;
  // orders.SERVICE_CHARGE — includes the linked table's room charge (see
  // restoAdmin's OrderModel.resolveServiceChargeWithRoomCharge), which is
  // never a line item in `items`. Optional because the order_created/
  // order_updated SSE event doesn't carry it yet; a full refetch does.
  serviceCharge?: number;
  grandTotal: number;
  items: AdminOrderLineItem[];
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
  serverName?: string;
  // This zone's real, admin-sourced active order (undefined = no open order).
  // Only meaningful when adminTableId is set — see src/services/orderSync.ts.
  activeOrder?: AdminOrderSummary;
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
