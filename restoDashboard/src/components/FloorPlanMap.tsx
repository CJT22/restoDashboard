import React, { useState, useRef, useEffect } from 'react';
import { TableRoom } from '../types';
import { getStatusColors } from '../utils/statusColors';
import { getOrderStatusLabel, getOrderStatusColorClass } from '../services/orderSync';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move,
  Plus,
  Edit2,
  Trash2,
  Info,
  ChevronRight
} from 'lucide-react';

const FLOOR_PLAN_IMAGES: Record<1 | 2, string> = {
  1: '/floorplans/floor1.png',
  2: '/floorplans/floor2.png',
};

const MIN_ZONE_SIZE_PCT = 3;

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_POSITION_CLASSES: Record<ResizeHandle, string> = {
  nw: '-top-1 -left-1',
  n: '-top-1 left-1/2 -translate-x-1/2',
  ne: '-top-1 -right-1',
  e: 'top-1/2 -right-1 -translate-y-1/2',
  se: '-bottom-1 -right-1',
  s: '-bottom-1 left-1/2 -translate-x-1/2',
  sw: '-bottom-1 -left-1',
  w: 'top-1/2 -left-1 -translate-y-1/2',
};

const HANDLE_CURSOR_CLASSES: Record<ResizeHandle, string> = {
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
};

interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Standard 8-point resize math: handles on the west/north side move x/y and
// shrink from that edge; handles on the east/south side only grow width/height.
function applyResize(orig: ZoneRect, handle: ResizeHandle, dxPct: number, dyPct: number): ZoneRect {
  let { x, y, width, height } = orig;

  if (handle.includes('w')) {
    const right = orig.x + orig.width;
    const newX = clamp(orig.x + dxPct, 0, right - MIN_ZONE_SIZE_PCT);
    x = newX;
    width = right - newX;
  } else if (handle.includes('e')) {
    width = clamp(orig.width + dxPct, MIN_ZONE_SIZE_PCT, 100 - orig.x);
  }

  if (handle.includes('n')) {
    const bottom = orig.y + orig.height;
    const newY = clamp(orig.y + dyPct, 0, bottom - MIN_ZONE_SIZE_PCT);
    y = newY;
    height = bottom - newY;
  } else if (handle.includes('s')) {
    height = clamp(orig.height + dyPct, MIN_ZONE_SIZE_PCT, 100 - orig.y);
  }

  return { x, y, width, height };
}

interface FloorPlanMapProps {
  floor: 1 | 2;
  tables: TableRoom[];
  selectedTableId: string | null;
  onSelectTable: (table: TableRoom) => void;
  showAvailableFilter: boolean;
  showOccupiedFilter: boolean;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onUpdateTablePosition: (tableId: string, x: number, y: number) => void;
  onUpdateTableGeometry: (tableId: string, geometry: ZoneRect) => void;
  onOpenNewTableModal: (rect: ZoneRect) => void;
  onOpenEditTableModal: (table: TableRoom) => void;
  onPromptDeleteSingleTable: (table: TableRoom) => void;
  onPromptDeleteAll: () => void;
}

export const FloorPlanMap: React.FC<FloorPlanMapProps> = ({
  floor,
  tables,
  selectedTableId,
  onSelectTable,
  showAvailableFilter,
  showOccupiedFilter,
  isEditMode,
  onToggleEditMode,
  onUpdateTablePosition,
  onUpdateTableGeometry,
  onOpenNewTableModal,
  onOpenEditTableModal,
  onPromptDeleteSingleTable,
  onPromptDeleteAll,
}) => {
  const DEFAULT_ZOOM = 1.3;
  const [zoomLevel, setZoomLevel] = useState<number>(DEFAULT_ZOOM);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);

  // Move (drag zone body) state
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const dragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Resize (drag a border handle) state
  const [resizingState, setResizingState] = useState<{ tableId: string; handle: ResizeHandle } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; orig: ZoneRect } | null>(null);

  // Draw-a-new-zone state (click and hold on blank canvas, then drag)
  const [drawingRect, setDrawingRect] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);

  // Let Escape back out of an in-progress zone draw
  const isDrawingNewZone = drawingRect !== null;
  useEffect(() => {
    if (!isDrawingNewZone) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawingRect(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawingNewZone]);

  // Shared click-vs-drag disambiguation: suppress the click-to-open-modal
  // handler for a short window right after a real move/resize drag ends.
  const hasDraggedRef = useRef<boolean>(false);
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const mapCanvasRef = useRef<HTMLDivElement>(null);

  // Filter tables by floor
  const floorTables = tables.filter((t) => t.floor === floor);

  // Zoom helpers
  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(Math.max(0.7, prev + delta), 1.6));
  };
  const resetZoom = () => setZoomLevel(DEFAULT_ZOOM);

  // Check visibility/highlight filter according to the 2 requested buttons:
  // If neither or both are on, show all.
  // If only Available is on, show only available.
  // If only Occupied is on, show only occupied.
  const isFilterActive = (showAvailableFilter && !showOccupiedFilter) || (!showAvailableFilter && showOccupiedFilter);

  const isTableHighlighted = (table: TableRoom) => {
    if (!isFilterActive) return true;
    if (showAvailableFilter && !showOccupiedFilter) {
      return table.status === 'available';
    }
    if (showOccupiedFilter && !showAvailableFilter) {
      return table.status === 'occupied';
    }
    return true;
  };

  const suppressClickAfterInteraction = () => {
    if (hasDraggedRef.current) {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = setTimeout(() => {
        hasDraggedRef.current = false;
      }, 120);
    }
  };

  // Start moving an existing zone (mousedown on its body, not a handle)
  const handleZoneMouseDown = (e: React.MouseEvent, table: TableRoom) => {
    if (!isEditMode) return;
    e.stopPropagation();
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragOriginRef.current = { x: table.x, y: table.y };
    hasDraggedRef.current = false;
    setDraggingTableId(table.id);
  };

  // Start resizing an existing zone (mousedown on one of its border handles)
  const handleResizeMouseDown = (e: React.MouseEvent, table: TableRoom, handle: ResizeHandle) => {
    if (!isEditMode) return;
    e.stopPropagation();
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      orig: { x: table.x, y: table.y, width: table.width, height: table.height },
    };
    hasDraggedRef.current = false;
    setResizingState({ tableId: table.id, handle });
  };

  // Start drawing a brand-new zone (mousedown on blank canvas)
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditMode || !mapCanvasRef.current) return;
    const rect = mapCanvasRef.current.getBoundingClientRect();
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
    setDrawingRect({ startX: x, startY: y, curX: x, curY: y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditMode || !mapCanvasRef.current) return;
    const rect = mapCanvasRef.current.getBoundingClientRect();

    if (resizingState && resizeStartRef.current) {
      const dist = Math.hypot(e.clientX - resizeStartRef.current.mouseX, e.clientY - resizeStartRef.current.mouseY);
      if (dist > 5) hasDraggedRef.current = true;
      const dxPct = ((e.clientX - resizeStartRef.current.mouseX) / rect.width) * 100;
      const dyPct = ((e.clientY - resizeStartRef.current.mouseY) / rect.height) * 100;
      const next = applyResize(resizeStartRef.current.orig, resizingState.handle, dxPct, dyPct);
      onUpdateTableGeometry(resizingState.tableId, next);
      return;
    }

    if (draggingTableId) {
      const table = floorTables.find((t) => t.id === draggingTableId);
      if (!table) return;
      const dist = Math.hypot(e.clientX - dragStartPos.current.x, e.clientY - dragStartPos.current.y);
      if (dist > 5) hasDraggedRef.current = true;
      const dxPct = ((e.clientX - dragStartPos.current.x) / rect.width) * 100;
      const dyPct = ((e.clientY - dragStartPos.current.y) / rect.height) * 100;
      const newX = clamp(dragOriginRef.current.x + dxPct, 0, 100 - table.width);
      const newY = clamp(dragOriginRef.current.y + dyPct, 0, 100 - table.height);
      onUpdateTablePosition(draggingTableId, newX, newY);
      return;
    }

    if (drawingRect) {
      const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
      const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
      setDrawingRect((prev) => (prev ? { ...prev, curX: x, curY: y } : prev));
    }
  };

  const handleMouseUp = () => {
    if (resizingState) {
      setResizingState(null);
      resizeStartRef.current = null;
      suppressClickAfterInteraction();
      return;
    }

    if (draggingTableId) {
      setDraggingTableId(null);
      suppressClickAfterInteraction();
      return;
    }

    if (drawingRect) {
      const x = Math.min(drawingRect.startX, drawingRect.curX);
      const y = Math.min(drawingRect.startY, drawingRect.curY);
      const width = Math.abs(drawingRect.curX - drawingRect.startX);
      const height = Math.abs(drawingRect.curY - drawingRect.startY);
      setDrawingRect(null);
      // Too small to be an intentional zone (e.g. a stray click) - ignore it.
      if (width < MIN_ZONE_SIZE_PCT || height < MIN_ZONE_SIZE_PCT) return;
      onOpenNewTableModal({ x, y, width, height });
    }
  };

  return (
    <div
      id="interactive-map-container"
      className="relative flex-1 h-screen overflow-hidden bg-gradient-to-br from-[#0c0d1c] via-[#14122d] to-[#1e1542] flex flex-col select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Background ambient lighting */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.15), transparent 70%),
            linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 48px 48px, 48px 48px'
        }}
      />

      {/* Top Floating Control Bar */}
      <div className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between pointer-events-none">
        {/* Floor & Status Information */}
        <div className="pointer-events-auto flex items-center gap-3">
          <div className="px-4 py-2 rounded-2xl bg-[#141628]/90 backdrop-blur-md border border-white/10 shadow-xl flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-sm font-bold text-white tracking-wide">
              {floor === 1 ? '1st Floor • Main Dining Area' : '2nd Floor • KTV Rooms Area'}
            </span>
            <span className="text-xs text-slate-400 font-mono bg-white/5 px-2 py-0.5 rounded-lg">
              {floorTables.length} {floorTables.length === 1 ? 'Zone' : 'Zones'} • 1774×887 Ratio (2:1)
            </span>
          </div>

          {isFilterActive && (
            <div className="px-3 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs font-semibold flex items-center gap-2">
              <Info className="w-3.5 h-3.5" />
              <span>Filtering: {showAvailableFilter ? 'Available Only' : 'Occupied Only'}</span>
            </div>
          )}
        </div>

        {/* Edit Mode, Delete All, & Zoom Controls */}
        <div className="pointer-events-auto flex items-center gap-2 bg-[#141628]/90 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 shadow-xl">
          {isEditMode && floorTables.length > 0 && (
            <button
              id="btn-delete-all-tables"
              onClick={onPromptDeleteAll}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 transition-all shadow-sm"
              title="Delete all zones to start over"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete All Zones</span>
            </button>
          )}

          <button
            id="btn-toggle-edit-mode"
            onClick={onToggleEditMode}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              isEditMode
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 ring-2 ring-indigo-400'
                : 'bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white'
            }`}
            title="Toggle Edit Layout / Move Zones Mode"
          >
            <Move className="w-3.5 h-3.5" />
            <span>{isEditMode ? 'Done Editing' : 'Edit Zones'}</span>
          </button>

          <div className="h-4 w-px bg-white/10 mx-1" />

          <button
            id="btn-zoom-in"
            onClick={() => handleZoom(0.15)}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            id="btn-zoom-out"
            onClick={() => handleZoom(-0.15)}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            id="btn-zoom-reset"
            onClick={resetZoom}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all text-xs font-mono"
            title="Reset Zoom"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Edit Mode Instruction Banner */}
      {isEditMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2 rounded-2xl bg-indigo-950/90 border border-indigo-400/40 text-indigo-200 text-xs font-medium shadow-2xl backdrop-blur-md flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>
              <strong>Edit Mode:</strong> Drag a zone to move it • Click a zone to edit/rename • Drag a corner or edge handle to resize • Click and hold, then drag to draw a new zone
            </span>
          </div>
        </div>
      )}

      {/* Main Floor Plan Workspace Canvas */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
        <div
          ref={mapCanvasRef}
          onMouseDown={isEditMode ? handleCanvasMouseDown : undefined}
          className={`relative rounded-3xl overflow-hidden shadow-2xl transition-transform duration-300 ease-out select-none ${
            isEditMode ? 'cursor-crosshair ring-2 ring-indigo-500/30' : ''
          }`}
          style={{
            transform: `scale(${zoomLevel})`,
            // 1774 x 887 aspect ratio = exact 2:1 ratio container
            aspectRatio: '1774 / 887',
            width: '100%',
            maxWidth: '1200px',
            maxHeight: 'calc(100vh - 180px)',
          }}
        >
          {/* Fixed Floor Plan Image (1774x887 PNG fits with 100% precision) */}
          <div className="absolute inset-0 bg-[#121424] w-full h-full">
            <img
              src={FLOOR_PLAN_IMAGES[floor]}
              alt={`Floor ${floor} plan (1774x887)`}
              className="w-full h-full object-fill pointer-events-none"
            />
          </div>

          {/* Empty state notice if no zones, anchored near the bottom edge so it doesn't cover the room layout */}
          {floorTables.length === 0 && (
            <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center pointer-events-none px-6">
              <div className="px-4 py-2 rounded-2xl bg-indigo-950/90 border border-indigo-400/40 text-indigo-200 text-xs font-medium shadow-2xl backdrop-blur-md flex items-center gap-2.5">
                <Plus className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>
                  <strong>No zones on Floor {floor}:</strong> Click and hold, then drag to draw your first zone
                </span>
              </div>
            </div>
          )}

          {/* Interactive Table / Room Zones */}
          {floorTables.map((table) => {
            const isSelected = selectedTableId === table.id;
            const activeOrder = table.activeOrder;
            const isHovered = !isEditMode && hoveredTableId === table.id;
            const isHighlighted = isTableHighlighted(table);
            const isDraggingThis = draggingTableId === table.id;
            const isResizingThis = resizingState?.tableId === table.id;

            const colors = getStatusColors(table.status);

            // Keep the hover preview card from clipping at the map's edges -
            // based on the zone's actual edges now that it has real width/height.
            const zoneRight = table.x + table.width;
            const nearTopEdge = table.y < 20;
            const nearLeftEdge = table.x < 12;
            const nearRightEdge = zoneRight > 88;

            return (
              <div
                key={table.id}
                id={`map-zone-${table.id}`}
                onMouseDown={(e) => handleZoneMouseDown(e, table)}
                onClick={(e) => {
                  e.stopPropagation();
                  // If the user just dragged/resized the zone, don't also open a modal
                  if (hasDraggedRef.current) return;
                  if (isEditMode) {
                    onOpenEditTableModal(table);
                  } else {
                    onSelectTable(table);
                  }
                }}
                onMouseEnter={() => setHoveredTableId(table.id)}
                onMouseLeave={() => setHoveredTableId(null)}
                className={`absolute rounded-lg group ${
                  isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                } ${!isHighlighted ? 'opacity-20 filter grayscale pointer-events-none' : 'opacity-100'} ${
                  isDrawingNewZone ? 'pointer-events-none' : ''
                } ${
                  isSelected ? 'ring-2 ring-indigo-400 z-30' : ''
                } ${isDraggingThis || isResizingThis ? 'z-40' : ''} ${isHovered ? 'z-50' : ''}`}
                style={{
                  left: `${table.x}%`,
                  top: `${table.y}%`,
                  width: `${table.width}%`,
                  height: `${table.height}%`,
                }}
              >
                {/* Translucent zone fill - color communicates status, floor plan shows through */}
                <div
                  className={`absolute inset-0 rounded-lg border-2 transition-colors ${colors.borderClass}`}
                  style={{
                    backgroundColor: colors.fillRgba,
                    boxShadow: isHovered || isSelected ? `0 0 16px ${colors.glowRgba}` : undefined,
                  }}
                />

                {/* Name label - fixed light text on a dark backdrop chip, inset so it never touches the zone's border */}
                <div className="absolute inset-1.5 flex items-center justify-center pointer-events-none">
                  <span
                    className="max-w-full truncate text-[11px] font-bold tracking-tight text-center leading-tight px-2 py-1 rounded-md"
                    style={{
                      color: 'rgba(255, 255, 255, 0.95)',
                      backgroundColor: 'rgba(0, 0, 0, 0.65)',
                    }}
                  >
                    {table.name}
                  </span>
                </div>

                {/* Edit mode: 8-point resize handles, shown on hover */}
                {isEditMode && RESIZE_HANDLES.map((handle) => (
                  <div
                    key={handle}
                    onMouseDown={(e) => handleResizeMouseDown(e, table, handle)}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute w-2.5 h-2.5 bg-white border border-indigo-500 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity z-50 ${HANDLE_POSITION_CLASSES[handle]} ${HANDLE_CURSOR_CLASSES[handle]}`}
                  />
                ))}

                {/* Edit mode quick action toolbar: rename / delete */}
                {isEditMode && (
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#16182c] p-1 rounded-lg border border-white/20 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50">
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenEditTableModal(table);
                      }}
                      className="p-1 hover:bg-white/10 rounded text-slate-300 hover:text-white"
                      title="Rename / Edit"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPromptDeleteSingleTable(table);
                      }}
                      className="p-1 hover:bg-rose-500/20 rounded text-rose-400 hover:text-rose-300"
                      title="Delete Zone"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Non-edit mode quick preview hover card - never resizes the zone itself */}
                {isHovered && !isSelected && (
                  <div
                    className={`absolute w-56 p-3 rounded-2xl bg-[#16182c]/95 backdrop-blur-xl border border-white/20 shadow-2xl z-40 pointer-events-none text-left animate-in fade-in zoom-in-95 duration-150 ${
                      nearTopEdge ? 'top-full mt-3' : 'bottom-full mb-3'
                    } ${
                      nearLeftEdge ? 'left-0' : nearRightEdge ? 'right-0' : 'left-1/2 -translate-x-1/2'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white text-xs">{table.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full uppercase font-mono font-bold bg-white/10 text-slate-300">
                        Cap: {table.capacity}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 capitalize">
                      Status: {table.status}
                    </div>

                    {activeOrder && (
                      <div className="mt-2 pt-1.5 border-t border-white/10 text-[11px]">
                        <div className="flex justify-between text-slate-400 mb-0.5">
                          <span>Order #{activeOrder.orderNo}</span>
                          <span className={`px-1.5 py-0.5 rounded-full border ${getOrderStatusColorClass(activeOrder.status)}`}>
                            {getOrderStatusLabel(activeOrder.status)}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="mt-2 text-[10px] text-indigo-400 flex items-center gap-1 font-semibold">
                      Click to view details & update <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Live preview rectangle while drawing a new zone - blue while valid, red once it's too small to create */}
          {drawingRect && (() => {
            const width = Math.abs(drawingRect.curX - drawingRect.startX);
            const height = Math.abs(drawingRect.curY - drawingRect.startY);
            const isValidSize = width >= MIN_ZONE_SIZE_PCT && height >= MIN_ZONE_SIZE_PCT;
            return (
              <div
                className={`absolute rounded-lg border-2 border-dashed pointer-events-none z-40 ${
                  isValidSize ? 'border-sky-400 bg-sky-400/15' : 'border-rose-500 bg-rose-500/15'
                }`}
                style={{
                  left: `${Math.min(drawingRect.startX, drawingRect.curX)}%`,
                  top: `${Math.min(drawingRect.startY, drawingRect.curY)}%`,
                  width: `${width}%`,
                  height: `${height}%`,
                }}
              />
            );
          })()}
        </div>
      </div>

      {/* Bottom Bar: Quick summary and uploader trigger */}
      <div className="p-3.5 px-8 border-t border-white/5 bg-[#0e0f1c]/90 backdrop-blur-md flex flex-wrap items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-6">
          <span className="text-slate-400 uppercase tracking-wider text-[10px] font-bold">Status:</span>

          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${getStatusColors('available').legendDotClass}`} />
            <span className="text-emerald-300 font-medium">{getStatusColors('available').label}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(245,158,11,0.8)] ${getStatusColors('occupied').legendDotClass}`} />
            <span className="text-amber-300 font-medium">{getStatusColors('occupied').label}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggleEditMode}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isEditMode
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-white/10 hover:bg-white/15 text-slate-200'
            }`}
          >
            <Move className="w-3 h-3" />
            {isEditMode ? 'Done Editing' : 'Edit or Reposition Zones'}
          </button>
        </div>
      </div>
    </div>
  );
};
