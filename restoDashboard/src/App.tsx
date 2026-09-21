import React, { useState, useEffect } from 'react';
import { TableRoom, TableStatus } from './types';
import { INITIAL_TABLES } from './data/mockRestaurantData';
import { Sidebar } from './components/Sidebar';
import { FloorPlanMap } from './components/FloorPlanMap';
import { TableDetailModal } from './components/TableDetailModal';
import { TableDirectoryView } from './components/TableDirectoryView';
import { OrderQueueView } from './components/OrderQueueView';
import { EditTableModal } from './components/EditTableModal';
import { ConfirmModal } from './components/ConfirmModal';
import { getAdminTables, pushStatus, setLink, statusFromAdmin, subscribeToAdminUpdates } from './services/adminSync';

const STORAGE_KEY_TABLES = 'restaurant_dashboard_tables_v1';
const VALID_STATUSES: TableStatus[] = ['available', 'occupied', 'reserved', 'not_available'];

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

  // Persist tables changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TABLES, JSON.stringify(tables));
    } catch (e) {
      console.error('Failed to save tables:', e);
    }
  }, [tables]);

  // Handle table updates from detail modal or kitchen queue.
  // When the table is linked to a restoAdmin table and its status actually
  // changed, push that status to restoAdmin too (fire-and-forget: local
  // state already reflects the change either way).
  const handleUpdateTable = (updatedTable: TableRoom) => {
    const previous = tables.find((t) => t.id === updatedTable.id);
    if (
      updatedTable.adminTableId != null &&
      previous &&
      previous.status !== updatedTable.status
    ) {
      pushStatus(updatedTable.adminTableId, updatedTable.status).catch((err) => {
        console.error('Failed to push status to restoAdmin:', err);
      });
    }

    setTables((prev) =>
      prev.map((t) => (t.id === updatedTable.id ? updatedTable : t))
    );
    if (selectedTable?.id === updatedTable.id) {
      setSelectedTable(updatedTable);
    }
  };

  // Apply a status change that originated in restoAdmin (Table Settings edit,
  // or its order pipeline's auto status flips). Deliberately does NOT call
  // pushStatus — re-pushing what admin just told us would ping-pong the same
  // change back and forth between the two apps.
  const applyRemoteStatus = (adminTableId: number, status: TableRoom['status']) => {
    setTables((prev) =>
      prev.map((t) => (t.adminTableId === adminTableId && t.status !== status ? { ...t, status } : t))
    );
    setSelectedTable((prev) =>
      prev && prev.adminTableId === adminTableId && prev.status !== status ? { ...prev, status } : prev
    );
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

    const unsubscribe = subscribeToAdminUpdates(({ adminTableId, status }) => {
      applyRemoteStatus(adminTableId, status);
    });
    return unsubscribe;
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
      description: `This will permanently delete all ${floorCount} table and room zones on Floor ${currentFloor}. You can immediately start drawing new zones on your 1774×887 floor plan from scratch.`,
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

  // Push every linked zone's current status to restoAdmin in one go. Mainly
  // a manual "fix drift" tool — e.g. for zones linked before a status push
  // was wired into the linking flow itself (linking alone only points
  // restoAdmin at a zone, it doesn't set its status), or if a push ever
  // silently failed. Safe to run any time: idempotent, re-asserts the
  // dashboard's current state rather than destroying anything.
  const [isResyncingAdmin, setIsResyncingAdmin] = useState(false);
  const [resyncResult, setResyncResult] = useState<string | null>(null);
  const handleResyncLinkedTables = async () => {
    const linked = tables.filter((t) => t.adminTableId != null);
    if (linked.length === 0 || isResyncingAdmin) return;

    setIsResyncingAdmin(true);
    setResyncResult(null);
    const results = await Promise.allSettled(
      linked.map((t) => pushStatus(t.adminTableId as number, t.status))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`Failed to sync "${linked[i].name}" to restoAdmin:`, r.reason);
      }
    });

    setIsResyncingAdmin(false);
    setResyncResult(
      failed === 0
        ? `Synced ${linked.length}/${linked.length} linked tables.`
        : `Synced ${linked.length - failed}/${linked.length} — ${failed} failed (see console).`
    );
    setTimeout(() => setResyncResult(null), 6000);
  };

  // Reset to initial sample state with confirmation modal
  const handleResetData = () => {
    setConfirmState({
      isOpen: true,
      title: 'Reset All Tables & Sample Orders?',
      description: 'This will restore the floor plan to the default set of tables, rooms, and sample guest orders.',
      confirmText: 'Reset Demo Data',
      confirmVariant: 'warning',
      onConfirm: () => {
        setTables(INITIAL_TABLES);
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
        onSelectFloor={(floor) => setCurrentFloor(floor)}
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
        onResyncAdmin={handleResyncLinkedTables}
        isResyncingAdmin={isResyncingAdmin}
        resyncResult={resyncResult}
      />

      {/* Main View Area */}
      <main className="flex-1 h-screen relative flex flex-col overflow-hidden">
        {activeNav === 'floorplan' && (
          <FloorPlanMap
            floor={currentFloor}
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
            onUpdateTable={handleUpdateTable}
            onSelectTable={(table) => setSelectedTable(table)}
            currentFloor={currentFloor}
            onSelectFloor={(floor) => setCurrentFloor(floor)}
          />
        )}
      </main>

      {/* Interactive Table / Room Detail Modal (View Status & Orders) */}
      <TableDetailModal
        table={selectedTable}
        onClose={() => setSelectedTable(null)}
        onUpdateTable={handleUpdateTable}
      />

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
