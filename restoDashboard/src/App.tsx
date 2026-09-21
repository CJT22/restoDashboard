import React, { useState, useEffect } from 'react';
import { TableRoom } from './types';
import { INITIAL_TABLES } from './data/mockRestaurantData';
import { Sidebar } from './components/Sidebar';
import { FloorPlanMap } from './components/FloorPlanMap';
import { TableDetailModal } from './components/TableDetailModal';
import { TableDirectoryView } from './components/TableDirectoryView';
import { OrderQueueView } from './components/OrderQueueView';
import { EditTableModal } from './components/EditTableModal';
import { ConfirmModal } from './components/ConfirmModal';

const STORAGE_KEY_TABLES = 'restaurant_dashboard_tables_v1';

export default function App() {
  // Load persisted tables or fall back to default mock dataset.
  // Older saves may still carry the retired 'reserved'/'cleaning' statuses; map them to 'available'.
  const [tables, setTables] = useState<TableRoom[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TABLES);
      if (saved) {
        const parsed: TableRoom[] = JSON.parse(saved);
        return parsed.map((t) =>
          t.status !== 'available' && t.status !== 'occupied'
            ? { ...t, status: 'available' as const }
            : t
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

  // Handle table updates from detail modal or kitchen queue
  const handleUpdateTable = (updatedTable: TableRoom) => {
    setTables((prev) =>
      prev.map((t) => (t.id === updatedTable.id ? updatedTable : t))
    );
    if (selectedTable?.id === updatedTable.id) {
      setSelectedTable(updatedTable);
    }
  };

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

  // Delete single table
  const handleDeleteTable = (tableId: string) => {
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
