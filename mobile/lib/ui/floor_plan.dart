import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api/floor_images.dart';
import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/room_timer.dart';
import 'common.dart';
import 'info_panel.dart';

// Every floor plan image shares one 16:9 frame; zone geometry is stored as
// percentages of it (src/components/FloorPlanMap.tsx).
const _aspect = 9 / 16;

class _Bounds {
  final double x0, y0, x1, y1;
  const _Bounds(this.x0, this.y0, this.x1, this.y1);
}

// Where each building sits inside its frame (the rest is transparent margin),
// so the plan is sized to fit the building rather than the whole frame.
const _content = {
  1: _Bounds(4.4, 14.0, 95.4, 84.1),
  2: _Bounds(14.4, 10.6, 85.4, 89.2),
};

// Space kept clear around the building; the top clears the floating bar.
const _padTop = 84.0, _padRight = 16.0, _padBottom = 16.0, _padLeft = 16.0;

const _panelPadX = 3.0;
const _panelPadY = 2.0;

class FloorPlanView extends StatelessWidget {
  final DashboardState state;
  final int floor;
  final ValueChanged<int> onSelectFloor;
  final ValueChanged<Zone> onSelectZone;
  final bool availableFilter;
  final bool occupiedFilter;
  final VoidCallback onToggleAvailable;
  final VoidCallback onToggleOccupied;
  final bool showInfoPanels;

  const FloorPlanView({
    super.key,
    required this.state,
    required this.floor,
    required this.onSelectFloor,
    required this.onSelectZone,
    required this.availableFilter,
    required this.occupiedFilter,
    required this.onToggleAvailable,
    required this.onToggleOccupied,
    required this.showInfoPanels,
  });

  // Only one of the two filters on narrows the plan; neither or both shows all.
  bool get _filterActive => availableFilter != occupiedFilter;

  bool _highlighted(Zone z) {
    if (!_filterActive) return true;
    return availableFilter ? z.status == TableStatus.available : z.status == TableStatus.occupied;
  }

  @override
  Widget build(BuildContext context) {
    final zones = state.zones.where((z) => z.floor == floor).toList();
    // Blue Moon only uses Available and Occupied; Reserved and Not Available
    // (set from restoAdmin) show only while a zone on this floor has them.
    final statusCounts = {
      for (final s in TableStatus.values) s: zones.where((z) => z.status == s).length,
    };
    final shownStatuses = [
      for (final s in TableStatus.values)
        if (s == TableStatus.available || s == TableStatus.occupied || statusCounts[s]! > 0) s,
    ];
    final panels = state.panels.where((p) => p.floor == floor).toList();

    // The building, widened to take in any zone or panel placed outside it.
    var b = _content[floor]!;
    for (final r in [
      ...zones.map((z) => (z.x, z.y, z.width, z.height)),
      ...state.panels.where((p) => p.floor == floor).map((p) => (p.x, p.y, p.width, p.height)),
    ]) {
      b = _Bounds(math.min(b.x0, r.$1), math.min(b.y0, r.$2), math.max(b.x1, r.$1 + r.$3), math.max(b.y1, r.$2 + r.$4));
    }

    // One shared tick for every room countdown and the panels' timers.
    final needsTick = zones.any((z) => z.activeOrder != null) ||
        (showInfoPanels && panels.isNotEmpty && state.zones.any((z) => z.activeOrder != null));

    return Container(
      decoration: const BoxDecoration(gradient: workspaceGradient),
      child: Column(children: [
        Expanded(
          // No clipping here or below: while the sidebar expands, the plan
          // starts at its old, larger size and must be able to reach past the
          // view's new edge, or its right side is cut off mid-animation.
          child: Stack(clipBehavior: Clip.none, children: [
            Positioned.fill(
              child: LayoutBuilder(builder: (context, size) {
                final w = size.maxWidth, h = size.maxHeight - MediaQuery.paddingOf(context).bottom;
                final boundsW = (b.x1 - b.x0) / 100;
                final boundsH = (b.y1 - b.y0) / 100 * _aspect;
                final planW = math.max(
                    0.0, math.min((w - _padLeft - _padRight) / boundsW, (h - _padTop - _padBottom) / boundsH));
                final planH = planW * _aspect;
                final left = w / 2 + (_padLeft - _padRight) / 2 - (b.x0 + b.x1) / 200 * planW;
                final top = h / 2 + (_padTop - _padBottom) / 2 - (b.y0 + b.y1) / 200 * planH;

                return Stack(clipBehavior: Clip.none, children: [
                  // Eases to a new size (sidebar, info panels)
                  // without re-laying it out every frame; a new floor just
                  // appears at its own size.
                  _PlanRect(
                    key: ValueKey(floor),
                    rect: Rect.fromLTWH(left, top, planW, planH),
                    child: NowBuilder(
                      enabled: needsTick,
                      builder: (context, now) => Stack(clipBehavior: Clip.none, children: [
                        // Its own layer: the room timers' tick repaints the
                        // zones every second, not this 2560px image.
                        Positioned.fill(
                          child: RepaintBoundary(
                            child: Image.network(
                              state.api.floorPlanImageUrl(floor),
                              fit: BoxFit.fill,
                              // Shown near its own size, so mipmapped
                              // (medium) filtering only adds GPU work.
                              filterQuality: FilterQuality.low,
                              gaplessPlayback: true,
                              // No connection: the copy saved on this tablet.
                              errorBuilder: (_, _, _) {
                                final saved = FloorImages.cached(floor);
                                return saved == null
                                    ? const SizedBox.shrink()
                                    : Image.file(saved, fit: BoxFit.fill, filterQuality: FilterQuality.low, gaplessPlayback: true);
                              },
                            ),
                          ),
                        ),
                        if (zones.isEmpty)
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: (100 - b.y1) / 100 * planH + 24,
                            child: Center(
                              child: _pill(Icons.info_outline, 'No zones on Floor $floor'),
                            ),
                          ),
                        for (final p in panels)
                          Positioned(
                            key: ValueKey(p.id),
                            left: p.x / 100 * planW,
                            top: p.y / 100 * planH,
                            width: p.width / 100 * planW,
                            height: p.height / 100 * planH,
                            // Stays mounted and fades with the Info Panels
                            // toggle, like the zones with the filters; hidden,
                            // it lets taps through to the plan.
                            child: IgnorePointer(
                              ignoring: !showInfoPanels,
                              child: AnimatedOpacity(
                                duration: const Duration(milliseconds: 300),
                                curve: Curves.easeOut,
                                opacity: showInfoPanels ? 1 : 0,
                                // Opaque, so the plan's lines never show through
                                // the text, with a crisp edge. No blurred shadow
                                // or clip: on the tablets those cost ~3ms a
                                // frame, enough to stutter animations.
                                child: Container(
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(
                                      begin: Alignment.topCenter,
                                      end: Alignment.bottomCenter,
                                      colors: [Color(0xFF1B1E36), Color(0xFF14162A)],
                                    ),
                                    border: Border.all(color: const Color(0x2EFFFFFF)),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: InfoPanelView(
                                    panel: p,
                                    state: state,
                                    now: now,
                                    widthPx: p.width / 100 * planW,
                                    heightPx: p.height / 100 * planH,
                                    onSelectZone: onSelectZone,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        for (final z in zones)
                          Positioned(
                            left: z.x / 100 * planW,
                            top: z.y / 100 * planH,
                            width: z.width / 100 * planW,
                            height: z.height / 100 * planH,
                            child: _ZoneTile(
                              zone: z,
                              now: now,
                              widthPx: z.width / 100 * planW,
                              heightPx: z.height / 100 * planH,
                              highlighted: _highlighted(z),
                              onTap: () => onSelectZone(z),
                            ),
                          ),
                      ]),
                    ),
                  ),
                ]);
              }),
            ),
            // Floating top bar: floor switch + filter badge on the left, the
            // floor's status counts on the right. Info Panels lives in the
            // sidebar.
            Positioned(
              top: 20,
              left: 20,
              right: 20,
              child: SafeArea(
                bottom: false,
                left: false,
                // On a narrow view the status counts drop their labels (dot +
                // count, label in a tooltip), so they never crowd the floor
                // switch.
                child: LayoutBuilder(builder: (context, box) {
                  final compact = box.maxWidth < 760;
                  return Row(children: [
                    _bar(Row(mainAxisSize: MainAxisSize.min, children: [
                      for (final f in [1, 2])
                        _barButton(
                          label: floorLabels[f]!,
                          active: floor == f,
                          onTap: () => onSelectFloor(f),
                        ),
                    ])),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: AnimatedOpacity(
                          opacity: _filterActive ? 1 : 0,
                          duration: const Duration(milliseconds: 300),
                          child: _filterBadge(availableFilter ? 'Available' : 'Occupied'),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Flexible(
                      flex: 0,
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerRight,
                        child: _bar(Row(mainAxisSize: MainAxisSize.min, children: [
                          for (var i = 0; i < shownStatuses.length; i++) ...[
                            if (i > 0) const SizedBox(width: 6),
                            _statusCount(shownStatuses[i], statusCounts[shownStatuses[i]]!, compact),
                          ],
                        ])),
                      ),
                    ),
                  ]);
                }),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  // One status's count for the floor shown, tinted like its zones on the map.
  // Available and Occupied are also the floor plan's two filters, the same
  // ones as the sidebar's tiles (so the two always agree): tapping one turns
  // it on, filled like its tile. Reserved and Not Available have no filter.
  Widget _statusCount(TableStatus status, int count, bool compact) {
    final c = statusColors[status]!;
    final (bool on, VoidCallback? onTap, List<Color> onColors) = switch (status) {
      TableStatus.available => (availableFilter, onToggleAvailable, const [AppColors.emerald600, AppColors.teal600]),
      TableStatus.occupied => (occupiedFilter, onToggleOccupied, const [AppColors.amber500, AppColors.orange500]),
      _ => (false, null, const <Color>[]),
    };
    return Tooltip(
      message: onTap == null
          ? '${c.label}: $count'
          : '${c.label}: $count${on ? ' (showing only these; tap to show all)' : ' (tap to show only these)'}',
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            gradient: on ? LinearGradient(colors: onColors) : null,
            color: on ? null : c.base.withValues(alpha: 0.12),
            border: Border.all(color: on ? Colors.transparent : c.dot.withValues(alpha: 0.4)),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: on ? Colors.white : c.dot,
                shape: BoxShape.circle,
                boxShadow: on ? null : [BoxShadow(color: c.glow, blurRadius: 6)],
              ),
            ),
            if (!compact) ...[
              const SizedBox(width: 8),
              Text(c.label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: on ? Colors.white : c.text)),
            ],
            const SizedBox(width: 8),
            Text('$count',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
          ]),
        ),
      ),
    );
  }

  Widget _pill(IconData icon, String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xE61E1B4B),
          border: Border.all(color: AppColors.indigo400.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: AppColors.indigo400),
          const SizedBox(width: 8),
          Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFFC7D2FE))),
        ]),
      );

  Widget _bar(Widget child) => Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: const Color(0xE6141628),
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(16),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 16)],
        ),
        child: child,
      );

  Widget _filterBadge(String label) => Container(
        height: 46,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: AppColors.indigo500.withValues(alpha: 0.2),
          border: Border.all(color: AppColors.indigo500.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.info_outline, size: 16, color: Color(0xFFC7D2FE)),
          const SizedBox(width: 8),
          Flexible(
            child: Text('Filtering: $label Only',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFFC7D2FE))),
          ),
        ]),
      );

  Widget _barButton({required String label, required bool active, required VoidCallback onTap}) {
    return Material(
      color: active ? AppColors.indigo600 : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          alignment: Alignment.center,
          child: Text(label,
              style: TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w700, color: active ? Colors.white : AppColors.slate400)),
        ),
      ),
    );
  }
}

/// Places the plan at [rect], easing in from wherever it was. The plan is
/// laid out once at its new size, then drawn through a scale-and-move
/// transform from the old rect to the new one, so the animation only repaints:
/// re-laying out 36 zones and the info panels every frame stuttered on the
/// tablets. The zone labels are already laid out for the new size, so nothing
/// jumps when it settles.
class _PlanRect extends StatelessWidget {
  final Rect rect;
  final Widget child;
  const _PlanRect({super.key, required this.rect, required this.child});

  // Matches the sidebar's collapse, the usual reason the plan resizes.
  static const _duration = Duration(milliseconds: 300);

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<Rect?>(
      tween: RectTween(end: rect),
      duration: _duration,
      curve: Curves.easeOut,
      child: child,
      builder: (context, current, child) {
        final r = current ?? rect;
        final scale = r.width / rect.width;
        return Positioned.fromRect(
          rect: rect,
          child: Transform(
            transform: Matrix4.diagonal3Values(scale, scale, 1)..setTranslationRaw(r.left - rect.left, r.top - rect.top, 0),
            child: child,
          ),
        );
      },
    );
  }
}

/// Which lines a zone's label shows, from its on-screen size: name, room
/// timer, item count, order total, then items with "+N more". The name and
/// an hourly room's timer are never dropped.
class _LabelLayout {
  final double inset, fontSize, lineHeight, maxWidth;
  final List<String> timerLines;
  final bool showItemCount, showTotal;
  final int itemLinesShown;
  const _LabelLayout(this.inset, this.fontSize, this.lineHeight, this.maxWidth, this.timerLines, this.showItemCount,
      this.showTotal, this.itemLinesShown);
}

double _estimateEm(String text) {
  var em = 0.0;
  for (final ch in text.split('')) {
    em += RegExp(r'[0-9]').hasMatch(ch)
        ? 0.56
        : RegExp(r'[:.· ]').hasMatch(ch)
            ? 0.3
            : 0.62;
  }
  return em;
}

_LabelLayout _labelLayout(double w, double h, RoomTiming? timing, bool hasOrder, int itemLines) {
  final minSide = math.min(w, h);
  final inset = minSide < 60 ? 4.0 : 7.0;
  final font = (minSide * 0.12).roundToDouble().clamp(9.0, 13.0);
  final lineH = (font * 1.3).roundToDouble();
  final innerW = w - 2 * inset - 2 * _panelPadX;
  final innerH = h - 2 * inset - 2 * _panelPadY;

  var timerLines = <String>[];
  if (timing != null) {
    final time = formatDuration(timing.remaining);
    final candidates = timing.expired
        ? [
            ['EXPIRED +$time'],
            ['EXP +$time'],
            ['EXPIRED', '+$time'],
          ]
        : [
            ['${formatHours(timing.hours)} · $time left'],
            ['$time left'],
            [time],
          ];
    timerLines = candidates.firstWhere((lines) => lines.every((l) => _estimateEm(l) * font <= innerW),
        orElse: () => candidates.last);
  }

  var spare = (innerH / lineH).floor() - 1 - timerLines.length;
  bool take(bool wanted) {
    if (!wanted || spare <= 0) return false;
    spare--;
    return true;
  }

  final showCount = take(itemLines > 0);
  final showTotal = take(hasOrder);
  var shown = 0;
  if (showCount && spare > 0) {
    if (itemLines <= spare) {
      shown = itemLines;
    } else if (spare >= 2) {
      shown = spare - 1;
    }
  }
  return _LabelLayout(inset, font, lineH, math.max(0, innerW), timerLines, showCount, showTotal, shown);
}

const _greyscale = ColorFilter.matrix([
  0.2126, 0.7152, 0.0722, 0, 0, //
  0.2126, 0.7152, 0.0722, 0, 0, //
  0.2126, 0.7152, 0.0722, 0, 0, //
  0, 0, 0, 1, 0,
]);

class _ZoneTile extends StatelessWidget {
  final Zone zone;
  final DateTime now;
  final double widthPx, heightPx;
  final bool highlighted;
  final VoidCallback onTap;

  const _ZoneTile({
    required this.zone,
    required this.now,
    required this.widthPx,
    required this.heightPx,
    required this.highlighted,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = statusColors[zone.status]!;
    final order = zone.activeOrder;
    final timing = getRoomTiming(order, now, fallbackRate: zone.adminRoomCharge ?? 0);
    final groups = groupOrderLines(order?.items ?? const []);
    final itemCount = order?.items.fold<double>(0, (s, i) => s + i.quantity) ?? 0;
    final l = _labelLayout(widthPx, heightPx, timing, order != null, groups.length);
    final lineStyle = TextStyle(fontSize: l.fontSize, height: l.lineHeight / l.fontSize, color: const Color(0xF2FFFFFF));

    Widget line(String text, {Color? color, FontWeight? weight}) => ConstrainedBox(
          constraints: BoxConstraints(maxWidth: l.maxWidth),
          child: Text(text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              style: lineStyle.copyWith(color: color, fontWeight: weight, fontFeatures: tabular)),
        );

    final tile = GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: colors.fill,
          border: Border.all(color: colors.border, width: 2),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Stack(children: [
          Positioned(
            top: l.inset - 2,
            left: l.inset - 2,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: _panelPadX, vertical: _panelPadY),
              decoration: BoxDecoration(color: const Color(0xA6000000), borderRadius: BorderRadius.circular(6)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                line(zone.name, weight: FontWeight.w700),
                for (final t in l.timerLines) line(t, color: timerColor(timing!), weight: FontWeight.w700),
                if (l.showItemCount)
                  line('${formatQty(itemCount)} ${itemCount == 1 ? 'item' : 'items'}', color: AppColors.slate400),
                for (final g in groups.take(l.itemLinesShown)) line('${formatQty(g.quantity)}× ${g.name}'),
                if (l.itemLinesShown > 0 && groups.length > l.itemLinesShown)
                  line('+${groups.length - l.itemLinesShown} more', color: AppColors.slate400),
                if (order != null && l.showTotal) line(peso(order.grandTotal), weight: FontWeight.w700),
              ]),
            ),
          ),
          // Saved on this tablet, not in restoAdmin yet.
          if (zone.unsynced)
            Positioned(
              top: l.inset - 2,
              right: l.inset - 2,
              child: Container(
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(color: const Color(0xA6000000), borderRadius: BorderRadius.circular(6)),
                child: Icon(Icons.cloud_off, size: l.fontSize + 2, color: AppColors.indigo300),
              ),
            ),
        ]),
      ),
    );

    // Dimmed and greyed out (and not tappable) when a filter excludes it.
    return IgnorePointer(
      ignoring: !highlighted,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 300),
        opacity: highlighted ? 1 : 0.2,
        child: highlighted ? tile : ColorFiltered(colorFilter: _greyscale, child: tile),
      ),
    );
  }
}
