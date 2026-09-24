import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { TableRoom } from '../types';
import { getStatusColors } from '../utils/statusColors';
import { getOrderStatusLabel, getOrderStatusColorClass } from '../services/orderSync';
import { getRoomTiming, formatDuration, formatHours, formatClockTime, useNow, RoomTiming } from '../utils/roomTimer';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Move,
  Plus,
  Edit2,
  Trash2,
  Info,
  ChevronRight
} from 'lucide-react';

// Every floor plan image must share this exact 16:9 frame - zone geometry is
// stored as percentages of it, so the canvas below is locked to this ratio.
// Pixel size doesn't matter (currently 2560x1440, transparent WebP); only
// the ratio and the building's placement within the frame do.
const FLOOR_PLAN_IMAGES: Record<1 | 2, string> = {
  1: '/floorplans/first_floor.webp',
  2: '/floorplans/second_floor.webp',
};
const FLOOR_PLAN_ASPECT_W = 16;
const FLOOR_PLAN_ASPECT_H = 9;

const MIN_ZONE_SIZE_PCT = 3;

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.15;

// Shared by zoom in / out / reset; greys out when the action can't go further.
const ZOOM_BUTTON_CLASSES =
  'w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-slate-300 disabled:cursor-default';

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

// Zone info panel: one dark panel pinned to the zone's top-left, stacking
// lines in priority order — name, room timer, order status, order number,
// item count. Laid out in JS from the zone's rendered size in px (so zooming
// in reveals more): text scales with the zone, and lines drop off the bottom
// once they no longer fit. The name and an hourly room's timer are never
// dropped. Anything cut here is still in the hover card and detail modal.
const PANEL_PAD_X = 3;
const PANEL_PAD_Y = 2;

// Rough rendered width of a line, in em, for picking the longest timer
// wording that fits (digits are tabular; letters are bold caps at worst).
function estimateTextEm(text: string): number {
  let em = 0;
  for (const ch of text) em += /[0-9]/.test(ch) ? 0.56 : /[:.· ]/.test(ch) ? 0.3 : 0.62;
  return em;
}

interface ZoneLabelLayout {
  insetPx: number;
  fontPx: number;
  lineHeightPx: number;
  nameMaxWidthPx: number;
  timerLines: string[];
  showStatusLine: boolean;
  showOrderNo: boolean;
  showItemCount: boolean;
}

function getZoneLabelLayout(
  widthPx: number,
  heightPx: number,
  timing: RoomTiming | null,
  hasOrder: boolean
): ZoneLabelLayout {
  const minSide = Math.min(widthPx, heightPx);
  // Includes the zone's 2px border.
  const insetPx = minSide < 60 ? 4 : 7;
  const fontPx = clamp(Math.round(minSide * 0.12), 9, 13);
  const lineHeightPx = Math.round(fontPx * 1.3);
  const innerWidth = widthPx - 2 * insetPx - 2 * PANEL_PAD_X;
  const innerHeight = heightPx - 2 * insetPx - 2 * PANEL_PAD_Y;

  // Longest wording that fits the width. The last option always shows, even
  // if it slightly overflows, since the timer must never be hidden; when
  // expired it splits onto two lines so a narrow zone still says "EXPIRED".
  let timerLines: string[] = [];
  if (timing) {
    const time = formatDuration(timing.remainingMs);
    const candidates = timing.expired
      ? [[`EXPIRED +${time}`], [`EXP +${time}`], ['EXPIRED', `+${time}`]]
      : [[`${formatHours(timing.hours)} · ${time} left`], [`${time} left`], [time]];
    timerLines =
      candidates.find((lines) => lines.every((l) => estimateTextEm(l) * fontPx <= innerWidth)) ??
      candidates[candidates.length - 1];
  }

  const linesThatFit = Math.floor(innerHeight / lineHeightPx);
  let spareLines = linesThatFit - 1 - timerLines.length;
  const take = (wanted: boolean) => {
    if (!wanted || spareLines <= 0) return false;
    spareLines -= 1;
    return true;
  };
  const showStatusLine = take(hasOrder);
  const showOrderNo = take(hasOrder);
  const showItemCount = take(hasOrder);

  return {
    insetPx,
    fontPx,
    lineHeightPx,
    nameMaxWidthPx: Math.max(0, innerWidth),
    timerLines,
    showStatusLine,
    showOrderNo,
    showItemCount,
  };
}

// Matches getOrderStatusColorClass's hues, as a bare dot.
function getOrderStatusDotClass(status: number): string {
  return status === 3 ? 'bg-amber-400' : status === 2 ? 'bg-indigo-400' : 'bg-slate-400';
}

// Fullscreen API with the webkit-prefixed fallback older iPadOS Safari needs.
// iPhone Safari doesn't support element fullscreen at all, so there the
// toggle button is hidden rather than shown as a dead control.
type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const isFullscreenSupported = () => {
  const doc = document as WebkitDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
};
const getFullscreenElement = () => {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};
const enterFullscreen = () => {
  const el = document.documentElement as WebkitElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  return el.webkitRequestFullscreen?.();
};
const exitFullscreen = () => {
  const doc = document as WebkitDocument;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  return doc.webkitExitFullscreen?.();
};

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
  // The canvas already fills the whole workspace at 1x, so no default zoom-in.
  const DEFAULT_ZOOM = 1;
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

  // Rendered canvas size in px, so each zone's label can pick how much to
  // show from its real on-screen size (zone geometry is in % of the canvas).
  // Tracks zoom and window resizes alike.
  const [canvasPx, setCanvasPx] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = mapCanvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasPx((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Filter tables by floor
  const floorTables = tables.filter((t) => t.floor === floor);

  // One shared 1s tick drives every hourly room's countdown; only runs while
  // this floor has one to show.
  const hasRoomTimer = floorTables.some((t) => getRoomTiming(t.activeOrder, 0) != null);
  const nowMs = useNow(hasRoomTimer);

  // Zoom helpers
  // Zoom resizes the canvas in layout (not a CSS transform) so the workspace's
  // scrollbars track it immediately. Before each change we remember which point
  // of the scroll area sits at the viewport center, and restore it after the
  // resize so zooming stays anchored on what the user was looking at.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const setZoomKeepingCenter = (next: (prev: number) => number) => {
    const el = workspaceRef.current;
    if (el) {
      zoomAnchorRef.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
        y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      };
    }
    setZoomLevel(next);
  };
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    const anchor = zoomAnchorRef.current;
    if (!el || !anchor) return;
    el.scrollLeft = anchor.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = anchor.y * el.scrollHeight - el.clientHeight / 2;
    zoomAnchorRef.current = null;
  }, [zoomLevel]);

  // Rounded to 2 decimals so repeated ±ZOOM_STEP steps don't drift (e.g. to
  // 0.9999999999999999) and miss the exact values the button states check.
  const handleZoom = (delta: number) => {
    setZoomKeepingCenter((prev) => Math.round(clamp(prev + delta, MIN_ZOOM, MAX_ZOOM) * 100) / 100);
  };
  const resetZoom = () => setZoomKeepingCenter(() => DEFAULT_ZOOM);

  // Fullscreen covers the whole dashboard (sidebar included). State is synced
  // from the browser's change event so exiting via Esc/back gesture updates the icon.
  const [canFullscreen] = useState<boolean>(isFullscreenSupported);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => getFullscreenElement() !== null);
  useEffect(() => {
    if (!canFullscreen) return;
    const onChange = () => setIsFullscreen(getFullscreenElement() !== null);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [canFullscreen]);
  const toggleFullscreen = () => {
    const result = isFullscreen ? exitFullscreen() : enterFullscreen();
    Promise.resolve(result).catch(() => {
      // Browser refused (e.g. permissions policy) - leave the state as-is.
    });
  };

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
          {/* Plain heading, not a pill - the old bordered badge read as a button. */}
          <h2 className="flex items-baseline gap-2.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            <span className="text-base font-bold text-white tracking-wide">
              {floor === 1 ? '1st Floor • Main Dining Area' : '2nd Floor • KTV Rooms Area'}
            </span>
            <span className="text-xs font-medium text-slate-400">
              {floorTables.length} {floorTables.length === 1 ? 'zone' : 'zones'}
            </span>
          </h2>

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
            onClick={() => handleZoom(ZOOM_STEP)}
            disabled={zoomLevel >= MAX_ZOOM}
            className={ZOOM_BUTTON_CLASSES}
            title="Zoom In"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            id="btn-zoom-out"
            onClick={() => handleZoom(-ZOOM_STEP)}
            disabled={zoomLevel <= MIN_ZOOM}
            className={ZOOM_BUTTON_CLASSES}
            title="Zoom Out"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            id="btn-zoom-reset"
            onClick={resetZoom}
            disabled={zoomLevel === DEFAULT_ZOOM}
            className={ZOOM_BUTTON_CLASSES}
            title="Reset Zoom"
            aria-label="Reset zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {canFullscreen && (
            <button
              id="btn-fullscreen"
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
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
      {/* Full-bleed workspace (everything above the bottom bar, sitting under the
          floating control bar). It's a size container so the canvas can be the
          largest 16:9 box that fits it: full width on wide viewports, full
          height on taller ones, centered with the leftover as thin bands.
          Zoom multiplies that width in layout, and the canvas is centered with
          m-auto rather than justify-center so overflow on every side stays
          scrollable (flex centering pushes half of it off the unscrollable
          left/top edges). */}
      <div
        ref={workspaceRef}
        className="flex-1 min-h-0 flex overflow-auto"
        style={{ containerType: 'size' }}
      >
        <div
          ref={mapCanvasRef}
          onMouseDown={isEditMode ? handleCanvasMouseDown : undefined}
          className={`relative shrink-0 m-auto overflow-hidden select-none ${
            isEditMode ? 'cursor-crosshair ring-2 ring-indigo-500/30' : ''
          }`}
          style={{
            aspectRatio: `${FLOOR_PLAN_ASPECT_W} / ${FLOOR_PLAN_ASPECT_H}`,
            width: `calc(min(100cqw, 100cqh * ${FLOOR_PLAN_ASPECT_W} / ${FLOOR_PLAN_ASPECT_H}) * ${zoomLevel})`,
          }}
        >
          {/* Floor plan image - no backdrop, so transparent-background exports
              sit directly on the workspace gradient */}
          <img
            src={FLOOR_PLAN_IMAGES[floor]}
            alt={`Floor ${floor} plan`}
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          />

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

            const timing = getRoomTiming(activeOrder, nowMs);
            const label = getZoneLabelLayout(
              (table.width / 100) * canvasPx.width,
              (table.height / 100) * canvasPx.height,
              timing,
              activeOrder != null
            );
            const itemCount = activeOrder?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;

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

                {/* Info panel - one dark panel pinned to the top-left, inset from the zone's border.
                    Lines, size and wording follow the zone's on-screen size (see getZoneLabelLayout). */}
                <div
                  className="absolute flex flex-col items-start rounded-md pointer-events-none"
                  style={{
                    top: label.insetPx,
                    left: label.insetPx,
                    padding: `${PANEL_PAD_Y}px ${PANEL_PAD_X}px`,
                    fontSize: label.fontPx,
                    lineHeight: `${label.lineHeightPx}px`,
                    color: 'rgba(255, 255, 255, 0.95)',
                    backgroundColor: 'rgba(0, 0, 0, 0.65)',
                  }}
                >
                  <span
                    className="flex items-center gap-1 font-bold tracking-tight whitespace-nowrap"
                    style={{ maxWidth: label.nameMaxWidthPx }}
                  >
                    {/* No room for a status line: keep the status visible as a dot beside the name */}
                    {activeOrder && !label.showStatusLine && (
                      <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${getOrderStatusDotClass(activeOrder.status)}`} />
                    )}
                    <span className="truncate">{table.name}</span>
                  </span>
                  {label.timerLines.map((line) => (
                    <span key={line} className="font-bold tabular-nums whitespace-nowrap">{line}</span>
                  ))}
                  {activeOrder && label.showStatusLine && (
                    <span className="flex items-center gap-1 whitespace-nowrap text-slate-300" style={{ maxWidth: label.nameMaxWidthPx }}>
                      <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${getOrderStatusDotClass(activeOrder.status)}`} />
                      <span className="truncate">{getOrderStatusLabel(activeOrder.status)}</span>
                    </span>
                  )}
                  {activeOrder && label.showOrderNo && (
                    <span className="truncate text-slate-400" style={{ maxWidth: label.nameMaxWidthPx }}>
                      #{activeOrder.orderNo}
                    </span>
                  )}
                  {activeOrder && label.showItemCount && (
                    <span className="truncate text-slate-400" style={{ maxWidth: label.nameMaxWidthPx }}>
                      {itemCount} {itemCount === 1 ? 'item' : 'items'}
                    </span>
                  )}
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
                        <div className="flex items-center justify-between text-slate-400 mb-0.5">
                          <span>Order #{activeOrder.orderNo}</span>
                          <span className={`px-1.5 py-0.5 rounded-full border ${getOrderStatusColorClass(activeOrder.status)}`}>
                            {getOrderStatusLabel(activeOrder.status)}
                          </span>
                        </div>
                        {timing && (
                          <>
                            <div className="text-slate-400">
                              {formatHours(timing.hours)} booked · {formatClockTime(timing.startMs)} – {formatClockTime(timing.endMs)}
                            </div>
                            <div className="font-mono font-bold text-white tabular-nums">
                              {timing.expired
                                ? `Expired · ${formatDuration(timing.remainingMs)} over`
                                : `${formatDuration(timing.remainingMs)} left`}
                            </div>
                          </>
                        )}
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
