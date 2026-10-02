import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit2, Trash2, Undo2 } from 'lucide-react';
import { InfoPanel, TableRoom } from '../types';
import { FLOOR_LAYOUT, zonesFromLayout } from '../data/floorLayout';
import { ConfirmModal } from '../components/ConfirmModal';
import { EditTableModal } from './EditTableModal';
import { InfoPanelModal } from './InfoPanelModal';

// The dormant floor-plan layout editor (Edit Zones). Only ever loaded when
// VITE_ENABLE_LAYOUT_EDITOR=true (see src/config/layoutEditor.ts); with the
// flag off, this whole folder is left out of the build.
//
// FloorPlanMap renders it inside the map canvas while Edit Zones is on, as a
// transparent layer over the zones and info panels it already draws. This
// layer catches every pointer event, so the map itself stays read-only:
//   - drag a zone/panel to move it, or a corner/edge handle to resize it
//   - click one to edit it (zone name/capacity/restoAdmin link; panel widgets)
//   - press on blank canvas and drag to draw a new zone or info panel
// Changes apply to App's tables/infoPanels state straight away; App keeps a
// draft of them in this browser (see docs/layout-editor.md for turning a
// draft into the fixed layout).

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

// What a drag on the canvas draws.
type DrawKind = 'zone' | 'panel';

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

interface LayoutEditorProps {
  floor: 1 | 2;
  tables: TableRoom[];
  setTables: React.Dispatch<React.SetStateAction<TableRoom[]>>;
  infoPanels: InfoPanel[];
  setInfoPanels: React.Dispatch<React.SetStateAction<InfoPanel[]>>;
}

interface ConfirmState {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  confirmVariant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
}

const CLOSED_CONFIRM: ConfirmState = { isOpen: false, title: '', description: '', onConfirm: () => {} };

export default function LayoutEditor({ floor, tables, setTables, infoPanels, setInfoPanels }: LayoutEditorProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drawKind, setDrawKind] = useState<DrawKind>('zone');
  const [drawingRect, setDrawingRect] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  // The zone/panel being moved or resized, raised above its neighbours.
  const [activeId, setActiveId] = useState<string | null>(null);

  // Click-vs-drag: a click right after a real move/resize shouldn't also open a modal.
  const hasDraggedRef = useRef(false);

  const [tableModal, setTableModal] = useState<{ table: TableRoom | null; rect: ZoneRect } | null>(null);
  const [editingPanel, setEditingPanel] = useState<{ id: string; widthPx: number; heightPx: number } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(CLOSED_CONFIRM);

  // Where the editor bar portals to. Looked up after mount rather than during
  // render: when FloorPlanMap remounts with edit mode already on (e.g. back
  // from another tab), the container isn't in the DOM yet while rendering.
  const [mapContainer, setMapContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setMapContainer(layerRef.current?.closest<HTMLElement>('#interactive-map-container') ?? null);
  }, []);

  const floorTables = tables.filter((t) => t.floor === floor);
  const floorPanels = infoPanels.filter((p) => p.floor === floor);

  // Escape backs out of an in-progress draw.
  const isDrawing = drawingRect !== null;
  const drawCancelledRef = useRef(false);
  useEffect(() => {
    if (!isDrawing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      drawCancelledRef.current = true;
      setDrawingRect(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawing]);

  const layerRect = () => layerRef.current?.getBoundingClientRect() ?? null;

  const toPct = (e: MouseEvent | React.MouseEvent, rect: DOMRect) => ({
    x: clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100),
  });

  const pxSize = (item: ZoneRect) => {
    const rect = layerRect();
    return {
      widthPx: rect ? (item.width / 100) * rect.width : 0,
      heightPx: rect ? (item.height / 100) * rect.height : 0,
    };
  };

  const setGeometry = (kind: DrawKind, id: string, geometry: ZoneRect) => {
    if (kind === 'panel') setInfoPanels((prev) => prev.map((p) => (p.id === id ? { ...p, ...geometry } : p)));
    else setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...geometry } : t)));
  };

  // Follows the mouse across the whole window (not just the canvas) until
  // release, so a drag that overshoots the map edge doesn't get stuck.
  const trackDrag = (onMove: (e: MouseEvent) => void, onEnd: () => void) => {
    const handleUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleUp);
      onEnd();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleUp);
  };

  const endMoveOrResize = () => {
    setActiveId(null);
    // Let the click that follows this mouseup see the flag, then clear it.
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 120);
  };

  // Move a zone/panel (mousedown on its body, not a handle)
  const startMove = (e: React.MouseEvent, kind: DrawKind, item: ZoneRect & { id: string }) => {
    e.stopPropagation();
    const rect = layerRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    hasDraggedRef.current = false;
    setActiveId(item.id);
    trackDrag((ev) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) hasDraggedRef.current = true;
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      setGeometry(kind, item.id, {
        x: clamp(item.x + dxPct, 0, 100 - item.width),
        y: clamp(item.y + dyPct, 0, 100 - item.height),
        width: item.width,
        height: item.height,
      });
    }, endMoveOrResize);
  };

  // Resize a zone/panel (mousedown on one of its border handles)
  const startResize = (e: React.MouseEvent, kind: DrawKind, item: ZoneRect & { id: string }, handle: ResizeHandle) => {
    e.stopPropagation();
    const rect = layerRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: item.x, y: item.y, width: item.width, height: item.height };
    hasDraggedRef.current = false;
    setActiveId(item.id);
    trackDrag((ev) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) hasDraggedRef.current = true;
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      setGeometry(kind, item.id, applyResize(orig, handle, dxPct, dyPct));
    }, endMoveOrResize);
  };

  // Draw a brand-new zone or info panel (mousedown on blank canvas)
  const startDraw = (e: React.MouseEvent) => {
    const rect = layerRect();
    if (!rect) return;
    const start = toPct(e, rect);
    let current = start;
    drawCancelledRef.current = false;
    setDrawingRect({ startX: start.x, startY: start.y, curX: start.x, curY: start.y });
    trackDrag(
      (ev) => {
        if (drawCancelledRef.current) return;
        current = toPct(ev, rect);
        setDrawingRect((prev) => (prev ? { ...prev, curX: current.x, curY: current.y } : prev));
      },
      () => {
        setDrawingRect(null);
        if (drawCancelledRef.current) return;
        const drawn = {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        };
        // Too small to be intentional (e.g. a stray click) - ignore it.
        if (drawn.width < MIN_ZONE_SIZE_PCT || drawn.height < MIN_ZONE_SIZE_PCT) return;
        if (drawKind === 'panel') createPanel(drawn);
        else setTableModal({ table: null, rect: drawn });
      }
    );
  };

  // A freshly drawn panel starts with Room Timers and opens its widget picker.
  const createPanel = (rect: ZoneRect) => {
    const panel: InfoPanel = { id: `panel-${Date.now()}`, floor, widgets: ['roomTimers'], layout: 'auto', ...rect };
    setInfoPanels((prev) => [...prev, panel]);
    setEditingPanel({ id: panel.id, ...pxSize(rect) });
  };

  const saveTable = (tableToSave: TableRoom) => {
    setTables((prev) =>
      prev.some((t) => t.id === tableToSave.id)
        ? prev.map((t) => (t.id === tableToSave.id ? tableToSave : t))
        : [...prev, tableToSave]
    );
  };

  const deleteTable = (tableId: string) => {
    setTables((prev) => prev.filter((t) => t.id !== tableId));
  };

  const promptDeleteTable = (table: TableRoom) => {
    setConfirmState({
      isOpen: true,
      title: `Delete ${table.name}?`,
      description: `Remove "${table.name}" (${table.code}) from Floor ${table.floor}?`,
      confirmText: 'Delete Zone',
      confirmVariant: 'danger',
      onConfirm: () => deleteTable(table.id),
    });
  };

  const promptDeleteAll = () => {
    setConfirmState({
      isOpen: true,
      title: `Delete all zones on Floor ${floor}?`,
      description: `This deletes all ${floorTables.length} zones on Floor ${floor}, so you can redraw the floor from scratch.`,
      confirmText: `Delete All ${floorTables.length} Zones`,
      confirmVariant: 'danger',
      onConfirm: () => {
        setTables((prev) => prev.filter((t) => t.floor !== floor));
      },
    });
  };

  // Back to src/data/floorLayout.json, keeping each surviving zone's live
  // status/order. Doesn't touch restoAdmin links: re-link anything that
  // changed while editing.
  const promptDiscardDraft = () => {
    setConfirmState({
      isOpen: true,
      title: 'Discard layout changes?',
      description:
        "Puts every zone and info panel back to the fixed layout in floorLayout.json, on both floors. restoAdmin links changed while editing aren't undone.",
      confirmText: 'Discard Changes',
      confirmVariant: 'warning',
      onConfirm: () => {
        setTables((prev) => {
          const live = new Map(prev.map((t) => [t.id, t]));
          return zonesFromLayout(FLOOR_LAYOUT.zones).map((zone) => {
            const current = live.get(zone.id);
            return current
              ? { ...zone, status: current.status, activeOrder: current.activeOrder, adminRoomCharge: current.adminRoomCharge }
              : zone;
          });
        });
        setInfoPanels(FLOOR_LAYOUT.panels);
      },
    });
  };

  const renderHandles = (kind: DrawKind, item: ZoneRect & { id: string }) =>
    RESIZE_HANDLES.map((handle) => (
      <div
        key={handle}
        onMouseDown={(e) => startResize(e, kind, item, handle)}
        onClick={(e) => e.stopPropagation()}
        className={`absolute w-2.5 h-2.5 bg-white border border-indigo-500 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity z-50 ${HANDLE_POSITION_CLASSES[handle]} ${HANDLE_CURSOR_CLASSES[handle]}`}
      />
    ));

  const boxStyle = (item: ZoneRect): React.CSSProperties => ({
    left: `${item.x}%`,
    top: `${item.y}%`,
    width: `${item.width}%`,
    height: `${item.height}%`,
  });


  return (
    <>
      <div
        ref={layerRef}
        onMouseDown={startDraw}
        className="absolute inset-0 z-40 cursor-crosshair ring-2 ring-indigo-500/30"
      >
        {floorPanels.map((panel) => (
          <div
            key={panel.id}
            onMouseDown={(e) => startMove(e, 'panel', panel)}
            onClick={(e) => {
              e.stopPropagation();
              if (!hasDraggedRef.current) setEditingPanel({ id: panel.id, ...pxSize(panel) });
            }}
            className={`absolute group rounded-xl cursor-grab active:cursor-grabbing border-2 border-dashed border-indigo-400/70 ${
              isDrawing ? 'pointer-events-none' : ''
            } ${activeId === panel.id ? 'z-40' : ''}`}
            style={boxStyle(panel)}
          >
            {renderHandles('panel', panel)}
          </div>
        ))}

        {floorTables.map((table) => (
          <div
            key={table.id}
            onMouseDown={(e) => startMove(e, 'zone', table)}
            onClick={(e) => {
              e.stopPropagation();
              if (!hasDraggedRef.current) setTableModal({ table, rect: table });
            }}
            className={`absolute group rounded-lg cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-indigo-400/70 ${
              isDrawing ? 'pointer-events-none' : ''
            } ${activeId === table.id ? 'z-40' : 'hover:z-30'}`}
            style={boxStyle(table)}
          >
            {renderHandles('zone', table)}

            {/* Quick actions: edit / delete */}
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#16182c] p-1 rounded-lg border border-white/20 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setTableModal({ table, rect: table });
                }}
                className="p-1 hover:bg-white/10 rounded text-slate-300 hover:text-white"
                title="Rename / Edit / Link"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  promptDeleteTable(table);
                }}
                className="p-1 hover:bg-rose-500/20 rounded text-rose-400 hover:text-rose-300"
                title="Delete Zone"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}

        {/* Live preview while drawing - blue while valid, red once too small to create */}
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

      {/* Editor toolbar + instructions, pinned below the map's top bar (outside
          the zoomable canvas, so it stays put while scrolling). */}
      {mapContainer &&
        createPortal(
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2 bg-[#141628]/90 backdrop-blur-md border border-indigo-400/40 rounded-2xl p-1.5 shadow-xl text-xs font-bold">
              <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-white/5" role="group" aria-label="What to draw">
                <span className="px-2 text-slate-400 font-semibold">Draw:</span>
                {(['zone', 'panel'] as const).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setDrawKind(kind)}
                    aria-pressed={drawKind === kind}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      drawKind === kind ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {kind === 'zone' ? 'Zone' : 'Info panel'}
                  </button>
                ))}
              </div>
              <button
                onClick={promptDiscardDraft}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center gap-1.5 transition-all"
                title="Put everything back to the fixed layout in floorLayout.json"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Discard Changes</span>
              </button>
              {floorTables.length > 0 && (
                <button
                  onClick={promptDeleteAll}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 transition-all"
                  title="Delete all zones on this floor to start over"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete All Zones</span>
                </button>
              )}
            </div>
            <div className="px-4 py-2 rounded-2xl bg-indigo-950/90 border border-indigo-400/40 text-indigo-200 text-xs font-medium shadow-2xl backdrop-blur-md flex items-center gap-2.5 pointer-events-none">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
              <span>
                <strong>Edit Mode:</strong> Drag a zone or info panel to move it • Click it to edit • Drag a corner or edge handle to resize • Click and hold, then drag to draw a new {drawKind === 'panel' ? 'info panel' : 'zone'}
              </span>
            </div>
          </div>,
          mapContainer
        )}

      {createPortal(
        <>
          {tableModal && (
            <EditTableModal
              isOpen
              onClose={() => setTableModal(null)}
              table={tableModal.table}
              newRect={tableModal.rect}
              currentFloor={floor}
              onSave={saveTable}
              onDelete={deleteTable}
              linkedAdminTableIds={new Set(tables.flatMap((t) => (t.adminTableId != null ? [t.adminTableId] : [])))}
            />
          )}
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
        </>,
        document.body
      )}
    </>
  );
}
