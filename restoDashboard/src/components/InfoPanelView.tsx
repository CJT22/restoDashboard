import React, { useLayoutEffect, useRef, useState } from 'react';
import { Timer, ClipboardList, CircleCheck, Gauge, ChevronRight } from 'lucide-react';
import { InfoPanel, InfoPanelLayout, InfoWidgetType, TableRoom } from '../types';
import { INFO_WIDGET_META } from '../data/infoPanels';
import { shortOrderNo } from '../services/orderSync';
import { getRoomTiming, formatDuration, formatHours, formatWait } from '../utils/roomTimer';

// Read-only widgets for an info panel on the floor plan. Everything is derived
// from the floor's tables (and their live activeOrder) already in memory — no
// fetching — so the only ongoing cost is the map's shared 1s tick.
//
// Every layout is a set of columns, each a vertical stack of widget cards:
//   stack = 1 column, row = 1 column per widget, auto = as many columns as
//   fit, filled left to right. Within a column, summary widgets take their
//   natural height and list widgets share the rest (each scrolling on its
//   own), so every widget has a real height to lay out against.

const WIDGET_ICONS: Record<InfoWidgetType, React.ComponentType<{ className?: string }>> = {
  roomTimers: Timer,
  activeOrders: ClipboardList,
  availableNow: CircleCheck,
  occupancy: Gauge,
};

// Lists grow to fill their column; summaries keep their natural height.
const LIST_WIDGETS: InfoWidgetType[] = ['roomTimers', 'activeOrders'];

const PANEL_PAD_PX = 8;
const GAP_PX = 8;
// Order items shown per order before collapsing the rest to "+N more".
const MAX_ITEMS_PER_ORDER = 4;

// Smaller type and columns on small panels (e.g. an iPad-sized canvas).
export function isCompactPanel(widthPx: number, heightPx: number): boolean {
  return Math.min(widthPx, heightPx) < 160;
}

// How many side-by-side columns fit at this on-screen width.
export function maxPanelColumns(widthPx: number, compact: boolean): number {
  const minColumnPx = compact ? 130 : 150;
  const inner = widthPx - 2 * PANEL_PAD_PX;
  return Math.max(1, Math.floor((inner + GAP_PX) / (minColumnPx + GAP_PX)));
}

function getColumns(widgets: InfoWidgetType[], layout: InfoPanelLayout, maxColumns: number): InfoWidgetType[][] {
  const count =
    layout === 'stack' ? 1 : layout === 'row' ? (maxColumns >= widgets.length ? widgets.length : 1) : Math.min(widgets.length, maxColumns);
  const columns: InfoWidgetType[][] = Array.from({ length: Math.max(1, count) }, () => []);
  // Row-major, so widgets still read left-to-right, top-to-bottom in order.
  widgets.forEach((w, i) => columns[i % columns.length].push(w));
  return columns;
}

interface InfoPanelViewProps {
  panel: InfoPanel;
  floorTables: TableRoom[];
  nowMs: number;
  widthPx: number;
  heightPx: number;
  // Rows open that zone's detail modal; off in Edit Zones, where clicking
  // the panel edits it instead.
  interactive: boolean;
  onSelectTable: (table: TableRoom) => void;
}

interface WidgetProps {
  floorTables: TableRoom[];
  nowMs: number;
  compact: boolean;
  interactive: boolean;
  onSelectTable: (table: TableRoom) => void;
}

export const InfoPanelView: React.FC<InfoPanelViewProps> = ({
  panel,
  floorTables,
  nowMs,
  widthPx,
  heightPx,
  interactive,
  onSelectTable,
}) => {
  const compact = isCompactPanel(widthPx, heightPx);
  const columns = getColumns(panel.widgets, panel.layout ?? 'auto', maxPanelColumns(widthPx, compact));
  const widgetProps: WidgetProps = { floorTables, nowMs, compact, interactive, onSelectTable };

  return (
    <div
      className={`flex h-full ${compact ? 'text-[10px]' : 'text-[11px]'} leading-snug`}
      style={{ gap: GAP_PX, padding: PANEL_PAD_PX }}
    >
      {columns.map((column, i) => (
        <div key={i} className="flex-1 min-w-0 min-h-0 flex flex-col" style={{ gap: GAP_PX }}>
          {column.map((type) => (
            <WidgetCard key={type} isList={LIST_WIDGETS.includes(type)}>
              {type === 'roomTimers' && <RoomTimersWidget {...widgetProps} />}
              {type === 'activeOrders' && <ActiveOrdersWidget {...widgetProps} />}
              {type === 'availableNow' && <AvailableNowWidget {...widgetProps} />}
              {type === 'occupancy' && <OccupancyWidget {...widgetProps} />}
            </WidgetCard>
          ))}
        </div>
      ))}
    </div>
  );
};

// Each widget sits on its own faint card so stacked and side-by-side
// widgets read as separate blocks with the same spacing either way.
const WidgetCard: React.FC<{ isList: boolean; children: React.ReactNode }> = ({
  isList,
  children,
}) => (
  <section
    className={`min-w-0 flex flex-col rounded-lg bg-white/[0.04] border border-white/[0.07] p-1.5 ${
      isList ? 'flex-1 min-h-[56px]' : 'shrink-0'
    }`}
  >
    {children}
  </section>
);

const WidgetHeader: React.FC<{ type: InfoWidgetType; count?: number }> = ({ type, count }) => {
  const Icon = WIDGET_ICONS[type];
  return (
    <h4 className="shrink-0 flex items-center gap-1.5 px-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate">{INFO_WIDGET_META[type].title}</span>
      {count != null && (
        <span className="ml-auto shrink-0 px-1.5 rounded-full bg-white/10 text-slate-300 tabular-nums">{count}</span>
      )}
    </h4>
  );
};

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-1 text-slate-500 italic">{children}</div>
);

const rowHeightPx = (compact: boolean) => (compact ? 16 : 18);
const rowButtonClass = (interactive: boolean) =>
  `min-w-0 flex items-center gap-1.5 rounded-md text-left ${interactive ? 'hover:bg-white/10 cursor-pointer' : 'pointer-events-none'}`;

const RoomTimersWidget: React.FC<WidgetProps> = ({ floorTables, nowMs, compact, interactive, onSelectTable }) => {
  // Ascending remaining time puts the most-overdue rooms first.
  const rows = floorTables
    .map((table) => ({ table, timing: getRoomTiming(table.activeOrder, nowMs) }))
    .filter((r): r is { table: TableRoom; timing: NonNullable<typeof r.timing> } => r.timing != null)
    .sort((a, b) => a.timing.remainingMs - b.timing.remainingMs);

  return (
    <>
      <WidgetHeader type="roomTimers" count={rows.length} />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {rows.length ? (
          rows.map(({ table, timing }) => (
            <button
              key={table.id}
              onClick={() => onSelectTable(table)}
              className={`w-full px-1 ${rowButtonClass(interactive)}`}
              style={{ height: rowHeightPx(compact) }}
            >
              <span className="truncate font-semibold text-white">{table.name}</span>
              <span className="shrink-0 text-slate-500">{formatHours(timing.hours)}</span>
              <span className="ml-auto shrink-0 font-bold tabular-nums text-white">
                {timing.expired ? `EXPIRED +${formatDuration(timing.remainingMs)}` : `${formatDuration(timing.remainingMs)} left`}
              </span>
            </button>
          ))
        ) : (
          <Empty>No rooms running</Empty>
        )}
      </div>
    </>
  );
};

// Order rows expand to list their items. If every order's items fit the
// widget's measured height they all start expanded, otherwise collapsed;
// either way staff can toggle any order with its ▸ button, and that choice
// wins for as long as the page is open.
const ActiveOrdersWidget: React.FC<WidgetProps> = ({ floorTables, nowMs, compact, interactive, onSelectTable }) => {
  const rows = floorTables
    .filter((t) => t.activeOrder != null)
    .sort((a, b) => (a.activeOrder?.createdAt ?? '').localeCompare(b.activeOrder?.createdAt ?? ''));

  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeightPx, setBodyHeightPx] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBodyHeightPx(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [expandedOverrides, setExpandedOverrides] = useState<Record<number, boolean>>({});

  const rowPx = rowHeightPx(compact);
  const itemLineCount = (count: number) => Math.min(count, MAX_ITEMS_PER_ORDER) + (count > MAX_ITEMS_PER_ORDER ? 1 : 0);
  const linesIfAllExpanded = rows.reduce((sum, t) => sum + 1 + itemLineCount(t.activeOrder!.items.length), 0);
  const allFit = linesIfAllExpanded * rowPx <= bodyHeightPx;

  return (
    <>
      <WidgetHeader type="activeOrders" count={rows.length} />
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {rows.length ? (
          rows.map((table) => {
            const order = table.activeOrder!;
            const startMs = order.createdAt ? Date.parse(order.createdAt) : NaN;
            const hasItems = order.items.length > 0;
            const expanded = hasItems && (expandedOverrides[order.id] ?? allFit);
            return (
              <div key={table.id}>
                <div className="flex items-center gap-1 px-1" style={{ height: rowPx }}>
                  <button onClick={() => onSelectTable(table)} className={`flex-1 ${rowButtonClass(interactive)}`}>
                    <span className="truncate font-semibold text-white">{table.name}</span>
                    <span className="truncate text-slate-500">#{shortOrderNo(order.orderNo)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-slate-300">
                      {Number.isFinite(startMs) ? formatWait(nowMs - startMs) : ''}
                    </span>
                  </button>
                  {hasItems ? (
                    <button
                      onClick={() => setExpandedOverrides((prev) => ({ ...prev, [order.id]: !expanded }))}
                      className={`shrink-0 w-4 h-4 rounded flex items-center justify-center text-slate-400 ${
                        interactive ? 'hover:bg-white/10 hover:text-white cursor-pointer' : 'pointer-events-none'
                      }`}
                      aria-expanded={expanded}
                      aria-label={expanded ? `Hide items for ${table.name}` : `Show items for ${table.name}`}
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </button>
                  ) : (
                    <span className="shrink-0 w-4" />
                  )}
                </div>
                {expanded && (
                  <div className="pl-3 pr-1 text-slate-400">
                    {order.items.slice(0, MAX_ITEMS_PER_ORDER).map((item) => (
                      <div key={item.id} className="flex items-center gap-1.5" style={{ height: rowPx }}>
                        <span className="shrink-0 tabular-nums text-slate-300">{item.quantity}×</span>
                        <span className="truncate">{item.name}</span>
                      </div>
                    ))}
                    {order.items.length > MAX_ITEMS_PER_ORDER && (
                      <div className="italic text-slate-500" style={{ height: rowPx }}>
                        +{order.items.length - MAX_ITEMS_PER_ORDER} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <Empty>No open orders</Empty>
        )}
      </div>
    </>
  );
};

const AvailableNowWidget: React.FC<WidgetProps> = ({ floorTables, interactive, onSelectTable }) => {
  const free = floorTables.filter((t) => t.status === 'available');
  return (
    <>
      <WidgetHeader type="availableNow" count={free.length} />
      {free.length ? (
        <div className="flex flex-wrap gap-1 px-1">
          {free.map((table) => (
            <button
              key={table.id}
              onClick={() => onSelectTable(table)}
              className={`px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 font-semibold ${
                interactive ? 'hover:bg-emerald-500/25 cursor-pointer' : 'pointer-events-none'
              }`}
            >
              {table.name}
            </button>
          ))}
        </div>
      ) : (
        <Empty>Everything is occupied</Empty>
      )}
    </>
  );
};

const OccupancyWidget: React.FC<WidgetProps> = ({ floorTables, nowMs }) => {
  const total = floorTables.length;
  const occupied = floorTables.filter((t) => t.status === 'occupied').length;
  const activeOrders = floorTables.filter((t) => t.activeOrder != null).length;
  const timings = floorTables.map((t) => getRoomTiming(t.activeOrder, nowMs)).filter((t) => t != null);
  const expired = timings.filter((t) => t.expired).length;
  const pct = total ? Math.round((occupied / total) * 100) : 0;
  const stats: [string, React.ReactNode][] = [
    ['Occupied', `${occupied} / ${total}`],
    ['Available', total - occupied],
    ['Active orders', activeOrders],
  ];
  if (timings.length) {
    stats.push(['Rooms running', timings.length], ['Rooms expired', expired]);
  }

  return (
    <>
      <WidgetHeader type="occupancy" />
      <div className="px-1 space-y-1">
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" title={`${pct}% occupied`}>
          <div className="h-full rounded-full bg-amber-400/80" style={{ width: `${pct}%` }} />
        </div>
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-slate-400">{label}</span>
            <span className="font-bold tabular-nums text-white">{value}</span>
          </div>
        ))}
      </div>
    </>
  );
};
