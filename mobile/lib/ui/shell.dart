import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/floor_images.dart';
import '../api/models.dart';
import '../state/dashboard_state.dart';
import 'common.dart';
import 'directory_view.dart';
import 'floor_plan.dart';
import 'order_queue_view.dart';
import 'sidebar.dart';
import '../theme.dart';
import 'table_detail.dart';

enum NavTab { floorplan, directory, orders }

/// The signed-in dashboard: sidebar on the left, the chosen view on the
/// right (src/App.tsx).
class DashboardShell extends StatefulWidget {
  final DashboardState state;
  final DashboardUser user;
  final VoidCallback onSignOut;
  const DashboardShell({super.key, required this.state, required this.user, required this.onSignOut});

  @override
  State<DashboardShell> createState() => _DashboardShellState();
}

class _DashboardShellState extends State<DashboardShell> {
  // Per-device view choices, like the web dashboard's localStorage ones.
  static const _prefsShowInfoPanels = 'show_info_panels';

  SharedPreferences? _prefs;
  NavTab _nav = NavTab.floorplan;
  int _floor = 1;
  bool _availableFilter = false;
  bool _occupiedFilter = false;
  // Starts collapsed to its icon rail every time, giving the floor plan the
  // room; staff open it when they need the filters.
  bool _sidebarCollapsed = true;
  bool _showInfoPanels = true;
  // Bumped when a sidebar floor card is tapped, so All Tables & Rooms and
  // Active Orders follow it even when their own floor filter already moved.
  int _floorRequest = 0;
  StreamSubscription<String>? _noticeSub;

  @override
  void initState() {
    super.initState();
    // Fetch and decode both floor plans up front, so switching floors doesn't
    // stall on a 2560x1440 image the first time.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      for (final floor in [1, 2]) {
        precacheImage(NetworkImage(widget.state.api.floorPlanImageUrl(floor)), context, onError: (_, _) {});
      }
    });
    // And keep a copy on disk for starting with no connection.
    FloorImages.refresh(widget.state.api);
    _noticeSub = widget.state.notices.listen((message) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 8),
        behavior: SnackBarBehavior.floating,
        width: 520,
      ));
    });
    SharedPreferences.getInstance().then((prefs) {
      if (!mounted) return;
      setState(() {
        _prefs = prefs;
        // Left from when the sidebar's state was remembered.
        prefs.remove('sidebar_collapsed');
        _showInfoPanels = prefs.getBool(_prefsShowInfoPanels) ?? true;
      });
    });
  }

  @override
  void dispose() {
    _noticeSub?.cancel();
    super.dispose();
  }

  void _toggleSidebar() {
    setState(() => _sidebarCollapsed = !_sidebarCollapsed);
  }

  // One filter state, shared by the sidebar's tiles and the floor plan's
  // status chips.
  void _toggleAvailable() => setState(() => _availableFilter = !_availableFilter);
  void _toggleOccupied() => setState(() => _occupiedFilter = !_occupiedFilter);

  void _toggleInfoPanels() {
    setState(() => _showInfoPanels = !_showInfoPanels);
    _prefs?.setBool(_prefsShowInfoPanels, _showInfoPanels);
  }

  void _openZone(Zone zone) => openZone(context, widget.state, zone);

  // Sign out sits among everyday buttons, so a stray tap asks first.
  Future<void> _confirmSignOut() async {
    final unsent = widget.state.offline.actions.length;
    final confirmed = await confirmDialog(
      context,
      title: 'Sign out ${widget.user.displayName}?',
      description: 'This tablet goes back to the sign-in page, and live updates stop until someone signs in again.'
          '${unsent == 0 ? '' : ' ${unsent == 1 ? '1 change is' : '$unsent changes are'} still saved on this tablet; '
              'they are sent after the next sign-in.'}',
      confirmText: 'Sign out',
      confirmIcon: Icons.logout,
      icon: Icons.logout,
    );
    if (confirmed) widget.onSignOut();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final sidebarWidth = _sidebarCollapsed ? sidebarCollapsedWidth : sidebarExpandedWidth;
    return Scaffold(
      // The views' own backdrop, also behind them while they slide.
      body: DecoratedBox(
        decoration: const BoxDecoration(gradient: workspaceGradient),
        child: ListenableBuilder(
          listenable: state,
          builder: (context, _) => Stack(children: [
            // The view takes its final width once, then slides with the
            // sidebar's edge. Resizing it every frame instead re-laid-out and
            // redrew the whole floor plan, which stuttered on the tablets.
            Positioned(
              top: 0,
              bottom: 0,
              left: sidebarWidth,
              right: 0,
              child: TweenAnimationBuilder<double>(
                tween: Tween(end: sidebarWidth),
                duration: sidebarAnimation,
                curve: Curves.easeOut,
                builder: (context, x, child) => Transform.translate(offset: Offset(x - sidebarWidth, 0), child: child),
                child: RepaintBoundary(
                  child: switch (_nav) {
                    NavTab.floorplan => FloorPlanView(
                        state: state,
                        floor: _floor,
                        onSelectFloor: (f) => setState(() => _floor = f),
                        onSelectZone: _openZone,
                        availableFilter: _availableFilter,
                        occupiedFilter: _occupiedFilter,
                        onToggleAvailable: _toggleAvailable,
                        onToggleOccupied: _toggleOccupied,
                        showInfoPanels: _showInfoPanels,
                      ),
                    NavTab.directory => DirectoryView(
                        state: state,
                        floor: _floor,
                        floorRequest: _floorRequest,
                        onSelectFloor: (f) => setState(() => _floor = f),
                        onSelectZone: _openZone,
                      ),
                    NavTab.orders => OrderQueueView(
                        state: state,
                        floor: _floor,
                        floorRequest: _floorRequest,
                        onSelectFloor: (f) => setState(() => _floor = f),
                        onSelectZone: _openZone,
                      ),
                  },
                ),
              ),
            ),
            // Its own layer, so the clock ticking every second doesn't
            // repaint the floor plan.
            Positioned(
              top: 0,
              bottom: 0,
              left: 0,
              child: RepaintBoundary(
                child: Sidebar(
                  state: state,
                  user: widget.user,
                  collapsed: _sidebarCollapsed,
                  onToggleCollapsed: _toggleSidebar,
                  nav: _nav,
                  onSelectNav: (nav) => setState(() => _nav = nav),
                  floor: _floor,
                  onSelectFloor: (f) => setState(() {
                    _floor = f;
                    _floorRequest++;
                  }),
                  availableFilter: _availableFilter,
                  onToggleAvailable: _toggleAvailable,
                  occupiedFilter: _occupiedFilter,
                  onToggleOccupied: _toggleOccupied,
                  showInfoPanels: _showInfoPanels,
                  onToggleInfoPanels: _toggleInfoPanels,
                  onSelectZone: _openZone,
                  onSignOut: _confirmSignOut,
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
