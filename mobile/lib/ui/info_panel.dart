import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/room_timer.dart';
import 'common.dart';

// Read-only widgets for an info panel on the floor plan
// (src/components/InfoPanelView.tsx). All but Total Sales are derived from
// the zones already in memory.

const _titles = {
  InfoWidgetType.roomTimers: 'Room Timers',
  InfoWidgetType.activeOrders: 'Active Orders',
  InfoWidgetType.totalSales: 'Total Sales',
  InfoWidgetType.occupancy: 'Occupancy',
};

const _icons = {
  InfoWidgetType.roomTimers: Icons.timer_outlined,
  InfoWidgetType.activeOrders: Icons.assignment_outlined,
  InfoWidgetType.totalSales: Icons.payments_outlined,
  InfoWidgetType.occupancy: Icons.speed,
};

// Lists grow to fill their column; summaries keep their natural height.
const _listWidgets = [InfoWidgetType.roomTimers, InfoWidgetType.activeOrders];

const _pad = 8.0;
const _gap = 8.0;

const _floorScopes = <(FloorScope, String)>[(1, '1F'), (2, '2F'), (null, 'All')];

// Staff's toggle choices, per panel + widget, until the app restarts, so
// they survive switching floors.
final _sessionScopes = <String, FloorScope>{};
var _sessionSalesPeriod = 'today';

const _salesPeriods = [('today', 'Today'), ('yesterday', 'Yest.'), ('week', 'Week'), ('month', 'Month')];

class InfoPanelView extends StatelessWidget {
  final InfoPanel panel;
  final DashboardState state;
  final DateTime now;
  final double widthPx, heightPx;
  final ValueChanged<Zone> onSelectZone;

  const InfoPanelView({
    super.key,
    required this.panel,
    required this.state,
    required this.now,
    required this.widthPx,
    required this.heightPx,
    required this.onSelectZone,
  });

  @override
  Widget build(BuildContext context) {
    final compact = math.min(widthPx, heightPx) < 160;
    final minColumn = compact ? 130.0 : 150.0;
    final maxColumns = math.max(1, ((widthPx - 2 * _pad + _gap) / (minColumn + _gap)).floor());
    final widgets = panel.widgets;
    final count = switch (panel.layout) {
      'stack' => 1,
      'row' => maxColumns >= widgets.length ? widgets.length : 1,
      _ => math.min(widgets.length, maxColumns),
    };
    final columns = List.generate(math.max(1, count), (_) => <InfoWidgetType>[]);
    for (var i = 0; i < widgets.length; i++) {
      columns[i % columns.length].add(widgets[i]);
    }

    return DefaultTextStyle.merge(
      style: TextStyle(fontSize: compact ? 10 : 11, height: 1.35, color: AppColors.slate200),
      child: Padding(
        padding: const EdgeInsets.all(_pad),
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (var c = 0; c < columns.length; c++) ...[
            if (c > 0) const SizedBox(width: _gap),
            Expanded(child: _column(columns[c], compact)),
          ],
        ]),
      ),
    );
  }

  // A column with a list widget fills the panel's height (the list scrolls);
  // one with only summaries scrolls as a whole if the panel is too short.
  Widget _column(List<InfoWidgetType> types, bool compact) {
    final children = [
      for (var i = 0; i < types.length; i++) ...[
        if (i > 0) const SizedBox(height: _gap),
        _card(types[i], compact),
      ],
    ];
    if (types.any(_listWidgets.contains)) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    }
    return SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children));
  }

  Widget _card(InfoWidgetType type, bool compact) {
    final body = switch (type) {
      InfoWidgetType.roomTimers => _RoomTimers(panel: panel, state: state, now: now, compact: compact, onSelectZone: onSelectZone),
      InfoWidgetType.activeOrders =>
        _ActiveOrders(panel: panel, state: state, now: now, compact: compact, onSelectZone: onSelectZone),
      InfoWidgetType.totalSales => _TotalSales(state: state),
      InfoWidgetType.occupancy => _Occupancy(panel: panel, state: state, now: now),
    };
    final card = Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: const Color(0x0FFFFFFF),
        border: Border.all(color: const Color(0x1FFFFFFF)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: body,
    );
    return _listWidgets.contains(type) ? Expanded(child: ConstrainedBox(constraints: const BoxConstraints(minHeight: 56), child: card)) : card;
  }
}

class _Header extends StatelessWidget {
  final InfoWidgetType type;
  final int? count;
  const _Header(this.type, [this.count]);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 0, 4, 4),
        child: Row(children: [
          Icon(_icons[type], size: 12, color: AppColors.slate400),
          const SizedBox(width: 6),
          Expanded(
            child: Text(_titles[type]!.toUpperCase(),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.slate400)),
          ),
          if (count != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(99)),
              child: Text('$count', style: const TextStyle(fontSize: 10, color: AppColors.slate300, fontFeatures: tabular)),
            ),
        ]),
      );
}

class _Empty extends StatelessWidget {
  final String text;
  const _Empty(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Text(text, style: const TextStyle(color: AppColors.slate500, fontStyle: FontStyle.italic)),
      );
}

/// Which floor(s) a widget shows: its layout default, unless staff flipped it.
mixin _FloorScoped<T extends StatefulWidget> on State<T> {
  InfoPanel get scopedPanel;
  InfoWidgetType get scopedType;

  String get _key => '${scopedPanel.id}:${scopedType.name}';

  FloorScope get scope =>
      _sessionScopes.containsKey(_key) ? _sessionScopes[_key] : scopedPanel.startingScope(scopedType);

  void setScope(FloorScope s) => setState(() => _sessionScopes[_key] = s);

  bool inScope(Zone z) => scope == null || z.floor == scope;

  Widget floorToggle() => Padding(
        padding: const EdgeInsets.only(top: 3),
        child: Segmented<FloorScope>(options: _floorScopes, value: scope, onChanged: setScope, dense: true),
      );
}

double _rowHeight(bool compact) => compact ? 18 : 20;

Widget _floorSubheading(int floor, int count, double height) => Container(
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x12FFFFFF)))),
      child: Row(children: [
        Expanded(
          child: Text(floorLabels[floor]!.toUpperCase(),
              style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 0.6, color: AppColors.slate500)),
        ),
        Text('$count', style: const TextStyle(fontSize: 9, color: AppColors.slate500, fontFeatures: tabular)),
      ]),
    );

/// In All mode, rows split under a heading per floor (floors with nothing
/// left out); otherwise one untitled group.
List<(int?, List<R>)> _groupByFloor<R>(List<R> rows, int Function(R) floorOf, FloorScope scope) {
  if (scope != null) return [(null, rows)];
  return [
    for (final f in [1, 2])
      if (rows.any((r) => floorOf(r) == f)) (f, rows.where((r) => floorOf(r) == f).toList()),
  ];
}

class _RoomTimers extends StatefulWidget {
  final InfoPanel panel;
  final DashboardState state;
  final DateTime now;
  final bool compact;
  final ValueChanged<Zone> onSelectZone;
  const _RoomTimers({required this.panel, required this.state, required this.now, required this.compact, required this.onSelectZone});

  @override
  State<_RoomTimers> createState() => _RoomTimersState();
}

class _RoomTimersState extends State<_RoomTimers> with _FloorScoped {
  @override
  InfoPanel get scopedPanel => widget.panel;
  @override
  InfoWidgetType get scopedType => InfoWidgetType.roomTimers;

  @override
  Widget build(BuildContext context) {
    // Expired rooms pinned to the top; within that and the rest, A–Z.
    final rows = <(Zone, RoomTiming)>[
      for (final z in widget.state.zones.where(inScope))
        if (getRoomTiming(z.activeOrder, widget.now, fallbackRate: z.adminRoomCharge ?? 0) case final t?) (z, t),
    ]..sort((a, b) {
        final e = (b.$2.expired ? 1 : 0) - (a.$2.expired ? 1 : 0);
        return e != 0 ? e : byZoneName(a.$1, b.$1);
      });
    final rowH = _rowHeight(widget.compact);

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Header(InfoWidgetType.roomTimers, rows.length),
      Expanded(
        child: rows.isEmpty
            ? const _Empty('No rooms running')
            : ListView(padding: EdgeInsets.zero, children: [
                for (final (floor, group) in _groupByFloor(rows, (r) => r.$1.floor, scope)) ...[
                  if (floor != null) _floorSubheading(floor, group.length, rowH),
                  for (final (zone, t) in group)
                    InkWell(
                      borderRadius: BorderRadius.circular(6),
                      onTap: () => widget.onSelectZone(zone),
                      child: SizedBox(
                        height: rowH,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          // The timer never shrinks for the name, but it's
                          // capped at the row's width so a narrow column
                          // (two side by side once the sidebar collapses)
                          // clips it rather than overflowing.
                          child: LayoutBuilder(
                            builder: (context, box) => Row(children: [
                              Flexible(
                                flex: 3,
                                child: Text(zone.name,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white)),
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(formatHours(t.hours),
                                    overflow: TextOverflow.clip, softWrap: false, style: const TextStyle(color: AppColors.slate400)),
                              ),
                              const Spacer(),
                              ConstrainedBox(
                                constraints: BoxConstraints(maxWidth: math.max(0, box.maxWidth - 6)),
                                child: Text(
                                    t.expired ? '+${formatDuration(t.remaining)}' : '${formatDuration(t.remaining)} left',
                                    softWrap: false,
                                    overflow: TextOverflow.clip,
                                    style: TextStyle(fontWeight: FontWeight.w700, color: timerColor(t), fontFeatures: tabular)),
                              ),
                            ]),
                          ),
                        ),
                      ),
                    ),
                ],
              ]),
      ),
      floorToggle(),
    ]);
  }
}

class _ActiveOrders extends StatefulWidget {
  final InfoPanel panel;
  final DashboardState state;
  final DateTime now;
  final bool compact;
  final ValueChanged<Zone> onSelectZone;
  const _ActiveOrders({required this.panel, required this.state, required this.now, required this.compact, required this.onSelectZone});

  @override
  State<_ActiveOrders> createState() => _ActiveOrdersState();
}

class _ActiveOrdersState extends State<_ActiveOrders> with _FloorScoped {
  @override
  InfoPanel get scopedPanel => widget.panel;
  @override
  InfoWidgetType get scopedType => InfoWidgetType.activeOrders;

  // Rows start expanded when every order's items fit, else collapsed; a
  // tap on ▸ wins for as long as the app is open.
  final _expanded = <int, bool>{};

  @override
  Widget build(BuildContext context) {
    final rows = widget.state.zones.where((z) => z.activeOrder != null && inScope(z)).toList()..sort(byZoneName);
    final groups = _groupByFloor(rows, (z) => z.floor, scope);
    final rowH = _rowHeight(widget.compact);
    int itemLines(int n) => math.min(n, maxListedOrderItems) + (n > maxListedOrderItems ? 1 : 0);
    final linesIfAllExpanded = groups.where((g) => g.$1 != null).length +
        rows.fold<int>(0, (s, z) => s + 1 + itemLines(groupOrderLines(z.activeOrder!.items).length));

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Header(InfoWidgetType.activeOrders, rows.length),
      Expanded(
        child: LayoutBuilder(builder: (context, box) {
          final allFit = linesIfAllExpanded * rowH <= box.maxHeight;
          if (rows.isEmpty) return const _Empty('No open orders');
          return ListView(padding: EdgeInsets.zero, children: [
            for (final (floor, group) in groups) ...[
              if (floor != null) _floorSubheading(floor, group.length, rowH),
              for (final z in group) ..._orderRows(z, rowH, allFit),
            ],
          ]);
        }),
      ),
      floorToggle(),
    ]);
  }

  List<Widget> _orderRows(Zone z, double rowH, bool allFit) {
    final order = z.activeOrder!;
    final items = groupOrderLines(order.items);
    final start = order.createdAt == null ? null : DateTime.tryParse(order.createdAt!);
    final expanded = items.isNotEmpty && (_expanded[order.id] ?? allFit);
    return [
      SizedBox(
        height: rowH,
        child: Row(children: [
          Expanded(
            child: InkWell(
              borderRadius: BorderRadius.circular(6),
              onTap: () => widget.onSelectZone(z),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(children: [
                  Expanded(
                    child: Text(z.name,
                        overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white)),
                  ),
                  if (start != null)
                    Text(formatWait(widget.now.difference(start)),
                        style: const TextStyle(color: AppColors.slate300, fontFeatures: tabular)),
                ]),
              ),
            ),
          ),
          SizedBox(
            width: rowH,
            child: items.isEmpty
                ? null
                : InkWell(
                    borderRadius: BorderRadius.circular(4),
                    onTap: () => setState(() => _expanded[order.id] = !expanded),
                    child: AnimatedRotation(
                      turns: expanded ? 0.25 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: const Icon(Icons.chevron_right, size: 14, color: AppColors.slate400),
                    ),
                  ),
          ),
        ]),
      ),
      if (expanded) ...[
        for (final it in items.take(maxListedOrderItems))
          SizedBox(
            height: rowH,
            child: Padding(
              padding: const EdgeInsets.only(left: 12, right: 4),
              child: Row(children: [
                Text('${formatQty(it.quantity)}×', style: const TextStyle(color: AppColors.slate400, fontFeatures: tabular)),
                const SizedBox(width: 6),
                Expanded(child: Text(it.name, overflow: TextOverflow.ellipsis)),
              ]),
            ),
          ),
        if (items.length > maxListedOrderItems)
          SizedBox(
            height: rowH,
            child: Padding(
              padding: const EdgeInsets.only(left: 12),
              child: Text('+${items.length - maxListedOrderItems} more',
                  style: const TextStyle(color: AppColors.slate500, fontStyle: FontStyle.italic)),
            ),
          ),
      ],
    ];
  }
}

/// Branch-wide paid sales for the chosen period (from restoAdmin), plus open
/// tabs (every open order on the map) and the expected total if they settle.
/// Refetches after order events and every minute.
class _TotalSales extends StatefulWidget {
  final DashboardState state;
  const _TotalSales({required this.state});

  @override
  State<_TotalSales> createState() => _TotalSalesState();
}

class _TotalSalesState extends State<_TotalSales> {
  String _period = _sessionSalesPeriod;
  SalesSummary? _data;
  bool _error = false;
  Timer? _poll;
  Timer? _debounce;
  StreamSubscription? _sub;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(minutes: 1), (_) => _load());
    _sub = widget.state.orderEvents.listen((_) {
      _debounce?.cancel();
      _debounce = Timer(const Duration(seconds: 1), _load);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _debounce?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final period = _period;
    try {
      final data = await widget.state.api.sales(period);
      if (!mounted || period != _period) return;
      setState(() {
        _data = data;
        _error = false;
      });
    } catch (_) {
      if (mounted) setState(() => _error = true);
    }
  }

  void _setPeriod(String p) {
    _sessionSalesPeriod = p;
    setState(() {
      _period = p;
      _data = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final current = _data?.period == _period ? _data : null;
    final open = widget.state.zones.where((z) => z.activeOrder != null).toList();
    final openTotal = open.fold<double>(0, (s, z) => s + z.activeOrder!.grandTotal);
    final showExpected = current != null && _period != 'yesterday';

    Widget row(String label, String value, Color color) => Row(children: [
          Expanded(child: Text(label, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.slate400))),
          const SizedBox(width: 4),
          Flexible(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(value, style: TextStyle(fontWeight: FontWeight.w700, color: color, fontFeatures: tabular)),
            ),
          ),
        ]);

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      const _Header(InfoWidgetType.totalSales),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('BOTH FLOORS · PAID',
              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 0.6, color: AppColors.slate500)),
          Text(current != null ? peso(current.totalPaid) : (_error ? '—' : '…'),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white, fontFeatures: tabular)),
          Text(
            current != null
                ? '${current.paidCount} ${current.paidCount == 1 ? 'order' : 'orders'} settled'
                : (_error ? "Can't reach restoAdmin" : 'Loading…'),
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.slate400),
          ),
          const SizedBox(height: 4),
          Container(height: 1, color: const Color(0x12FFFFFF)),
          const SizedBox(height: 3),
          row('Open tabs (${open.length})', peso(openTotal), AppColors.amber300),
          if (showExpected) row('Expected', peso(current.totalPaid + openTotal), AppColors.emerald300),
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Segmented<String>(options: _salesPeriods, value: _period, onChanged: _setPeriod, dense: true),
          ),
        ]),
      ),
    ]);
  }
}

class _Occupancy extends StatefulWidget {
  final InfoPanel panel;
  final DashboardState state;
  final DateTime now;
  const _Occupancy({required this.panel, required this.state, required this.now});

  @override
  State<_Occupancy> createState() => _OccupancyState();
}

class _OccupancyState extends State<_Occupancy> with _FloorScoped {
  @override
  InfoPanel get scopedPanel => widget.panel;
  @override
  InfoWidgetType get scopedType => InfoWidgetType.occupancy;

  Widget _bar(double fraction, double height) => ClipRRect(
        borderRadius: BorderRadius.circular(99),
        child: LinearProgressIndicator(
          value: fraction,
          minHeight: height,
          backgroundColor: AppColors.border,
          color: AppColors.amber400.withValues(alpha: 0.8),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final zones = widget.state.zones.where(inScope).toList();
    final total = zones.length;
    final occupied = zones.where((z) => z.status == TableStatus.occupied).length;
    final active = zones.where((z) => z.activeOrder != null).length;
    final timings = [
      for (final z in zones) ?getRoomTiming(z.activeOrder, widget.now, fallbackRate: z.adminRoomCharge ?? 0),
    ];
    final stats = <(String, String)>[
      ('Occupied', '$occupied / $total'),
      ('Available', '${total - occupied}'),
      ('Active orders', '$active'),
      if (timings.isNotEmpty) ('Rooms running', '${timings.length}'),
      if (timings.isNotEmpty) ('Rooms expired', '${timings.where((t) => t.expired).length}'),
    ];
    final perFloor = _groupByFloor(zones, (z) => z.floor, scope).where((g) => g.$1 != null).toList();

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      const _Header(InfoWidgetType.occupancy),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _bar(total == 0 ? 0 : occupied / total, 6),
          const SizedBox(height: 3),
          for (final (label, value) in stats)
            Row(children: [
              Expanded(child: Text(label, style: const TextStyle(color: AppColors.slate400))),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
            ]),
          if (perFloor.isNotEmpty) ...[
            const SizedBox(height: 3),
            Container(height: 1, color: const Color(0x12FFFFFF)),
            const SizedBox(height: 3),
            for (final (floor, rows) in perFloor)
              Row(children: [
                Text('${floor}F', style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate400)),
                const SizedBox(width: 4),
                Expanded(
                    child: _bar(rows.where((z) => z.status == TableStatus.occupied).length / rows.length, 4)),
                const SizedBox(width: 6),
                Flexible(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text('${rows.where((z) => z.status == TableStatus.occupied).length} / ${rows.length}',
                        style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
                  ),
                ),
              ]),
          ],
          floorToggle(),
        ]),
      ),
    ]);
  }
}
