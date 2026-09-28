import React, { useState, useEffect, useRef } from 'react';
import { TableRoom, TableStatus, AdminOrderSummary, InfoPanel } from './types';
import { INITIAL_TABLES } from './data/mockRestaurantData';
import { INITIAL_INFO_PANELS, migrateInfoPanels } from './data/infoPanels';
import { InfoPanelModal } from './components/InfoPanelModal';
import { Sidebar } from './components/Sidebar';
import { FloorPlanMap } from './components/FloorPlanMap';
import { TableDetailModal } from './components/TableDetailModal';
import { TableDirectoryView } from './components/TableDirectoryView';
import { OrderQueueView } from './components/OrderQueueView';
import { EditTableModal } from './components/EditTableModal';
import { ConfirmModal } from './components/ConfirmModal';
import { getAdminTables, getAdminTableStatus, setLink, statusFromAdmin, subscribeToAdminUpdates } from './services/adminSync';
import { subscribeToOrderUpdates, getActiveOrders, getActiveOrderForTable } from './services/orderSync';

// Bumped again from _v2: TableStatus narrowed from 4 states to 2
// (available/occupied only — see types.ts), and AdminOrderLineItem dropped
// its pending/served field. Old saves are simply ignored rather than
// migrated, same precedent as the _v1 -> _v2 bump.
const STORAGE_KEY_TABLES = 'restaurant_dashboard_tables_v3';
const STORAGE_KEY_INFO_PANELS = 'restaurant_dashboard_info_panels_v1';
const STORAGE_KEY_SHOW_INFO_PANELS = 'restaurant_dashboard_show_info_panels';
const VALID_STATUSES: TableStatus[] = ['available', 'occupied'];

export default function App() {
  // Load persisted tables or fall back to default mock dataset.
  // Older saves may carry a status from a retired scheme (e.g. legacy 'cleaning'); map those to 'available'.
  const [tables, setTables] = useState<TableRoom[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TABLES);
      if (saved) {
        const parsed: TableRoom[] = JSON.parse(saved);
        return parsed.map((t) =>
          !VALID_STATUSES.includes(t.status) ? { ...t, status: 'available' as const } : t
        );
      }
    } catch (e) {
      console.error('Failed to parse saved tables:', e);
    }
    return INITIAL_TABLES;
  });

  // Active Floor: 1 (Main Dining) or 2 (KTV Rooms)
  const [currentFloor, setCurrentFloor] = useState<1 | 2>(1);

  // Active Navigation Tab
  const [activeNav, setActiveNav] = useState<'floorplan' | 'directory' | 'orders'>('floorplan');

  // Currently Selected Table (for View & Order Status Modal)
  const [selectedTable, setSelectedTable] = useState<TableRoom | null>(null);

  // Quick Controls: Exactly the 2 requested buttons
  const [showAvailableFilter, setShowAvailableFilter] = useState(false);
  const [showOccupiedFilter, setShowOccupiedFilter] = useState(false);

  // Layout Placement / Drag Mode
  const [isEditLayoutMode, setIsEditLayoutMode] = useState(false);
  const [editingTable, setEditingTable] = useState<TableRoom | null>(null);
  const [newTableRect, setNewTableRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isEditTableModalOpen, setIsEditTableModalOpen] = useState(false);

  // In-App Confirmation Modal state (avoids window.confirm in iframe)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmText?: string;
    confirmVariant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => {},
  });

  // Info panels (floor plan widgets) and whether this device shows them —
  // both local to this browser, like the zone layout itself.
  const [infoPanels, setInfoPanels] = useState<InfoPanel[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INFO_PANELS);
      if (saved) return migrateInfoPanels(JSON.parse(saved));
    } catch (e) {
      console.error('Failed to parse saved info panels:', e);
    }
    return INITIAL_INFO_PANELS;
  });
  const [showInfoPanels, setShowInfoPanels] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_SHOW_INFO_PANELS) !== 'false';
    } catch {
      return true;
    }
  });
  // The panel whose settings modal is open, with its on-screen size at the
  // time (the modal greys out "Side by side" when it wouldn't fit).
  const [editingPanel, setEditingPanel] = useState<{ id: string; widthPx: number; heightPx: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INFO_PANELS, JSON.stringify(infoPanels));
    } catch (e) {
      console.error('Failed to save info panels:', e);
    }
  }, [infoPanels]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SHOW_INFO_PANELS, String(showInfoPanels));
    } catch {
      // Private mode / blocked storage: the toggle still works for this session.
    }
  }, [showInfoPanels]);

  const handleUpdateInfoPanelGeometry = (panelId: string, geometry: { x: number; y: number; width: number; height: number }) => {
    setInfoPanels((prev) => prev.map((p) => (p.id === panelId ? { ...p, ...geometry } : p)));
  };

  // A freshly drawn panel starts with Room Timers and opens its widget picker.
  const handleCreateInfoPanel = (
    floor: 1 | 2,
    rect: { x: number; y: number; width: number; height: number },
    size: { widthPx: number; heightPx: number }
  ) => {
    const panel: InfoPanel = { id: `panel-${Date.now()}`, floor, widgets: ['roomTimers'], layout: 'auto', ...rect };
    setInfoPanels((prev) => [...prev, panel]);
    setEditingPanel({ id: panel.id, ...size });
  };

  // Latest tables for the mount-once SSE subscriber below, whose closure
  // would otherwise only ever see the initial state.
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  // Persist tables changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TABLES, JSON.stringify(tables));
    } catch (e) {
      console.error('Failed to save tables:', e);
    }
  }, [tables]);

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
        const byId = new Map(adminTables.map((t) => [t.id, t]));
        setTables((prev) =>
          prev.map((t) => {
            if (t.adminTableId == null) return t;
            const remote = byId.get(t.adminTableId);
            if (!remote) return t;
            const remoteStatus = statusFromAdmin(remote.status);
            if (remoteStatus === t.status && remote.tableNumber === t.adminTableName) return t;
            return { ...t, status: remoteStatus, adminTableName: remote.tableNumber };
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
        grandTotal: event.grandTotal ?? 0,
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

  // Update a zone's position when dragged
  const handleUpdateTablePosition = (tableId: string, x: number, y: number) => {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, x, y } : t))
    );
  };

  // Update a zone's full geometry when resized via its border handles
  const handleUpdateTableGeometry = (
    tableId: string,
    geometry: { x: number; y: number; width: number; height: number }
  ) => {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, ...geometry } : t))
    );
  };

  // Add new table or update existing from EditTableModal
  const handleSaveTable = (tableToSave: TableRoom) => {
    setTables((prev) => {
      const exists = prev.some((t) => t.id === tableToSave.id);
      if (exists) {
        return prev.map((t) => (t.id === tableToSave.id ? tableToSave : t));
      }
      return [...prev, tableToSave];
    });
  };

  // Delete single table. Best-effort: also clears the restoAdmin link (if
  // any) so restoAdmin doesn't keep pointing at a zone that no longer exists.
  const handleDeleteTable = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (table?.adminTableId != null) {
      setLink(tableId, null).catch((err) =>
        console.error('Failed to clear restoAdmin link on delete:', err)
      );
    }
    setTables((prev) => prev.filter((t) => t.id !== tableId));
    if (selectedTable?.id === tableId) setSelectedTable(null);
  };

  // Safe prompt to delete a single table
  const handlePromptDeleteSingleTable = (table: TableRoom) => {
    setConfirmState({
      isOpen: true,
      title: `Delete ${table.name}?`,
      description: `Are you sure you want to remove "${table.name}" (${table.code}) from Floor ${table.floor}? Any current order tickets or guest details will be cleared.`,
      confirmText: 'Delete Table',
      confirmVariant: 'danger',
      onConfirm: () => {
        handleDeleteTable(table.id);
      },
    });
  };

  // Safe prompt to delete all zones on current floor
  const handlePromptDeleteAll = () => {
    const floorCount = tables.filter((t) => t.floor === currentFloor).length;
    setConfirmState({
      isOpen: true,
      title: `Delete all zones on Floor ${currentFloor}?`,
      description: `This will permanently delete all ${floorCount} table and room zones on Floor ${currentFloor}. You can immediately start drawing new zones on the floor plan from scratch.`,
      confirmText: `Delete All ${floorCount} Zones`,
      confirmVariant: 'danger',
      onConfirm: () => {
        tables
          .filter((t) => t.floor === currentFloor && t.adminTableId != null)
          .forEach((t) => {
            setLink(t.id, null).catch((err) =>
              console.error('Failed to clear restoAdmin link on delete:', err)
            );
          });
        setTables((prev) => prev.filter((t) => t.floor !== currentFloor));
        setSelectedTable(null);
      },
    });
  };

  // Open modal to add a new table/room from a freshly drawn zone rectangle
  const handleOpenNewTableModal = (rect: { x: number; y: number; width: number; height: number }) => {
    setEditingTable(null);
    setNewTableRect(rect);
    setIsEditTableModalOpen(true);
  };

  // Open modal to edit existing table info
  const handleOpenEditTableModal = (table: TableRoom) => {
    setEditingTable(table);
    setNewTableRect({ x: table.x, y: table.y, width: table.width, height: table.height });
    setIsEditTableModalOpen(true);
  };

  // Reset to initial sample state with confirmation modal
  const handleResetData = () => {
    setConfirmState({
      isOpen: true,
      title: 'Reset All Tables & Sample Orders?',
      description: 'This will restore the floor plan to the default set of tables, rooms, info panels, and sample guest orders.',
      confirmText: 'Reset Demo Data',
      confirmVariant: 'warning',
      onConfirm: () => {
        setTables(INITIAL_TABLES);
        setInfoPanels(INITIAL_INFO_PANELS);
        setSelectedTable(null);
        localStorage.removeItem(STORAGE_KEY_TABLES);
      },
    });
  };

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
        isEditLayoutMode={isEditLayoutMode}
        onToggleEditLayoutMode={() => setIsEditLayoutMode(!isEditLayoutMode)}
        tables={tables}
        onResetData={handleResetData}
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
            onToggleEditMode={() => setIsEditLayoutMode(!isEditLayoutMode)}
            onUpdateTablePosition={handleUpdateTablePosition}
            onUpdateTableGeometry={handleUpdateTableGeometry}
            onOpenNewTableModal={handleOpenNewTableModal}
            onOpenEditTableModal={handleOpenEditTableModal}
            onPromptDeleteSingleTable={handlePromptDeleteSingleTable}
            onPromptDeleteAll={handlePromptDeleteAll}
            infoPanels={infoPanels}
            showInfoPanels={showInfoPanels}
            onToggleInfoPanels={() => setShowInfoPanels((prev) => !prev)}
            onUpdateInfoPanelGeometry={handleUpdateInfoPanelGeometry}
            onCreateInfoPanel={handleCreateInfoPanel}
            onOpenInfoPanel={(panel, size) => setEditingPanel({ id: panel.id, ...size })}
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
          onOpenLinkModal={handleOpenEditTableModal}
        />
      )}

      {/* Edit Table / Draw New Zone Modal */}
      <EditTableModal
        isOpen={isEditTableModalOpen}
        onClose={() => setIsEditTableModalOpen(false)}
        table={editingTable}
        newRect={newTableRect}
        currentFloor={currentFloor}
        onSave={handleSaveTable}
        onDelete={handleDeleteTable}
      />

      {/* Safe In-App Confirmation Modal (Replaces window.confirm) */}
      <InfoPanelModal
        panel={infoPanels.find((p) => p.id === editingPanel?.id) ?? null}
        panelSize={editingPanel}
        onClose={() => setEditingPanel(null)}
        onSave={(id, changes) => {
          setInfoPanels((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p)));
          setEditingPanel(null);
        }}
        onDelete={(id) => {
          setInfoPanels((prev) => prev.filter((p) => p.id !== id));
          setEditingPanel(null);
        }}
      />

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        description={confirmState.description}
        confirmText={confirmState.confirmText}
        confirmVariant={confirmState.confirmVariant}
      />
    </div>
  );
}
