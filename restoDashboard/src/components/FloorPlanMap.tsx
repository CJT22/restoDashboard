import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { TableRoom, InfoPanel } from '../types';
import { getStatusColors } from '../utils/statusColors';
import { getRoomTiming, formatDuration, formatHours, formatClockTime, useNow, RoomTiming, getTimerTone, TIMER_TEXT_CLASS } from '../utils/roomTimer';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Move,
  Info,
  ChevronRight,
  LayoutDashboard
} from 'lucide-react';
import { InfoPanelView } from './InfoPanelView';
import { MAX_LISTED_ORDER_ITEMS } from '../services/orderSync';
import { LAYOUT_EDITOR_ENABLED } from '../config/layoutEditor';
import { ZOOM_CONTROLS_ENABLED } from '../config/zoomControls';

// Every floor plan image must share this exact 16:9 frame - zone geometry is
// stored as percentages of it, so the canvas below is locked to this ratio.
// Pixel size doesn't matter (currently 2560x1440, transparent WebP); only
// the ratio and the building's placement within the frame do.
const FLOOR_PLAN_IMAGES: Record<1 | 2, string> = {
  1: '/floorplans/first_floor.webp',
  2: '/floorplans/second_floor.webp',
};
const FLOOR_OPTIONS: { value: 1 | 2; label: string }[] = [
  { value: 1, label: '1st Floor' },
  { value: 2, label: '2nd Floor' },
];
const FLOOR_PLAN_ASPECT_W = 16;
const FLOOR_PLAN_ASPECT_H = 9;

// Zoom buttons are dormant unless VITE_ENABLE_ZOOM_CONTROLS=true (see
// src/config/zoomControls.ts); otherwise zoomLevel stays at DEFAULT_ZOOM.
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.15;

// Shared by zoom in / out / reset; greys out when the action can't go further.
const ZOOM_BUTTON_CLASSES =
  'w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-slate-300 disabled:cursor-default';

// Labeled view buttons (Info Panels, Fullscreen): same height and type as the
// floor tabs so the two top bars mirror each other. Labels collapse to
// icon-only below xl, where the bar would crowd the floor switcher.
const VIEW_BUTTON_CLASSES =
  'h-8 px-3 flex items-center gap-2 rounded-xl text-sm font-bold tracking-wide transition-all';
const VIEW_BUTTON_IDLE = 'text-slate-400 hover:text-white hover:bg-white/5';

// Zone info panel: one dark panel pinned to the zone's top-left, stacking
// lines in priority order — name, room timer, item count, order total, then
// the order's items ("2× Sisig"), with "+N more" when not all of them fit.
// The total is drawn last (at the bottom) but claims its line before the
// items do. Laid out in JS from the zone's rendered size in px (so a bigger
// screen reveals more): text scales with the zone, and lines drop off the bottom
// once they no longer fit. The name and an hourly room's timer are never
// dropped. Anything cut here is still in the hover card and detail modal.
const PANEL_PAD_X = 3;

const formatPeso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  showItemCount: boolean;
  showTotal: boolean;
  // How many order items get their own line; any left over become "+N more".
  itemLinesShown: number;
}

function getZoneLabelLayout(
  widthPx: number,
  heightPx: number,
  timing: RoomTiming | null,
  hasOrder: boolean,
  // Distinct order items. A room-charge-only order has none, and
  // "0 items" would just be noise.
  itemLineCount: number
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
  const showItemCount = take(itemLineCount > 0);
  const showTotal = take(hasOrder);

  // All items if they fit; otherwise as many as fit above a "+N more" line.
  // A lone "+N more" under the count adds nothing, so skip it.
  let itemLinesShown = 0;
  if (showItemCount && spareLines > 0) {
    if (itemLineCount <= spareLines) itemLinesShown = itemLineCount;
    else if (spareLines >= 2) itemLinesShown = spareLines - 1;
  }

  return {
    insetPx,
    fontPx,
    lineHeightPx,
    nameMaxWidthPx: Math.max(0, innerWidth),
    timerLines,
    showItemCount,
    showTotal,
    itemLinesShown,
  };
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

interface FloorPlanMapProps {
  floor: 1 | 2;
  onSelectFloor: (floor: 1 | 2) => void;
  tables: TableRoom[];
  selectedTableId: string | null;
  onSelectTable: (table: TableRoom) => void;
  showAvailableFilter: boolean;
  showOccupiedFilter: boolean;
  // Layout editor (dormant unless VITE_ENABLE_LAYOUT_EDITOR=true — see
  // src/config/layoutEditor.ts). isEditMode only ever turns true then.
  isEditMode: boolean;
  onToggleEditMode: () => void;
  // The editor's overlay, rendered inside the canvas while editing.
  editor?: React.ReactNode;
  infoPanels: InfoPanel[];
  showInfoPanels: boolean;
  onToggleInfoPanels: () => void;
}

export const FloorPlanMap: React.FC<FloorPlanMapProps> = ({
  floor,
  onSelectFloor,
  tables,
  selectedTableId,
  onSelectTable,
  showAvailableFilter,
  showOccupiedFilter,
  isEditMode,
  onToggleEditMode,
  editor,
  infoPanels,
  showInfoPanels,
  onToggleInfoPanels,
}) => {
  // The canvas already fills the whole workspace at 1x, so no default zoom-in.
  const DEFAULT_ZOOM = 1;
  const [zoomLevel, setZoomLevel] = useState<number>(DEFAULT_ZOOM);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);

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

  // Info panels are always shown while editing so they can be arranged.
  const floorPanels = infoPanels.filter((p) => p.floor === floor);
  const panelsVisible = showInfoPanels || isEditMode;

  // One shared 1s tick drives every hourly room's countdown and the info
  // panels' timers/waiting times; only runs while there's one to show.
  // Panels check both floors, since a widget can be set to 2F or All.
  const hasRoomTimer = floorTables.some((t) => getRoomTiming(t.activeOrder, 0) != null);
  const panelsNeedTick = panelsVisible && floorPanels.length > 0 && tables.some((t) => t.activeOrder);
  const nowMs = useNow(hasRoomTimer || panelsNeedTick);

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

  return (
    <div
      id="interactive-map-container"
      className="relative flex-1 h-screen overflow-hidden bg-gradient-to-br from-[#0c0d1c] via-[#14122d] to-[#1e1542] flex flex-col select-none"
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
          {/* Floor switcher: segmented control so changing floors is a single tap
              and both options are always visible. Styled like the view bar on the right. */}
          <div
            role="tablist"
            aria-label="Floor"
            className="flex items-center gap-1 bg-[#141628]/90 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 shadow-xl"
          >
            {FLOOR_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                id={`tab-map-floor-${value}`}
                role="tab"
                aria-selected={floor === value}
                onClick={() => onSelectFloor(value)}
                className={`h-8 px-4 flex items-center rounded-xl text-sm font-bold tracking-wide transition-all ${
                  floor === value
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isFilterActive && (
            <div className="px-3 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs font-semibold flex items-center gap-2">
              <Info className="w-3.5 h-3.5" />
              <span>Filtering: {showAvailableFilter ? 'Available Only' : 'Occupied Only'}</span>
            </div>
          )}
        </div>

        {/* View bar: Info Panels & Fullscreen, plus Edit Zones and zoom when
            their dormant build flags are on */}
        <div className="pointer-events-auto flex items-center gap-1 bg-[#141628]/90 backdrop-blur-md border border-white/10 rounded-2xl p-1.5 shadow-xl">
          {LAYOUT_EDITOR_ENABLED && (
            <>
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
            </>
          )}

          {ZOOM_CONTROLS_ENABLED && (
            <>
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

              <div className="h-4 w-px bg-white/10 mx-1" />
            </>
          )}

          {/* Toggle: indigo with a lit dot while panels are shown, like the
              active floor tab; grey with an unlit dot while hidden. */}
          <button
            id="btn-toggle-info-panels"
            onClick={onToggleInfoPanels}
            aria-pressed={showInfoPanels}
            className={`${VIEW_BUTTON_CLASSES} ${
              showInfoPanels ? 'bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30' : VIEW_BUTTON_IDLE
            }`}
            title={showInfoPanels ? 'Hide info panels' : 'Show info panels'}
            aria-label="Info panels"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span className="hidden xl:inline">Info Panels</span>
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                showInfoPanels ? 'bg-indigo-400 shadow-[0_0_6px] shadow-indigo-400' : 'bg-slate-600'
              }`}
            />
          </button>
          {canFullscreen && (
            <>
              <div className="h-4 w-px bg-white/10 mx-0.5" />
              <button
                id="btn-fullscreen"
                onClick={toggleFullscreen}
                className={`${VIEW_BUTTON_CLASSES} ${VIEW_BUTTON_IDLE}`}
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                <span className="hidden xl:inline">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
              </button>
            </>
          )}
        </div>
      </div>

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
          className="relative shrink-0 m-auto overflow-hidden select-none"
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
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>
                  <strong>No zones on Floor {floor}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Info panels - read-only widgets in the plan's free space. Styled as dark
              cards (no status fill) so they never read as a table or room. */}
          {panelsVisible && floorPanels.map((panel) => {
            // On-screen size decides how many columns fit (see InfoPanelView).
            const panelPx = {
              widthPx: (panel.width / 100) * canvasPx.width,
              heightPx: (panel.height / 100) * canvasPx.height,
            };
            return (
              <div
                key={panel.id}
                id={`map-panel-${panel.id}`}
                className="absolute rounded-xl shadow-xl border border-white/10"
                style={{
                  left: `${panel.x}%`,
                  top: `${panel.y}%`,
                  width: `${panel.width}%`,
                  height: `${panel.height}%`,
                  backgroundColor: 'rgba(15, 17, 32, 0.9)',
                }}
              >
                {/* Scrolls only as a fallback when a panel is too short for its widgets' minimum sizes */}
                <div className="absolute inset-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                  <InfoPanelView
                    panel={panel}
                    allTables={tables}
                    nowMs={nowMs}
                    widthPx={panelPx.widthPx}
                    heightPx={panelPx.heightPx}
                    interactive={!isEditMode}
                    onSelectTable={onSelectTable}
                  />
                </div>
              </div>
            );
          })}

          {/* Interactive Table / Room Zones */}
          {floorTables.map((table) => {
            const isSelected = selectedTableId === table.id;
            const activeOrder = table.activeOrder;
            const isHovered = !isEditMode && hoveredTableId === table.id;
            const isHighlighted = isTableHighlighted(table);

            const colors = getStatusColors(table.status);

            const timing = getRoomTiming(activeOrder, nowMs);
            const itemCount = activeOrder?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
            const label = getZoneLabelLayout(
              (table.width / 100) * canvasPx.width,
              (table.height / 100) * canvasPx.height,
              timing,
              activeOrder != null,
              activeOrder?.items.length ?? 0
            );
            const orderItems = activeOrder?.items ?? [];

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
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTable(table);
                }}
                onMouseEnter={() => setHoveredTableId(table.id)}
                onMouseLeave={() => setHoveredTableId(null)}
                className={`absolute rounded-lg cursor-pointer ${
                  !isHighlighted ? 'opacity-20 filter grayscale pointer-events-none' : 'opacity-100'
                } ${isSelected ? 'ring-2 ring-indigo-400 z-30' : ''} ${isHovered ? 'z-50' : ''}`}
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
                    <span className="truncate">{table.name}</span>
                  </span>
                  {label.timerLines.map((line) => (
                    <span
                      key={line}
                      className={`font-bold tabular-nums whitespace-nowrap ${timing ? TIMER_TEXT_CLASS[getTimerTone(timing)] : ''}`}
                    >
                      {line}
                    </span>
                  ))}
                  {label.showItemCount && (
                    <span className="truncate text-slate-400" style={{ maxWidth: label.nameMaxWidthPx }}>
                      {itemCount} {itemCount === 1 ? 'item' : 'items'}
                    </span>
                  )}
                  {orderItems.slice(0, label.itemLinesShown).map((item) => (
                    <span key={item.id} className="truncate" style={{ maxWidth: label.nameMaxWidthPx }}>
                      <span className="tabular-nums text-slate-300">{item.quantity}×</span> {item.name}
                    </span>
                  ))}
                  {label.itemLinesShown > 0 && orderItems.length > label.itemLinesShown && (
                    <span className="truncate text-slate-400" style={{ maxWidth: label.nameMaxWidthPx }}>
                      +{orderItems.length - label.itemLinesShown} more
                    </span>
                  )}
                  {activeOrder && label.showTotal && (
                    <span className="truncate font-bold tabular-nums" style={{ maxWidth: label.nameMaxWidthPx }}>
                      {formatPeso(activeOrder.grandTotal)}
                    </span>
                  )}
                </div>

                {/* Quick preview hover card - never resizes the zone itself */}
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

                    {timing && (
                      <div className="mt-2 pt-1.5 border-t border-white/10 text-[11px]">
                        <div className="text-white">
                          {formatHours(timing.hours)} booked · {formatClockTime(timing.startMs)} – {formatClockTime(timing.endMs)}
                        </div>
                        <div className={`font-mono font-bold tabular-nums ${TIMER_TEXT_CLASS[getTimerTone(timing)]}`}>
                          {timing.expired
                            ? `Expired · ${formatDuration(timing.remainingMs)} over`
                            : `${formatDuration(timing.remainingMs)} left`}
                        </div>
                      </div>
                    )}

                    {orderItems.length > 0 && (
                      <div className="mt-2 pt-1.5 border-t border-white/10 text-[11px] text-slate-200 space-y-0.5">
                        {orderItems.slice(0, MAX_LISTED_ORDER_ITEMS).map((item) => (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <span className="shrink-0 tabular-nums text-slate-400">{item.quantity}×</span>
                            <span className="truncate">{item.name}</span>
                          </div>
                        ))}
                        {orderItems.length > MAX_LISTED_ORDER_ITEMS && (
                          <div className="text-slate-400">+{orderItems.length - MAX_LISTED_ORDER_ITEMS} more</div>
                        )}
                      </div>
                    )}

                    {activeOrder && (
                      <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Total</span>
                        <span className="font-bold text-white tabular-nums">{formatPeso(activeOrder.grandTotal)}</span>
                      </div>
                    )}

                    {!activeOrder && (
                      <div className="mt-2 pt-1.5 border-t border-white/10 text-[11px] text-slate-400">
                        No order yet for this {(table.adminRoomCharge ?? 0) > 0 ? 'room' : 'table'}.
                      </div>
                    )}

                    <div className="mt-2 text-[10px] text-indigo-400 flex items-center gap-1 font-semibold">
                      {activeOrder ? 'Click to view details & update' : 'Click to create a new order'}
                      <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Layout editor overlay (dormant; see src/config/layoutEditor.ts) */}
          {editor}
        </div>
      </div>

      {/* Bottom Bar: status legend */}
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
      </div>
    </div>
  );
};
