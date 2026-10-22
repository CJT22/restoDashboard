import 'package:flutter/material.dart';

import '../api/live_stream.dart';
import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../state/offline_queue.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/room_timer.dart';
import 'common.dart';
import 'shell.dart';

class _Badge {
  final String label;
  final String detail;
  final IconData icon;
  final Color color;
  const _Badge(this.label, this.detail, this.icon, this.color);
}

const _badges = {
  ConnectionStatus.connecting:
      _Badge('Connecting…', 'Connecting to the live sync server', Icons.wifi, AppColors.slate400),
  ConnectionStatus.live: _Badge('Live', 'Receiving live updates from restoAdmin', Icons.wifi, AppColors.emerald400),
  ConnectionStatus.adminOffline: _Badge(
      'restoAdmin offline',
      "The sync server can't reach restoAdmin, so live updates are paused. Retrying automatically.",
      Icons.warning_amber_rounded,
      AppColors.amber400),
  ConnectionStatus.offline: _Badge(
      'Offline',
      "Can't reach the dashboard's sync server, so live updates are paused. Retrying automatically.",
      Icons.wifi_off,
      AppColors.rose400),
};

/// The left sidebar (src/components/Sidebar.tsx): clock, live connection,
/// navigation, the floor plan's view toggles (two quick filters
/// and Info Panels), rooms that need attention, and both floors at a glance.
/// Collapses to a 64px icon rail.
class Sidebar extends StatefulWidget {
  final DashboardState state;
  final DashboardUser user;
  final bool collapsed;
  final VoidCallback onToggleCollapsed;
  final NavTab nav;
  final ValueChanged<NavTab> onSelectNav;
  final int floor;
  final ValueChanged<int> onSelectFloor;
  final bool availableFilter;
  final VoidCallback onToggleAvailable;
  final bool occupiedFilter;
  final VoidCallback onToggleOccupied;
  final bool showInfoPanels;
  final VoidCallback onToggleInfoPanels;
  final ValueChanged<Zone> onSelectZone;
  final VoidCallback onSignOut;

  const Sidebar({
    super.key,
    required this.state,
    required this.user,
    required this.collapsed,
    required this.onToggleCollapsed,
    required this.nav,
    required this.onSelectNav,
    required this.floor,
    required this.onSelectFloor,
    required this.availableFilter,
    required this.onToggleAvailable,
    required this.occupiedFilter,
    required this.onToggleOccupied,
    required this.showInfoPanels,
    required this.onToggleInfoPanels,
    required this.onSelectZone,
    required this.onSignOut,
  });

  @override
  State<Sidebar> createState() => _SidebarState();
}

const sidebarExpandedWidth = 320.0;
const sidebarCollapsedWidth = 64.0;
const sidebarAnimation = Duration(milliseconds: 300);

class _SidebarState extends State<Sidebar> with SingleTickerProviderStateMixin {
  late final _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
  bool _refreshing = false;
  bool _refreshFailed = false;

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  // Really reloads from restoAdmin; spins at least one turn, and turns red
  // for a few seconds if it failed.
  Future<void> _refresh() async {
    if (_refreshing) return;
    setState(() {
      _refreshing = true;
      _refreshFailed = false;
    });
    _spin.repeat();
    var failed = false;
    await Future.wait([
      widget.state.resync().catchError((_) => failed = true),
      Future.delayed(const Duration(milliseconds: 700)),
    ]);
    if (!mounted) return;
    await _spin.forward(from: _spin.value);
    _spin.reset();
    setState(() {
      _refreshing = false;
      _refreshFailed = failed;
    });
    if (failed) {
      Future.delayed(const Duration(seconds: 4), () {
        if (mounted) setState(() => _refreshFailed = false);
      });
    }
  }

  Widget _refreshIcon(double size) => RotationTransition(
        turns: _spin,
        child: Icon(Icons.refresh,
            size: size,
            color: _refreshing
                ? AppColors.indigo400
                : _refreshFailed
                    ? AppColors.rose400
                    : AppColors.slate300),
      );

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: sidebarAnimation,
      curve: Curves.easeOut,
      width: widget.collapsed ? sidebarCollapsedWidth : sidebarExpandedWidth,
      decoration: const BoxDecoration(
        color: AppColors.sidebar,
        border: Border(right: BorderSide(color: AppColors.border)),
      ),
      clipBehavior: Clip.hardEdge,
      child: SafeArea(
        right: false,
        child: NowBuilder(
          builder: (context, now) => AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            child: widget.collapsed
                ? KeyedSubtree(key: const ValueKey('rail'), child: _rail(now))
                : OverflowBox(
                    key: const ValueKey('full'),
                    alignment: Alignment.topLeft,
                    minWidth: sidebarExpandedWidth - 1,
                    maxWidth: sidebarExpandedWidth - 1,
                    child: _full(now),
                  ),
          ),
        ),
      ),
    );
  }

  List<(Zone, RoomTiming)> _attentionRooms(DateTime now) {
    final rows = <(Zone, RoomTiming)>[];
    for (final z in widget.state.zones) {
      final t = getRoomTiming(z.activeOrder, now, fallbackRate: z.adminRoomCharge ?? 0);
      if (t != null && timerTone(t) != TimerTone.normal) rows.add((z, t));
    }
    rows.sort((a, b) => a.$2.remaining.compareTo(b.$2.remaining));
    return rows;
  }

  int get _activeOrdersCount => widget.state.zones.where((z) => z.hasActiveOrder).length;

  String? _syncedAgo(DateTime now) {
    final at = widget.state.lastSyncedAt;
    if (at == null) return null;
    final ago = formatWait(now.difference(at));
    return ago == 'just now' ? 'synced just now' : 'synced $ago ago';
  }

  // The filters and Info Panels only change the floor plan, so elsewhere they
  // fade out and stop taking taps.
  bool get _onFloorPlan => widget.nav == NavTab.floorplan;

  Widget _floorPlanOnly(Widget child) => IgnorePointer(
        ignoring: !_onFloorPlan,
        child: AnimatedOpacity(
          opacity: _onFloorPlan ? 1 : 0.35,
          duration: const Duration(milliseconds: 200),
          child: child,
        ),
      );

  // ---------------------------------------------------------------- full --

  Widget _full(DateTime now) {
    final state = widget.state;
    final badge = _badges[state.connection]!;
    final attention = _attentionRooms(now);
    final hasExpired = attention.any((r) => r.$2.expired);
    final syncedAgo = _syncedAgo(now);

    return CustomScrollView(slivers: [
      SliverToBoxAdapter(
        child: Container(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.subtle))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('BLUE MOON',
                      style:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 1, color: Colors.white)),
                  Text(widget.user.displayName.toUpperCase(),
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 10, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: AppColors.slate500)),
                ]),
              ),
              // Sign out stands apart from Collapse, behind a divider, so a
              // missed tap on Collapse doesn't land on it.
              SquareIconButton(
                icon: Icons.logout,
                iconSize: 17,
                background: Colors.transparent,
                tooltip: 'Sign out ${widget.user.displayName}',
                onPressed: widget.onSignOut,
              ),
              Container(width: 1, height: 20, margin: const EdgeInsets.symmetric(horizontal: 6), color: AppColors.border),
              SquareIconButton(
                icon: Icons.keyboard_double_arrow_left,
                iconSize: 18,
                background: Colors.transparent,
                tooltip: 'Collapse sidebar',
                onPressed: widget.onToggleCollapsed,
              ),
            ]),
            const SizedBox(height: 8),
            Text(formatClockTimeWithSeconds(now),
                style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    fontFamily: 'monospace',
                    fontFeatures: tabular)),
            const SizedBox(height: 2),
            // "TUESDAY, OCTOBER 13, 2026": the year dimmer, so the day still
            // reads first.
            Text.rich(
                TextSpan(text: formatLongDate(now), children: [
                  TextSpan(text: ', ${now.year}', style: const TextStyle(color: AppColors.slate500)),
                ]),
                style: const TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: AppColors.slate400)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: Tooltip(
                  message: badge.detail,
                  child: Container(
                    height: 38,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(
                      color: AppColors.input,
                      border: Border.all(color: AppColors.border),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(children: [
                      Icon(badge.icon, size: 16, color: badge.color),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(badge.label,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate200)),
                      ),
                      if (syncedAgo != null)
                        Text(syncedAgo, style: const TextStyle(fontSize: 10, color: AppColors.slate500)),
                      const SizedBox(width: 8),
                      _Dot(color: badge.color, pulse: state.connection == ConnectionStatus.live),
                    ]),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Tooltip(
                message: _refreshFailed ? 'Refresh failed, try again' : 'Reload all statuses & orders from restoAdmin',
                child: Material(
                  color: AppColors.input,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12), side: const BorderSide(color: AppColors.border)),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: _refresh,
                    child: SizedBox(width: 38, height: 38, child: Center(child: _refreshIcon(17))),
                  ),
                ),
              ),
            ]),
            if (!state.offline.isEmpty) ...[const SizedBox(height: 10), _unsyncedCard()],
          ]),
        ),
      ),
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 10, 24, 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const _SectionTitle('NAVIGATION'),
            const SizedBox(height: 6),
            _navItem(NavTab.floorplan, Icons.grid_view_rounded, 'Floor Plan', AppColors.indigo400),
            const SizedBox(height: 4),
            _navItem(NavTab.directory, Icons.layers_outlined, 'All Tables & Rooms', AppColors.indigo400,
                trailing: _countPill('${state.zones.length}', AppColors.slate300, const Color(0x1AFFFFFF))),
            const SizedBox(height: 4),
            _navItem(
              NavTab.orders,
              Icons.restaurant_menu,
              'Active Orders',
              AppColors.amber400,
              trailing: _activeOrdersCount > 0
                  ? _countPill('$_activeOrdersCount', AppColors.amber300, AppColors.amber500.withValues(alpha: 0.2),
                      border: AppColors.amber500.withValues(alpha: 0.3))
                  : _countPill('None', AppColors.emerald300, AppColors.emerald500.withValues(alpha: 0.2),
                      border: AppColors.emerald500.withValues(alpha: 0.3)),
            ),
          ]),
        ),
      ),
      SliverToBoxAdapter(
        child: Container(
          padding: const EdgeInsets.fromLTRB(24, 10, 24, 12),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.subtle))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: _SectionTitle('FLOOR PLAN VIEW')),
              if (!_onFloorPlan)
                const Text('Floor Plan only', style: TextStyle(fontSize: 10, color: AppColors.slate500))
              else
                AnimatedOpacity(
                  opacity: widget.availableFilter || widget.occupiedFilter ? 1 : 0,
                  duration: const Duration(milliseconds: 300),
                  child: const Text('Filter active', style: TextStyle(fontSize: 10, color: AppColors.indigo400)),
                ),
            ]),
            const SizedBox(height: 10),
            _floorPlanOnly(Row(children: [
              Expanded(
                child: _ViewTile(
                  on: widget.availableFilter,
                  onTap: widget.onToggleAvailable,
                  icon: Icons.check,
                  label: 'Available',
                  tooltip: widget.availableFilter ? 'Showing available tables' : 'Tap to show available',
                  colors: const [AppColors.emerald600, AppColors.teal600],
                  idleColor: AppColors.emerald400,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ViewTile(
                  on: widget.occupiedFilter,
                  onTap: widget.onToggleOccupied,
                  icon: Icons.people_alt_outlined,
                  label: 'Occupied',
                  tooltip: widget.occupiedFilter ? 'Showing occupied tables' : 'Tap to show occupied',
                  colors: const [AppColors.amber500, AppColors.orange500],
                  idleColor: AppColors.amber400,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ViewTile(
                  on: widget.showInfoPanels,
                  onTap: widget.onToggleInfoPanels,
                  icon: Icons.info_outline_rounded,
                  label: 'Info Panels',
                  tooltip: widget.showInfoPanels ? 'Hide info panels' : 'Show info panels',
                  colors: const [AppColors.indigo600, Color(0xFF7C3AED)],
                  idleColor: AppColors.indigo400,
                ),
              ),
            ])),
          ]),
        ),
      ),
      SliverFillRemaining(
        hasScrollBody: false,
        child: Column(children: [
          Expanded(
            child: Container(
              // Grows with the list of rooms (the sidebar scrolls if they
              // outgrow the screen); only the empty state stays this small.
              constraints: const BoxConstraints(minHeight: 80),
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.subtle))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  const Expanded(child: _SectionTitle('NEEDS ATTENTION')),
                  if (attention.isNotEmpty)
                    _countPill(
                      '${attention.length}',
                      hasExpired ? AppColors.rose300 : AppColors.yellow300,
                      (hasExpired ? AppColors.rose500 : AppColors.yellow400).withValues(alpha: 0.18),
                      border: (hasExpired ? AppColors.rose500 : AppColors.yellow400).withValues(alpha: 0.3),
                    ),
                ]),
                const SizedBox(height: 8),
                if (attention.isEmpty)
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Tooltip(
                        message: 'Expired rooms and ones ending within 15 minutes show here.',
                        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          Icon(Icons.check_circle_outline, size: 18, color: AppColors.emerald400),
                          SizedBox(width: 8),
                          Text('All rooms on time',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate300)),
                        ]),
                      ),
                    ),
                  )
                else
                  for (final (zone, timing) in attention)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Material(
                        color: AppColors.faint,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12), side: const BorderSide(color: AppColors.subtle)),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () => widget.onSelectZone(zone),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                            child: Row(children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration:
                                    BoxDecoration(color: AppColors.subtle, borderRadius: BorderRadius.circular(4)),
                                child: Text('${zone.floor}F',
                                    style: const TextStyle(
                                        fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.slate400)),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(zone.name,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate200)),
                              ),
                              Text(
                                timing.expired
                                    ? '+${formatDuration(timing.remaining)}'
                                    : '${formatDuration(timing.remaining)} left',
                                style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: timerColor(timing),
                                    fontFeatures: tabular),
                              ),
                            ]),
                          ),
                        ),
                      ),
                    ),
              ]),
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 12),
            decoration: const BoxDecoration(
              color: Color(0xFF0E0F1A),
              border: Border(top: BorderSide(color: AppColors.subtle)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('FLOORS',
                  style: TextStyle(
                      fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.slate500)),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: _floorCard(1)),
                const SizedBox(width: 8),
                Expanded(child: _floorCard(2)),
              ]),
            ]),
          ),
        ]),
      ),
    ]);
  }

  Widget _navItem(NavTab tab, IconData icon, String label, Color activeIconColor, {Widget? trailing}) {
    final active = widget.nav == tab;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => widget.onSelectNav(tab),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          decoration: BoxDecoration(
            gradient: active ? const LinearGradient(colors: [Color(0x1FFFFFFF), Color(0x0AFFFFFF)]) : null,
            border: Border.all(color: active ? AppColors.borderStrong : Colors.transparent),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(children: [
            Icon(icon, size: 20, color: active ? activeIconColor : AppColors.slate400),
            const SizedBox(width: 12),
            Expanded(
              child: Text(label,
                  style: TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w600, color: active ? Colors.white : AppColors.slate400)),
            ),
            ?trailing,
          ]),
        ),
      ),
    );
  }

  Widget _countPill(String text, Color color, Color bg, {Color? border}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: bg,
          border: border == null ? null : Border.all(color: border),
          borderRadius: BorderRadius.circular(99),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color, fontFeatures: tabular)),
      );

  Widget _floorCard(int floor) {
    final onFloor = widget.state.zones.where((z) => z.floor == floor).toList();
    final total = onFloor.length;
    final available = onFloor.where((z) => z.status == TableStatus.available).length;
    final occupied = onFloor.where((z) => z.status == TableStatus.occupied).length;
    final current = floor == widget.floor;
    return Material(
      color: current ? AppColors.indigo500.withValues(alpha: 0.1) : AppColors.faint,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: current ? AppColors.indigo400.withValues(alpha: 0.4) : AppColors.subtle),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => widget.onSelectFloor(floor),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text.rich(
                  TextSpan(children: [
                    TextSpan(text: floorLabels[floor]!.toUpperCase()),
                    TextSpan(
                        text: ' / $total',
                        style: const TextStyle(color: AppColors.slate500, fontWeight: FontWeight.w400, letterSpacing: 0)),
                  ]),
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.6,
                      color: current ? AppColors.indigo300 : AppColors.slate400),
                ),
              ),
              if (current)
                Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(color: AppColors.indigo400, shape: BoxShape.circle)),
            ]),
            const SizedBox(height: 4),
            Row(children: [
              const _Dot(color: AppColors.emerald400),
              const SizedBox(width: 6),
              Text('$available',
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.emerald400, fontFeatures: tabular)),
              const SizedBox(width: 12),
              const _Dot(color: AppColors.amber400),
              const SizedBox(width: 6),
              Text('$occupied',
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.amber400, fontFeatures: tabular)),
            ]),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: total > 0 ? occupied / total : 0,
                minHeight: 4,
                backgroundColor: AppColors.border,
                color: AppColors.amber400,
              ),
            ),
          ]),
        ),
      ),
    );
  }

  // Order changes saved on this tablet (state/offline_queue.dart), oldest
  // first: what each is, and Retry/Discard for one restoAdmin refused. The
  // rest need no button: they're sent as soon as the connection is back.
  Widget _unsyncedCard() {
    final state = widget.state;
    final actions = state.offline.actions;
    final count = actions.length;
    final title = state.syncing
        ? 'Sending $count saved change${count == 1 ? '' : 's'}…'
        : '$count change${count == 1 ? '' : 's'} saved on this tablet';

    String describe(OfflineAction a) {
      final units = a.items.fold<int>(0, (s, i) => s + i.qty);
      return switch (a.type) {
        OfflineActionType.createOrder => 'New order · ${units == 1 ? '1 item' : '$units items'}'
            '${(a.roomChargeQty ?? 1) > 1 ? ' · ${formatQty(a.roomChargeQty!)}h room' : ''}',
        OfflineActionType.addItems => '+${units == 1 ? '1 item' : '$units items'}',
        OfflineActionType.roomCharge => 'Room hours: ${formatQty(a.roomChargeQty ?? 1)}h',
      };
    }

    Widget smallButton(String label, VoidCallback? onTap, {Color color = AppColors.indigo300}) => InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Text(label,
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: onTap == null ? AppColors.slate500 : color)),
          ),
        );

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
      decoration: BoxDecoration(
        color: AppColors.indigo500.withValues(alpha: 0.1),
        border: Border.all(color: AppColors.indigo500.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          state.syncing
              ? const SizedBox(
                  width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.indigo300))
              : const Icon(Icons.cloud_off, size: 15, color: AppColors.indigo300),
          const SizedBox(width: 8),
          Expanded(
            child: Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate200)),
          ),
        ]),
        Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 4, right: 6),
          child: Text(
              state.online
                  ? 'Sending them to restoAdmin.'
                  : 'They go to restoAdmin by themselves when the connection is back.',
              style: const TextStyle(fontSize: 10, color: AppColors.slate400)),
        ),
        for (final a in actions)
          Padding(
            padding: const EdgeInsets.only(top: 4, right: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(
                TextSpan(children: [
                  TextSpan(
                      text: '${state.zoneForAction(a)?.name ?? 'Table'}  ',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white)),
                  TextSpan(text: describe(a)),
                ]),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: AppColors.slate300),
              ),
              if (a.failed) ...[
                Text(a.error!, style: const TextStyle(fontSize: 10, color: AppColors.rose300)),
                Row(children: [
                  smallButton('Retry', state.syncing ? null : () => state.retry(a)),
                  smallButton('Discard', state.syncing ? null : () => _confirmDiscard(a), color: AppColors.rose300),
                ]),
              ],
            ]),
          ),
      ]),
    );
  }

  Future<void> _confirmDiscard(OfflineAction a) async {
    final zone = widget.state.zoneForAction(a);
    final confirmed = await confirmDialog(
      context,
      title: 'Discard this change?',
      description: '${zone?.name ?? 'This table'}: it was saved on this tablet but never reached restoAdmin. '
          'Discarding it can\'t be undone.',
      confirmText: 'Discard',
      confirmIcon: Icons.delete_outline,
      icon: Icons.cloud_off,
    );
    if (confirmed) widget.state.discard(a);
  }

  // ---------------------------------------------------------------- rail --

  Widget _rail(DateTime now) {
    final state = widget.state;
    final badge = _badges[state.connection]!;
    final attention = _attentionRooms(now);
    final hasExpired = attention.any((r) => r.$2.expired);
    final time = formatClockTime(now).split(' ');
    final syncedAgo = _syncedAgo(now);

    return SizedBox(
      width: 64,
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: MediaQuery.of(context).size.height - 28 - MediaQuery.of(context).padding.vertical),
          child: IntrinsicHeight(
            child: Column(children: [
              _railButton(Icons.keyboard_double_arrow_right, 'Expand sidebar', widget.onToggleCollapsed),
              // Snug under Expand: its 44px tap target is mostly empty below
              // the icon, which otherwise leaves the clock adrift.
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Column(children: [
                  Text(time[0],
                      style: const TextStyle(
                          fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
                  Text(time.length > 1 ? time[1] : '',
                      style: const TextStyle(
                          fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: AppColors.slate500)),
                ]),
              ),
              Tooltip(
                message: '${badge.label}${syncedAgo == null ? '' : ' · $syncedAgo'}\n${badge.detail}',
                child: Stack(children: [
                  Material(
                    color: AppColors.input,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12), side: const BorderSide(color: AppColors.border)),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: _refresh,
                      child: SizedBox(width: 44, height: 44, child: Center(child: _refreshIcon(16))),
                    ),
                  ),
                  Positioned(top: 6, right: 6, child: _Dot(color: badge.color)),
                ]),
              ),
              // Saved changes: opens the sidebar on their list.
              if (!state.offline.isEmpty)
                Tooltip(
                  message: '${state.offline.actions.length} change${state.offline.actions.length == 1 ? '' : 's'} '
                      'saved on this tablet',
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: widget.onToggleCollapsed,
                    child: SizedBox(
                      width: 44,
                      height: 30,
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Icon(Icons.cloud_off,
                            size: 15, color: state.offline.failedCount > 0 ? AppColors.rose400 : AppColors.indigo300),
                        const SizedBox(width: 3),
                        Text('${state.offline.actions.length}',
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.indigo300)),
                      ]),
                    ),
                  ),
                ),
              const _RailDivider(),
              _railNav(NavTab.floorplan, Icons.grid_view_rounded, 'Floor Plan', AppColors.indigo400),
              _railNav(NavTab.directory, Icons.layers_outlined, 'All Tables & Rooms (${state.zones.length})',
                  AppColors.indigo400,
                  count: '${state.zones.length}', countColor: AppColors.slate300, countBg: const Color(0xFF2A2C40)),
              _railNav(
                NavTab.orders,
                Icons.restaurant_menu,
                _activeOrdersCount > 0 ? 'Active Orders ($_activeOrdersCount)' : 'Active Orders (none)',
                AppColors.amber400,
                count: _activeOrdersCount > 0 ? '$_activeOrdersCount' : null,
                countColor: AppColors.amber300,
                countBg: const Color(0xFF3A2A12),
              ),
              const _RailDivider(),
              _floorPlanOnly(Column(children: [
                _railFilter(widget.availableFilter, widget.onToggleAvailable, Icons.check, 'Available Zones',
                    const [AppColors.emerald600, AppColors.teal600], AppColors.emerald400),
                _railFilter(widget.occupiedFilter, widget.onToggleOccupied, Icons.people_alt_outlined,
                    'Occupied Zones', const [AppColors.amber500, AppColors.orange500], AppColors.amber400),
                _railFilter(widget.showInfoPanels, widget.onToggleInfoPanels, Icons.info_outline_rounded, 'Info Panels',
                    const [AppColors.indigo600, Color(0xFF7C3AED)], AppColors.indigo400),
              ])),
              const _RailDivider(),
              Tooltip(
                message: attention.isEmpty
                    ? 'All rooms on time'
                    : 'Needs attention: ${attention.length} ${attention.length == 1 ? 'room' : 'rooms'} expired or ending soon',
                child: _railShell(
                  onTap: widget.onToggleCollapsed,
                  child: attention.isEmpty
                      ? Icon(Icons.check_circle_outline, size: 20, color: AppColors.emerald400.withValues(alpha: 0.7))
                      : Icon(Icons.schedule, size: 20, color: hasExpired ? AppColors.rose400 : AppColors.yellow300),
                  count: attention.isEmpty ? null : '${attention.length}',
                  countColor: hasExpired ? AppColors.rose300 : AppColors.yellow300,
                  countBg: hasExpired ? const Color(0xFF3A1A24) : const Color(0xFF33300F),
                ),
              ),
              const Spacer(),
              const _RailDivider(),
              _railButton(Icons.logout, 'Sign out ${widget.user.displayName}', widget.onSignOut),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _railShell({
    required Widget child,
    required VoidCallback onTap,
    String? count,
    Color countColor = AppColors.slate300,
    Color countBg = const Color(0xFF2A2C40),
    Gradient? gradient,
    Color? background,
    bool bordered = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Stack(clipBehavior: Clip.none, children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            gradient: gradient,
            color: gradient == null ? background : null,
            border: Border.all(color: bordered ? AppColors.borderStrong : Colors.transparent),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(borderRadius: BorderRadius.circular(12), onTap: onTap, child: Center(child: child)),
          ),
        ),
        if (count != null)
          Positioned(
            top: -4,
            right: -4,
            child: Container(
              constraints: const BoxConstraints(minWidth: 18),
              height: 18,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                color: countBg,
                border: Border.all(color: countColor.withValues(alpha: 0.4)),
                borderRadius: BorderRadius.circular(99),
              ),
              alignment: Alignment.center,
              child: Text(count,
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: countColor, height: 1)),
            ),
          ),
      ]),
    );
  }

  Widget _railButton(IconData icon, String tooltip, VoidCallback onTap) => Tooltip(
        message: tooltip,
        child: _railShell(onTap: onTap, child: Icon(icon, size: 20, color: AppColors.slate400)),
      );

  Widget _railNav(NavTab tab, IconData icon, String tooltip, Color activeColor,
      {String? count, Color countColor = AppColors.slate300, Color countBg = const Color(0xFF2A2C40)}) {
    final active = widget.nav == tab;
    return Tooltip(
      message: tooltip,
      child: _railShell(
        onTap: () => widget.onSelectNav(tab),
        gradient: active ? const LinearGradient(colors: [Color(0x1FFFFFFF), Color(0x0AFFFFFF)]) : null,
        bordered: active,
        count: count,
        countColor: countColor,
        countBg: countBg,
        child: Icon(icon, size: 20, color: active ? activeColor : AppColors.slate400),
      ),
    );
  }

  Widget _railFilter(bool on, VoidCallback onTap, IconData icon, String label, List<Color> colors, Color idleColor) =>
      Tooltip(
        message: on ? '$label: on (tap to turn off)' : '$label: tap to filter',
        child: _railShell(
          onTap: onTap,
          gradient: on ? LinearGradient(colors: colors) : null,
          background: on ? null : idleColor.withValues(alpha: 0.1),
          child: Icon(icon, size: 20, color: on ? Colors.white : idleColor),
        ),
      );
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.slate400));
}

class _RailDivider extends StatelessWidget {
  const _RailDivider();

  @override
  Widget build(BuildContext context) =>
      Container(width: 32, height: 1, margin: const EdgeInsets.symmetric(vertical: 6), color: AppColors.border);
}

class _Dot extends StatelessWidget {
  final Color color;
  final bool pulse;
  const _Dot({required this.color, this.pulse = false});

  @override
  Widget build(BuildContext context) => Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          boxShadow: pulse ? [BoxShadow(color: color.withValues(alpha: 0.6), blurRadius: 6)] : null,
        ),
      );
}

/// One of the floor plan's view toggles (Available / Occupied filters, Info
/// Panels), filled with its colour while on.
class _ViewTile extends StatelessWidget {
  final bool on;
  final VoidCallback onTap;
  final IconData icon;
  final String label;
  final String tooltip;
  final List<Color> colors;
  final Color idleColor;

  const _ViewTile({
    required this.on,
    required this.onTap,
    required this.icon,
    required this.label,
    required this.tooltip,
    required this.colors,
    required this.idleColor,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          height: 60,
          decoration: BoxDecoration(
            gradient: on ? LinearGradient(colors: colors) : null,
            color: on ? null : const Color(0xFF161829),
            border: Border.all(color: on ? Colors.transparent : AppColors.border),
            borderRadius: BorderRadius.circular(14),
            boxShadow: on ? [BoxShadow(color: colors.first.withValues(alpha: 0.25), blurRadius: 14)] : null,
          ),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, size: 20, color: on ? Colors.white : idleColor),
            const SizedBox(height: 4),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: on ? Colors.white : AppColors.slate300)),
          ]),
        ),
      ),
    );
  }
}
