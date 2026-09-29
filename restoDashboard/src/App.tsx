import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { TableRoom, AdminOrderSummary, InfoPanel } from './types';
import { FLOOR_LAYOUT, FloorLayout, toFloorLayout, zonesFromLayout } from './data/floorLayout';
import { Sidebar } from './components/Sidebar';
import { FloorPlanMap } from './components/FloorPlanMap';
import { TableDetailModal } from './components/TableDetailModal';
import { TableDirectoryView } from './components/TableDirectoryView';
import { OrderQueueView } from './components/OrderQueueView';
import { getAdminTables, getAdminTableStatus, statusFromAdmin, subscribeToAdminUpdates, warnOnLayoutLinkDrift } from './services/adminSync';
import { subscribeToOrderUpdates, getActiveOrders, getActiveOrderForTable } from './services/orderSync';
import { LAYOUT_EDITOR_ENABLED } from './config/layoutEditor';

// The dormant layout editor (see src/config/layoutEditor.ts). With the flag
// off this is a constant null, so the editor is neither loaded nor bundled.
const LayoutEditor = LAYOUT_EDITOR_ENABLED ? lazy(() => import('./layoutEditor/LayoutEditor')) : null;

// The layout editor's work in progress, in floorLayout.json's exact shape so
// it can be copied straight over it (docs/layout-editor.md). Only read or
// written while the editor is enabled.
const STORAGE_KEY_LAYOUT_DRAFT = 'restaurant_dashboard_layout_draft';
const STORAGE_KEY_SHOW_INFO_PANELS = 'restaurant_dashboard_show_info_panels';

// Per-device copies of the zone layout, info panels and widget choices from
// before the layout was fixed in src/data/floorLayout.json. Nothing reads
// them anymore; cleared once on load so old devices don't keep carrying them.
const LEGACY_STORAGE_KEYS = [
  'restaurant_dashboard_tables_v1',
  'restaurant_dashboard_tables_v2',
  'restaurant_dashboard_tables_v3',
  'restaurant_dashboard_info_panels_v1',
  'restaurant_dashboard_sales_period',
];
const LEGACY_STORAGE_PREFIXES = ['restaurant_dashboard_widget_floor:'];

function clearLegacyStorage() {
  try {
    const stale = Object.keys(localStorage).filter(
      (key) => LEGACY_STORAGE_KEYS.includes(key) || LEGACY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
    stale.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing to clear.
  }
}

// Only needed to compare against the editor's draft.
const FIXED_LAYOUT_JSON = LAYOUT_EDITOR_ENABLED ? JSON.stringify(FLOOR_LAYOUT, null, 2) : '';

// The fixed layout — or, while the layout editor is enabled, its draft.
function loadLayout(): FloorLayout {
  if (LAYOUT_EDITOR_ENABLED) {
    try {
      const draft = localStorage.getItem(STORAGE_KEY_LAYOUT_DRAFT);
      if (draft) return JSON.parse(draft);
    } catch (e) {
      console.error('Failed to read the layout editor draft; using floorLayout.json:', e);
    }
  }
  return FLOOR_LAYOUT;
}

const initialLayout = loadLayout();

export default function App() {
  // Zones and info panels come from the fixed layout on every device; each
  // zone's status and order are filled in live from restoAdmin below.
  const [tables, setTables] = useState<TableRoom[]>(() => zonesFromLayout(initialLayout.zones));
  const [infoPanels, setInfoPanels] = useState<InfoPanel[]>(() => initialLayout.panels);

  // Active Floor: 1 (Main Dining) or 2 (KTV Rooms)
  const [currentFloor, setCurrentFloor] = useState<1 | 2>(1);

  // Active Navigation Tab
  const [activeNav, setActiveNav] = useState<'floorplan' | 'directory' | 'orders'>('floorplan');

  // Currently Selected Table (for View & Order Status Modal)
  const [selectedTable, setSelectedTable] = useState<TableRoom | null>(null);

  // Quick Controls: Exactly the 2 requested buttons
  const [showAvailableFilter, setShowAvailableFilter] = useState(false);
  const [showOccupiedFilter, setShowOccupiedFilter] = useState(false);

  // Layout editor (Edit Zones) — can only turn on when LAYOUT_EDITOR_ENABLED.
  const [isEditLayoutMode, setIsEditLayoutMode] = useState(false);

  useEffect(() => {
    clearLegacyStorage();
  }, []);

  // Keep the editor's draft whenever it differs from floorLayout.json, and
  // drop it once it matches again (e.g. after pasting it in, or Discard
  // Changes), so a stale draft never shadows a newer fixed layout.
  useEffect(() => {
    if (!LAYOUT_EDITOR_ENABLED) return;
    try {
      const draft = JSON.stringify(toFloorLayout(tables, infoPanels), null, 2);
      if (draft === FIXED_LAYOUT_JSON) localStorage.removeItem(STORAGE_KEY_LAYOUT_DRAFT);
      else localStorage.setItem(STORAGE_KEY_LAYOUT_DRAFT, draft);
    } catch (e) {
      console.error('Failed to save the layout editor draft:', e);
    }
  }, [tables, infoPanels]);

  // Whether this device shows the info panels (a per-device view choice).
  const [showInfoPanels, setShowInfoPanels] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_SHOW_INFO_PANELS) !== 'false';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SHOW_INFO_PANELS, String(showInfoPanels));
    } catch {
      // Private mode / blocked storage: the toggle still works for this session.
    }
  }, [showInfoPanels]);

  // Latest tables for the mount-once SSE subscriber below, whose closure
  // would otherwise only ever see the initial state.
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  // Apply a status change that originated in restoAdmin (order create/confirm
  // /settle/cancel, or a direct Table Settings edit) — the only way a linked
  // zone's status ever changes now.
  const applyRemoteStatus = (adminTableId: number, status: TableRoom['status']) => {
    setTables((prev) =>
      prev.map((t) => (t.adminTableId === adminTableId && t.status !== status ? { ...t, status } : t))
    );
    setSelectedTable((prev) =>
      prev && prev.adminTableId === adminTableId && prev.status !== status ? { ...prev, status } : prev
    );
  };

  // Apply an order_created/order_updated event that originated in restoAdmin
  // (any of its New Order, Manual Order, or receipt-scan creation paths, or
  // an item-status change). Purely inbound, like applyRemoteStatus — never
  // re-emitted. Deliberately does NOT touch table.status: restoAdmin's own
  // table_updated event (already synced) is the single source of truth for
  // that, avoiding a race between the two channels.
  const applyRemoteOrder = (adminTableId: number, order: AdminOrderSummary | undefined) => {
    setTables((prev) => prev.map((t) => (t.adminTableId === adminTableId ? { ...t, activeOrder: order } : t)));
    setSelectedTable((prev) => (prev && prev.adminTableId === adminTableId ? { ...prev, activeOrder: order } : prev));
  };

  // Applies the result of a dashboard-initiated order action (create, add
  // items, item-status toggle) by table id. Deliberately merges into the
  // CURRENT state via setTables' updater rather than accepting a full
  // TableRoom snapshot from the caller: order actions await a network round
  // trip, and restoAdmin's table_updated flip (order created -> Occupied)
  // often lands over SSE *during* that wait. A snapshot captured before the
  // await would still say "available" and, passed through onUpdateTable,
  // would clobber the just-applied "occupied" status — and even push that
  // wrong reversion back to restoAdmin. Keying by id and only touching
  // activeOrder avoids that regardless of how the two race.
  const handleOrderChanged = (tableId: string, order: AdminOrderSummary | undefined) => {
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, activeOrder: order } : t)));
    setSelectedTable((prev) => (prev && prev.id === tableId ? { ...prev, activeOrder: order } : prev));

    // Belt-and-suspenders alongside the SSE table_updated channel below: the
    // action that produced this order change (create/confirm/cancel/settle)
    // also just flipped this table's status in restoAdmin, but that push may
    // have been missed by this tab (see getAdminTableStatus). Pull the
    // authoritative status directly so THIS browser's own actions never
    // depend on that race — applyRemoteStatus already no-ops if the SSE
    // event got there first.
    const adminTableId = tables.find((t) => t.id === tableId)?.adminTableId;
    if (adminTableId != null) {
      getAdminTableStatus(adminTableId)
        .then((status) => {
          if (status) applyRemoteStatus(adminTableId, status);
        })
        .catch((err) => console.warn('Post-action status refresh failed:', err));
    }
  };

  // Reconcile linked tables with restoAdmin once on load (covers drift while
  // the dashboard was closed), then keep listening for live changes. Both
  // steps fail silently if the sync backend/restoAdmin aren't reachable —
  // the dashboard stays fully usable locally either way.
  useEffect(() => {
    getAdminTables()
      .then((adminTables) => {
        warnOnLayoutLinkDrift(initialLayout.zones, adminTables);
        const byId = new Map(adminTables.map((t) => [t.id, t]));
        setTables((prev) =>
          prev.map((t) => {
            if (t.adminTableId == null) return t;
            const remote = byId.get(t.adminTableId);
            if (!remote) return t;
            const remoteStatus = statusFromAdmin(remote.status);
            const roomCharge = remote.roomCharge ?? undefined;
            if (
              remoteStatus === t.status &&
              remote.tableNumber === t.adminTableName &&
              roomCharge === t.adminRoomCharge
            ) return t;
            return { ...t, status: remoteStatus, adminTableName: remote.tableNumber, adminRoomCharge: roomCharge };
          })
        );
      })
      .catch((err) => console.warn('Initial restoAdmin reconciliation failed:', err));

    // Same reconciliation, but for order data: without this, a table with a
    // pre-existing Pending/Confirmed order would correctly show Occupied
    // (from the status reconciliation above) but have no activeOrder — so
    // it wouldn't appear on "Active Orders" or show its Confirm/Cancel/Settle
    // actions until someone happened to open its detail modal. Batched into
    // one call (getActiveOrders) rather than one per linked table.
    getActiveOrders()
      .then((entries) => {
        const orderByAdminTableId = new Map(entries.map((e) => [e.adminTableId, e.order]));
        setTables((prev) =>
          prev.map((t) => (t.adminTableId != null ? { ...t, activeOrder: orderByAdminTableId.get(t.adminTableId) } : t))
        );
      })
      .catch((err) => console.warn('Initial active-orders reconciliation failed:', err));

    const unsubscribeTables = subscribeToAdminUpdates(({ adminTableId, status }) => {
      applyRemoteStatus(adminTableId, status);
    });

    // order_created/order_updated already carry the full item list, so this
    // builds the zone's activeOrder straight from the event — no extra
    // round-trip. Only Pending (3) / Confirmed (2) count as "active"; a
    // settled or cancelled order (e.g. from Manual Order, or restoAdmin's
    // own settle flow) clears the zone's active order instead.
    const unsubscribeOrders = subscribeToOrderUpdates((event) => {
      if (event.tableId == null) return;
      const isActive = event.status === 2 || event.status === 3;
      if (!isActive) {
        applyRemoteOrder(event.tableId, undefined);
        return;
      }

      // Only restoAdmin's create/full-update events carry the room-timer
      // fields (serviceCharge/roomRate/createdAt); item-level events don't,
      // so keep what this zone already knew about the same order.
      const adminTableId = event.tableId;
      const prev = tablesRef.current.find((t) => t.adminTableId === adminTableId)?.activeOrder;
      const known = prev && prev.id === event.orderId ? prev : undefined;
      const order: AdminOrderSummary = {
        id: event.orderId,
        orderNo: event.orderNo ?? '',
        orderType: null,
        status: event.status ?? 0,
        subtotal: event.items.reduce((sum, i) => sum + i.lineTotal, 0),
        serviceCharge: event.serviceCharge ?? known?.serviceCharge,
        roomRate: event.roomRate ?? known?.roomRate,
        createdAt: event.createdAt ?? known?.createdAt,
        grandTotal: event.grandTotal ?? known?.grandTotal ?? 0,
        items: event.items,
      };
      applyRemoteOrder(adminTableId, order);

      // An order this tab hasn't seen in full (e.g. created through one of
      // restoAdmin's other paths): pull it once so its timer can start.
      if (!order.createdAt) {
        getActiveOrderForTable(adminTableId)
          .then((fresh) => applyRemoteOrder(adminTableId, fresh ?? undefined))
          .catch((err) => console.warn('Order refetch for room timer failed:', err));
      }
    });

    return () => {
      unsubscribeTables();
      unsubscribeOrders();
    };
    // Runs once on mount only — resubscribing per-render would open a new SSE connection every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0b0c16] text-slate-100 font-sans">
      {/* Left Navigation Sidebar matching Sample_UI.png with user's 2 quick control filters */}
      <Sidebar
        currentFloor={currentFloor}
        activeNav={activeNav}
        onSelectNav={(nav) => setActiveNav(nav)}
        showAvailableFilter={showAvailableFilter}
        onToggleAvailableFilter={() => setShowAvailableFilter(!showAvailableFilter)}
        showOccupiedFilter={showOccupiedFilter}
        onToggleOccupiedFilter={() => setShowOccupiedFilter(!showOccupiedFilter)}
        tables={tables}
      />

      {/* Main View Area */}
      <main className="flex-1 h-screen relative flex flex-col overflow-hidden">
        {activeNav === 'floorplan' && (
          <FloorPlanMap
            floor={currentFloor}
            onSelectFloor={(floor) => setCurrentFloor(floor)}
            tables={tables}
            selectedTableId={selectedTable?.id || null}
            onSelectTable={(table) => setSelectedTable(table)}
            showAvailableFilter={showAvailableFilter}
            showOccupiedFilter={showOccupiedFilter}
            isEditMode={isEditLayoutMode}
            onToggleEditMode={() => setIsEditLayoutMode((prev) => !prev)}
            editor={
              LayoutEditor && isEditLayoutMode ? (
                <Suspense fallback={null}>
                  <LayoutEditor
                    floor={currentFloor}
                    tables={tables}
                    setTables={setTables}
                    infoPanels={infoPanels}
                    setInfoPanels={setInfoPanels}
                  />
                </Suspense>
              ) : null
            }
            infoPanels={infoPanels}
            showInfoPanels={showInfoPanels}
            onToggleInfoPanels={() => setShowInfoPanels((prev) => !prev)}
          />
        )}

        {activeNav === 'directory' && (
          <TableDirectoryView
            tables={tables}
            onSelectTable={(table) => setSelectedTable(table)}
            currentFloor={currentFloor}
            onSelectFloor={(floor) => setCurrentFloor(floor)}
          />
        )}

        {activeNav === 'orders' && (
          <OrderQueueView
            tables={tables}
            onOrderChanged={handleOrderChanged}
            onSelectTable={(table) => setSelectedTable(table)}
            currentFloor={currentFloor}
            onSelectFloor={(floor) => setCurrentFloor(floor)}
          />
        )}
      </main>

      {/* Interactive Table / Room Detail Modal (View Status & Orders) */}
      {/* Keyed by zone so its per-zone state (new-order vs. detail view)
          starts fresh for every zone opened. */}
      {selectedTable && (
        <TableDetailModal
          key={selectedTable.id}
          table={selectedTable}
          onClose={() => setSelectedTable(null)}
          onOrderChanged={handleOrderChanged}
        />
      )}
    </div>
  );
}
