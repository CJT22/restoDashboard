import React, { useLayoutEffect, useRef, useState } from 'react';
import { Timer, ClipboardList, Banknote, Gauge, ChevronRight } from 'lucide-react';
import { FloorScope, InfoPanel, InfoPanelLayout, InfoWidgetType, TableRoom } from '../types';
import { INFO_WIDGET_META } from '../data/infoPanels';
import { MAX_LISTED_ORDER_ITEMS } from '../services/orderSync';
import { getSales, SALES_PERIODS, SalesPeriod, useLiveSales } from '../services/salesSync';
import { getRoomTiming, formatDuration, formatHours, formatWait, formatClockTime, getTimerTone, TIMER_TEXT_CLASS } from '../utils/roomTimer';

// Read-only widgets for an info panel on the floor plan. Everything except
// Total Sales is derived from the tables (and their live activeOrder)
// already in memory — no fetching — so their only ongoing cost is the map's
// shared 1s tick. Total Sales fetches paid sales from restoAdmin (see
// TotalSalesWidget).
//
// Room Timers, Active Orders and Occupancy each have a 1F / 2F / All toggle.
// Each one starts on the floor fixed in the layout (see useFloorScope).
//
// Every layout is a set of columns, each a vertical stack of widget cards:
//   stack = 1 column, row = 1 column per widget, auto = as many columns as
//   fit, filled left to right. Within a column, summary widgets take their
//   natural height and list widgets share the rest (each scrolling on its
//   own), so every widget has a real height to lay out against.

const WIDGET_ICONS: Record<InfoWidgetType, React.ComponentType<{ className?: string }>> = {
  roomTimers: Timer,
  activeOrders: ClipboardList,
  totalSales: Banknote,
  occupancy: Gauge,
};

// Lists grow to fill their column; summaries keep their natural height.
const LIST_WIDGETS: InfoWidgetType[] = ['roomTimers', 'activeOrders'];

const PANEL_PAD_PX = 8;
const GAP_PX = 8;

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
  // Both floors; each widget narrows these to the floor(s) it's set to.
  allTables: TableRoom[];
  nowMs: number;
  widthPx: number;
  heightPx: number;
  // Rows open that zone's detail modal; off in the (dormant) layout editor,
  // where clicking the panel edits it instead.
  interactive: boolean;
  onSelectTable: (table: TableRoom) => void;
}

interface WidgetProps {
  panel: InfoPanel;
  allTables: TableRoom[];
  nowMs: number;
  compact: boolean;
  interactive: boolean;
  onSelectTable: (table: TableRoom) => void;
}

export const InfoPanelView: React.FC<InfoPanelViewProps> = ({
  panel,
  allTables,
  nowMs,
  widthPx,
  heightPx,
  interactive,
  onSelectTable,
}) => {
  const compact = isCompactPanel(widthPx, heightPx);
  const columns = getColumns(panel.widgets, panel.layout ?? 'auto', maxPanelColumns(widthPx, compact));
  const widgetProps: WidgetProps = { panel, allTables, nowMs, compact, interactive, onSelectTable };

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
              {type === 'totalSales' && <TotalSalesWidget {...widgetProps} />}
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

// Segmented picker styled like the Total Sales period row; shared by that
// and the floor toggles so they read as one control.
function SegmentedToggle<T extends string | number>({
  options,
  value,
  onChange,
  interactive,
  ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  interactive: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="shrink-0 flex gap-0.5 pt-0.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex-1 min-w-0 truncate px-1 py-0.5 rounded-md text-[10px] font-semibold ${
              active
                ? 'bg-indigo-500/30 text-indigo-100 border border-indigo-400/40'
                : 'text-slate-400 border border-transparent'
            } ${interactive ? (active ? '' : 'hover:bg-white/10 cursor-pointer') : 'pointer-events-none'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const FLOOR_SCOPES: { value: FloorScope; label: string }[] = [
  { value: 1, label: '1F' },
  { value: 2, label: '2F' },
  { value: 'all', label: 'All' },
];

const FLOORS: (1 | 2)[] = [1, 2];
const FLOOR_NAMES: Record<1 | 2, string> = { 1: '1st Floor', 2: '2nd Floor' };

// Staff's toggle choices, per panel + widget, for this page load only —
// kept outside the widgets so they survive switching floors (which unmounts
// the other floor's panels), but every reload starts back on the layout's
// fixed floors, so all devices agree.
const sessionFloorScopes = new Map<string, FloorScope>();

// Which floor(s) a widget shows: the layout's widgetFloors entry, else the
// panel's own floor — unless staff flipped it this session.
function useFloorScope(panel: InfoPanel, widget: InfoWidgetType): [FloorScope, (scope: FloorScope) => void] {
  const key = `${panel.id}:${widget}`;
  const [scope, setScope] = useState<FloorScope>(
    () => sessionFloorScopes.get(key) ?? panel.widgetFloors?.[widget] ?? panel.floor
  );

  const update = (next: FloorScope) => {
    sessionFloorScopes.set(key, next);
    setScope(next);
  };
  return [scope, update];
}

const inScope = (table: TableRoom, scope: FloorScope) => scope === 'all' || table.floor === scope;

// In All mode lists are split under a heading per floor; floors with
// nothing to show are left out. Otherwise it's one untitled group.
function groupByFloor<R>(rows: R[], floorOf: (row: R) => 1 | 2, scope: FloorScope): { floor?: 1 | 2; rows: R[] }[] {
  if (scope !== 'all') return [{ rows }];
  return FLOORS.map((floor) => ({ floor, rows: rows.filter((r) => floorOf(r) === floor) })).filter((g) => g.rows.length);
}

const FloorSubheading: React.FC<{ floor: 1 | 2; count: number; heightPx: number }> = ({ floor, count, heightPx }) => (
  <div
    className="flex items-center gap-1.5 px-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500 border-b border-white/[0.07]"
    style={{ height: heightPx }}
  >
    <span className="truncate">{FLOOR_NAMES[floor]}</span>
    <span className="ml-auto shrink-0 tabular-nums">{count}</span>
  </div>
);

const FloorToggle: React.FC<{ scope: FloorScope; onChange: (scope: FloorScope) => void; interactive: boolean }> = ({
  scope,
  onChange,
  interactive,
}) => <SegmentedToggle options={FLOOR_SCOPES} value={scope} onChange={onChange} interactive={interactive} ariaLabel="Floor" />;

// A–Z with numbers compared by value, so ROOM 2 comes before ROOM 12 and
// M9 before M10.
const byZoneName = (a: TableRoom, b: TableRoom) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

const RoomTimersWidget: React.FC<WidgetProps> = ({ panel, allTables, nowMs, compact, interactive, onSelectTable }) => {
  const [scope, setScope] = useFloorScope(panel, 'roomTimers');
  // Expired rooms are pinned to the top so they can't be missed; within
  // that and the rest, rooms go A–Z.
  const rows = allTables
    .filter((table) => inScope(table, scope))
    .map((table) => ({ table, timing: getRoomTiming(table.activeOrder, nowMs) }))
    .filter((r): r is { table: TableRoom; timing: NonNullable<typeof r.timing> } => r.timing != null)
    .sort((a, b) => Number(b.timing.expired) - Number(a.timing.expired) || byZoneName(a.table, b.table));
  const rowPx = rowHeightPx(compact);

  return (
    <>
      <WidgetHeader type="roomTimers" count={rows.length} />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {rows.length ? (
          groupByFloor(rows, (r) => r.table.floor, scope).map((group) => (
            <div key={group.floor ?? 'floor'}>
              {group.floor && <FloorSubheading floor={group.floor} count={group.rows.length} heightPx={rowPx} />}
              {group.rows.map(({ table, timing }) => {
                const time = formatDuration(timing.remainingMs);
                return (
                  <button
                    key={table.id}
                    onClick={() => onSelectTable(table)}
                    className={`w-full px-1 ${rowButtonClass(interactive)}`}
                    style={{ height: rowPx }}
                    // Fixed text only: a native tooltip whose text changes
                    // every second (the countdown) closes and redraws on each
                    // tick, so it shows the booking's end time instead.
                    title={`${table.name} · ${formatHours(timing.hours)} booked · ${timing.expired ? 'expired' : 'ends'} ${formatClockTime(timing.endMs)}`}
                  >
                    {/* The room name is what staff scan for, so the booked
                        hours give way first (shrink-[999] empties it before
                        the name starts to truncate), and an expired room shows
                        just its red overtime rather than "EXPIRED +h:mm:ss" -
                        the colour and pin-to-top already say it's expired. */}
                    <span className="truncate font-semibold text-white">{table.name}</span>
                    <span className="min-w-0 shrink-[999] truncate text-slate-400">{formatHours(timing.hours)}</span>
                    <span
                      className={`ml-auto shrink-0 font-bold tabular-nums ${TIMER_TEXT_CLASS[getTimerTone(timing)]}`}
                    >
                      {timing.expired ? `+${time}` : `${time} left`}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <Empty>No rooms running</Empty>
        )}
      </div>
      <FloorToggle scope={scope} onChange={setScope} interactive={interactive} />
    </>
  );
};

// Order rows expand to list their items. If every order's items fit the
// widget's measured height they all start expanded, otherwise collapsed;
// either way staff can toggle any order with its ▸ button, and that choice
// wins for as long as the page is open.
const ActiveOrdersWidget: React.FC<WidgetProps> = ({ panel, allTables, nowMs, compact, interactive, onSelectTable }) => {
  const [scope, setScope] = useFloorScope(panel, 'activeOrders');
  const rows = allTables
    .filter((t) => t.activeOrder != null && inScope(t, scope))
    .sort(byZoneName);
  const groups = groupByFloor(rows, (t) => t.floor, scope);

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
  const itemLineCount = (count: number) => Math.min(count, MAX_LISTED_ORDER_ITEMS) + (count > MAX_LISTED_ORDER_ITEMS ? 1 : 0);
  const floorHeadingLines = groups.filter((g) => g.floor).length;
  const linesIfAllExpanded =
    floorHeadingLines + rows.reduce((sum, t) => sum + 1 + itemLineCount(t.activeOrder!.items.length), 0);
  const allFit = linesIfAllExpanded * rowPx <= bodyHeightPx;

  return (
    <>
      <WidgetHeader type="activeOrders" count={rows.length} />
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {rows.length ? (
          groups.map((group) => (
            <div key={group.floor ?? 'floor'}>
              {group.floor && <FloorSubheading floor={group.floor} count={group.rows.length} heightPx={rowPx} />}
              {group.rows.map((table) => {
                const order = table.activeOrder!;
                const startMs = order.createdAt ? Date.parse(order.createdAt) : NaN;
                const hasItems = order.items.length > 0;
                const expanded = hasItems && (expandedOverrides[order.id] ?? allFit);
                return (
                  <div key={table.id}>
                    <div className="flex items-center gap-1 px-1" style={{ height: rowPx }}>
                      <button onClick={() => onSelectTable(table)} className={`flex-1 ${rowButtonClass(interactive)}`}>
                        <span className="truncate font-semibold text-white">{table.name}</span>
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
                      <div className="pl-3 pr-1 text-slate-200">
                        {order.items.slice(0, MAX_LISTED_ORDER_ITEMS).map((item) => (
                          <div key={item.id} className="flex items-center gap-1.5" style={{ height: rowPx }}>
                            <span className="shrink-0 tabular-nums text-slate-400">{item.quantity}×</span>
                            <span className="truncate">{item.name}</span>
                          </div>
                        ))}
                        {order.items.length > MAX_LISTED_ORDER_ITEMS && (
                          <div className="italic text-slate-500" style={{ height: rowPx }}>
                            +{order.items.length - MAX_LISTED_ORDER_ITEMS} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <Empty>No open orders</Empty>
        )}
      </div>
      <FloorToggle scope={scope} onChange={setScope} interactive={interactive} />
    </>
  );
};

const formatPeso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Shared by every Total Sales widget, for this page load only (same reasoning
// as sessionFloorScopes): each reload starts back on Today.
let sessionSalesPeriod: SalesPeriod = 'today';

// Branch-wide, so it shows the same figures on either floor's panel.
// Headline = paid sales for the chosen period, from restoAdmin's billing
// (the same figure restoAdmin's Billing page shows for that range).
// Open tabs = grand totals of every open order on the map, both floors —
// money still to be collected, computed locally so it's always current.
// Expected = paid + open tabs: where the period lands if every open tab
// settles. Hidden for Yesterday, since today's open tabs aren't
// yesterday's money.
const TotalSalesWidget: React.FC<WidgetProps> = ({ allTables, interactive }) => {
  const [period, setPeriodState] = useState<SalesPeriod>(() => sessionSalesPeriod);
  const setPeriod = (next: SalesPeriod) => {
    sessionSalesPeriod = next;
    setPeriodState(next);
  };
  const { data: current, error } = useLiveSales(getSales, period);

  const openOrders = allTables.filter((t) => t.activeOrder != null);
  const openTotal = openOrders.reduce((sum, t) => sum + (t.activeOrder?.grandTotal ?? 0), 0);
  const showExpected = current != null && period !== 'yesterday';

  return (
    <>
      <WidgetHeader type="totalSales" />
      <div className="px-1 space-y-1">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Both floors · paid</div>
        <div className="text-base font-extrabold tabular-nums text-white leading-tight truncate">
          {current ? formatPeso(current.totalPaid) : error ? '—' : '…'}
        </div>
        <div className="text-slate-400 truncate">
          {current
            ? `${current.paidCount} ${current.paidCount === 1 ? 'order' : 'orders'} settled`
            : error
              ? "Can't reach restoAdmin"
              : 'Loading…'}
        </div>
        <div className="pt-1 border-t border-white/[0.07] space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400 truncate">Open tabs ({openOrders.length})</span>
            <span className="font-bold tabular-nums text-amber-300">{formatPeso(openTotal)}</span>
          </div>
          {showExpected && (
            <div className="flex items-center justify-between gap-2" title="Paid sales plus open tabs, if every open tab settles">
              <span className="text-slate-400 truncate">Expected</span>
              <span className="font-bold tabular-nums text-emerald-300">{formatPeso(current.totalPaid + openTotal)}</span>
            </div>
          )}
        </div>
        <SegmentedToggle<SalesPeriod>
          options={SALES_PERIODS}
          value={period}
          onChange={setPeriod}
          interactive={interactive}
          ariaLabel="Sales period"
        />
      </div>
    </>
  );
};

// Occupancy stats (bar + rows) for a set of tables. The room rows only
// appear when some of those tables have a room running.
const OccupancyStats: React.FC<{ tables: TableRoom[]; nowMs: number }> = ({ tables, nowMs }) => {
  const total = tables.length;
  const occupied = tables.filter((t) => t.status === 'occupied').length;
  const activeOrders = tables.filter((t) => t.activeOrder != null).length;
  const timings = tables.map((t) => getRoomTiming(t.activeOrder, nowMs)).filter((t) => t != null);
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
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" title={`${pct}% occupied`}>
        <div className="h-full rounded-full bg-amber-400/80" style={{ width: `${pct}%` }} />
      </div>
      {stats.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span className="text-slate-400">{label}</span>
          <span className="font-bold tabular-nums text-white">{value}</span>
        </div>
      ))}
    </>
  );
};

// All = both floors combined on top, then one compact line per floor (label,
// bar, occupied / total) so the split is visible without doubling the
// widget's height. The full per-floor stats are one tap away on 1F / 2F.
// A floor with no zones is left out.
const OccupancyWidget: React.FC<WidgetProps> = ({ panel, allTables, nowMs, interactive }) => {
  const [scope, setScope] = useFloorScope(panel, 'occupancy');
  const scopedTables = allTables.filter((t) => inScope(t, scope));
  const floorGroups = groupByFloor(scopedTables, (t) => t.floor, scope).filter((g) => g.floor);

  return (
    <>
      <WidgetHeader type="occupancy" />
      <div className="px-1 space-y-1">
        <OccupancyStats tables={scopedTables} nowMs={nowMs} />
        {floorGroups.length > 0 && (
          <div className="pt-1 border-t border-white/[0.07] space-y-0.5">
            {floorGroups.map(({ floor, rows }) => {
              const occupied = rows.filter((t) => t.status === 'occupied').length;
              const pct = Math.round((occupied / rows.length) * 100);
              return (
                <div key={floor} className="flex items-center gap-1.5" title={`${FLOOR_NAMES[floor!]}: ${pct}% occupied`}>
                  <span className="shrink-0 w-4 font-semibold text-slate-400">{floor}F</span>
                  <div className="flex-1 min-w-0 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400/80" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="shrink-0 font-bold tabular-nums text-white">
                    {occupied} / {rows.length}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <FloorToggle scope={scope} onChange={setScope} interactive={interactive} />
      </div>
    </>
  );
};
