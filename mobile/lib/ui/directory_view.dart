import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/room_timer.dart';
import 'common.dart';

/// The floor filter both list pages share: All Floors / 1st / 2nd, with an
/// optional count per option.
List<(int?, String)> floorFilterOptions([int Function(int? floor)? countOf]) => [
      for (final f in [null, 1, 2])
        (f, '${f == null ? 'All Floors' : floorLabels[f]}${countOf == null ? '' : '  ${countOf(f)}'}'),
    ];

/// Card grid that fits as many ~280px columns as the width allows, up to 4,
/// with every card in a row as tall as the tallest.
class CardGrid extends StatelessWidget {
  final List<Widget> children;
  const CardGrid({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      const gap = 16.0;
      final cols = ((box.maxWidth + gap) / (280 + gap)).floor().clamp(1, 4);
      final rows = <Widget>[];
      for (var i = 0; i < children.length; i += cols) {
        final slice = children.sublist(i, (i + cols).clamp(0, children.length));
        rows.add(Padding(
          padding: EdgeInsets.only(top: i == 0 ? 0 : gap),
          child: IntrinsicHeight(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (var c = 0; c < cols; c++) ...[
                if (c > 0) const SizedBox(width: gap),
                Expanded(child: c < slice.length ? slice[c] : const SizedBox.shrink()),
              ],
            ]),
          ),
        ));
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
    });
  }
}

/// A page header: title, subtitle, and a control on the right.
class PageHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData? icon;
  final Color? iconColor;
  final Widget trailing;
  const PageHeader({super.key, required this.title, required this.subtitle, this.icon, this.iconColor, required this.trailing});

  @override
  Widget build(BuildContext context) {
    final heading = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        if (icon != null) ...[Icon(icon, size: 24, color: iconColor), const SizedBox(width: 12)],
        Flexible(
          child: Text(title,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.white)),
        ),
      ]),
      const SizedBox(height: 4),
      Text(subtitle, style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
    ]);
    return Container(
      padding: const EdgeInsets.only(bottom: 24),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.border))),
      // The control drops under the title when they don't fit side by side.
      child: LayoutBuilder(
        builder: (context, box) => box.maxWidth >= 860
            ? Row(children: [Expanded(child: heading), const SizedBox(width: 16), trailing])
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                heading,
                const SizedBox(height: 16),
                SingleChildScrollView(scrollDirection: Axis.horizontal, child: trailing),
              ]),
      ),
    );
  }
}

/// The zone card's header: name, kind + room countdown, status badge.
class ZoneCardHeader extends StatelessWidget {
  final Zone zone;
  final RoomTiming? timing;
  final bool showFloor;
  const ZoneCardHeader({super.key, required this.zone, required this.timing, this.showFloor = false});

  @override
  Widget build(BuildContext context) {
    final t = timing;
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(zone.name,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
            Text.rich(
              TextSpan(children: [
                TextSpan(text: showFloor ? 'Floor ${zone.floor} • ${zoneKindLabel(zone)}' : zoneKindLabel(zone)),
                if (t != null)
                  TextSpan(
                    text: ' • ${timerSummary(t)}',
                    style: TextStyle(fontWeight: FontWeight.w600, color: timerColor(t), fontFeatures: tabular),
                  ),
              ]),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10, color: AppColors.slate400),
            ),
          ]),
        ),
      ),
      const SizedBox(width: 12),
      StatusBadge(zone.status),
    ]);
  }
}

/// A zone's card. Every status but Available gets a wash of its colour and a
/// matching edge (like the status legend), so the busy ones stand out of the
/// grid. No blurred shadow: dozens of them made scrolling stutter.
BoxDecoration zoneCardDecoration([TableStatus? status]) {
  if (status == null || status == TableStatus.available) {
    return BoxDecoration(
      color: AppColors.card,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(24),
    );
  }
  final c = statusColors[status]!;
  return BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [Color.alphaBlend(c.base.withValues(alpha: 0.14), AppColors.card), AppColors.card],
    ),
    border: Border.all(color: c.dot.withValues(alpha: 0.45)),
    borderRadius: BorderRadius.circular(24),
  );
}

/// Every table and room with its status and open order
/// (src/components/TableDirectoryView.tsx).
class DirectoryView extends StatefulWidget {
  final DashboardState state;
  final int floor;
  final int floorRequest;
  final ValueChanged<int> onSelectFloor;
  final ValueChanged<Zone> onSelectZone;
  const DirectoryView({
    super.key,
    required this.state,
    required this.floor,
    required this.floorRequest,
    required this.onSelectFloor,
    required this.onSelectZone,
  });

  @override
  State<DirectoryView> createState() => _DirectoryViewState();
}

// Chip order. Reserved and Not Available are rare, so their chips appear
// only while a zone has that status.
const _statusChips = [TableStatus.occupied, TableStatus.available, TableStatus.reserved, TableStatus.unavailable];
const _alwaysShown = [TableStatus.occupied, TableStatus.available];

class _DirectoryViewState extends State<DirectoryView> {
  late int? _floor = widget.floor;
  TableStatus? _status;
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  // A floor card tapped in the sidebar switches this view's floor too.
  @override
  void didUpdateWidget(DirectoryView old) {
    super.didUpdateWidget(old);
    if (old.floorRequest != widget.floorRequest) _floor = widget.floor;
  }

  void _selectFloor(int? f) {
    setState(() => _floor = f);
    if (f != null) widget.onSelectFloor(f);
  }

  @override
  Widget build(BuildContext context) {
    final q = _search.text.trim().toLowerCase();
    final inScope = widget.state.zones
        .where((z) => _floor == null || z.floor == _floor)
        .where((z) => q.isEmpty || z.name.toLowerCase().contains(q) || z.code.toLowerCase().contains(q))
        .toList();
    int countOf(TableStatus s) => inScope.where((z) => z.status == s).length;
    final visible = inScope.where((z) => _status == null || z.status == _status).toList()..sort(byZoneName);
    final groups = [
      for (final f in _floor == null ? [1, 2] : [_floor!])
        if (visible.any((z) => z.floor == f)) (f, visible.where((z) => z.floor == f).toList()),
    ];
    final needsTick = visible.any((z) => getRoomTiming(z.activeOrder, DateTime.now(), fallbackRate: z.adminRoomCharge ?? 0) != null);

    return Container(
      decoration: const BoxDecoration(gradient: workspaceGradient),
      child: SafeArea(
        left: false,
        child: NowBuilder(
          enabled: needsTick,
          builder: (context, now) => ListView(padding: const EdgeInsets.all(32), children: [
            PageHeader(
              title: 'All Tables & Rooms',
              subtitle: 'Every table and room with its status and open order. Tap one to start or view its order.',
              trailing: Segmented<int?>(options: floorFilterOptions(), value: _floor, onChanged: _selectFloor),
            ),
            const SizedBox(height: 24),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SizedBox(
                  width: 380,
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    style: const TextStyle(fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'Search tables and rooms…',
                      prefixIcon: const Icon(Icons.search, size: 18, color: AppColors.slate400),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.close, size: 16, color: AppColors.slate400),
                              onPressed: () => setState(_search.clear),
                            ),
                    ),
                  ),
                ),
                _chip('All', inScope.length, _status == null, null, () => setState(() => _status = null)),
                for (final s in _statusChips)
                  if (_alwaysShown.contains(s) || countOf(s) > 0 || _status == s)
                    _chip(statusColors[s]!.label, countOf(s), _status == s, s, () => setState(() => _status = s)),
              ],
            ),
            const SizedBox(height: 24),
            if (groups.isEmpty)
              _noMatches()
            else
              for (final (floor, zones) in groups) ...[
                if (_floor == null) _floorHeading(floor, zones.length),
                CardGrid(children: [for (final z in zones) _card(z, now)]),
                const SizedBox(height: 32),
              ],
          ]),
        ),
      ),
    );
  }

  Widget _chip(String label, int count, bool active, TableStatus? status, VoidCallback onTap) {
    final c = status == null ? null : statusColors[status]!;
    return Material(
      color: active ? (c?.badgeBg ?? const Color(0x26FFFFFF)) : AppColors.subtle,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: active && c != null ? c.base : Colors.transparent),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (c != null) ...[
              Container(width: 6, height: 6, decoration: BoxDecoration(color: c.dot, shape: BoxShape.circle)),
              const SizedBox(width: 6),
            ],
            Text(label,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: active ? (c?.text ?? Colors.white) : AppColors.slate400)),
            const SizedBox(width: 6),
            Text('$count',
                style: TextStyle(
                    fontSize: 12,
                    color: (active ? (c?.text ?? Colors.white) : AppColors.slate400).withValues(alpha: 0.7),
                    fontFeatures: tabular)),
          ]),
        ),
      ),
    );
  }

  Widget _noMatches() => Container(
        padding: const EdgeInsets.all(56),
        decoration: BoxDecoration(
          color: const Color(0x05FFFFFF),
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(children: [
          const Icon(Icons.search_off, size: 40, color: AppColors.slate500),
          const SizedBox(height: 12),
          const Text('No tables or rooms match',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
          const SizedBox(height: 4),
          const Text('Try another search or status, or clear the filters.',
              style: TextStyle(fontSize: 12, color: AppColors.slate400)),
          const SizedBox(height: 16),
          PillButton(
            label: 'Clear filters',
            color: AppColors.subtle,
            borderColor: AppColors.border,
            textColor: AppColors.slate200,
            fontSize: 12,
            onPressed: () => setState(() {
              _search.clear();
              _status = null;
            }),
          ),
        ]),
      );

  Widget _card(Zone z, DateTime now) {
    final order = z.activeOrder;
    final timing = getRoomTiming(order, now, fallbackRate: z.adminRoomCharge ?? 0);
    final action = order != null ? 'View Order' : (z.adminTableId != null ? 'New Order' : 'Details');
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () => widget.onSelectZone(z),
        child: Ink(
          decoration: zoneCardDecoration(z.status),
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            ZoneCardHeader(zone: z, timing: timing),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.only(top: 12),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.border))),
              child: SizedBox(
                height: 22,
                // The total always shows in full; the item count beside it
                // gives way on a narrow card, and on the narrowest the
                // "View Order →" hint goes (the whole card is tappable).
                child: LayoutBuilder(
                  builder: (context, box) => Row(children: [
                  if (order != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.indigo500.withValues(alpha: 0.15),
                        border: Border.all(color: AppColors.indigo500.withValues(alpha: 0.3)),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(peso(order.grandTotal), style: _totalStyle),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(formatItemCount(groupOrderLines(order.items).length),
                          overflow: TextOverflow.ellipsis,
                          softWrap: false,
                          style: const TextStyle(fontSize: 11, color: AppColors.slate400)),
                    ),
                  ] else
                    const Flexible(
                      child: Text('No active order',
                          overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: AppColors.slate500)),
                    ),
                  const Spacer(),
                  if (order == null ||
                      box.maxWidth >=
                          _textWidth(context, peso(order.grandTotal), _totalStyle) +
                              18 + // the pill's padding and border
                              8 +
                              _textWidth(context, '$action →', _actionStyle))
                    Text('$action →', style: _actionStyle),
                  ]),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

const _totalStyle = TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.indigo300, fontFeatures: tabular);
const _actionStyle = TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: AppColors.indigo400);

double _textWidth(BuildContext context, String text, TextStyle style) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: DefaultTextStyle.of(context).style.merge(style)),
    textDirection: TextDirection.ltr,
    textScaler: MediaQuery.textScalerOf(context),
    maxLines: 1,
  )..layout();
  final width = painter.width;
  painter.dispose();
  return width;
}

Widget _floorHeading(int floor, int count) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(children: [
        Text(floorLabels[floor]!, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
        const SizedBox(width: 8),
        Text('$count', style: const TextStyle(fontSize: 12, color: AppColors.slate500, fontFeatures: tabular)),
      ]),
    );

Widget floorHeading(int floor, int count) => _floorHeading(floor, count);
