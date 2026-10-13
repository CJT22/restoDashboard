import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/live_stream.dart';
import '../api/models.dart';

/// Every zone's live status and open order, kept in step with restoAdmin the
/// same way the web dashboard's App.tsx does: a full resync on start, from
/// the refresh button and after an outage, plus live table/order events in
/// between.
class DashboardState extends ChangeNotifier {
  final ApiClient api;
  final LiveStream stream;
  final List<Zone> zones;
  final List<InfoPanel> panels;

  ConnectionStatus connection = ConnectionStatus.connecting;
  DateTime? lastSyncedAt;

  final List<StreamSubscription> _subs = [];

  /// Fires after every order event, for the Total Sales widget's refetch.
  final _orderEvents = StreamController<void>.broadcast();
  Stream<void> get orderEvents => _orderEvents.stream;

  DashboardState(this.api, FloorLayout layout)
      : stream = LiveStream(api),
        zones = layout.zones.map(Zone.fromLayout).toList(),
        panels = layout.panels;

  void start() {
    resync().catchError((_) {});
    ConnectionStatus? previous;
    _subs.add(stream.statusChanges.listen((status) {
      connection = status;
      notifyListeners();
      // Events sent while the stream (or the server's link to restoAdmin)
      // was down are never replayed, so catch up in full.
      if (status == ConnectionStatus.live &&
          (previous == ConnectionStatus.offline || previous == ConnectionStatus.adminOffline)) {
        resync().catchError((_) {});
      }
      previous = status;
    }));
    _subs.add(stream.events.listen(_onEvent));
    stream.start();
  }

  Zone? zoneById(String id) {
    for (final z in zones) {
      if (z.id == id) return z;
    }
    return null;
  }

  Zone? _zoneByAdminId(int adminTableId) {
    for (final z in zones) {
      if (z.adminTableId == adminTableId) return z;
    }
    return null;
  }

  /// Pulls every linked zone's status and open order fresh from restoAdmin.
  /// Throws if either half failed; the half that worked is still applied.
  Future<void> resync() async {
    final results = await Future.wait<Object?>([
      api.adminTables().then<Object?>((v) => v, onError: (Object e) => e),
      api.activeOrders().then<Object?>((v) => v, onError: (Object e) => e),
    ]);
    final tables = results[0];
    final orders = results[1];

    if (tables is List<AdminTable>) {
      final byId = {for (final t in tables) t.id: t};
      for (final z in zones) {
        final remote = z.adminTableId == null ? null : byId[z.adminTableId];
        if (remote == null) continue;
        z.status = statusFromAdmin(remote.status);
        z.adminRoomCharge = remote.roomCharge;
      }
    }
    if (orders is Map<int, OrderSummary>) {
      for (final z in zones) {
        if (z.adminTableId != null) z.activeOrder = orders[z.adminTableId];
      }
    }
    if (tables is! List<AdminTable> || orders is! Map<int, OrderSummary>) {
      notifyListeners();
      throw ApiException('Could not refresh everything from restoAdmin');
    }
    lastSyncedAt = DateTime.now();
    notifyListeners();
  }

  void _onEvent(StreamEvent e) {
    if (e.name == 'table_updated') {
      final status = e.data['status'];
      final id = e.data['adminTableId'];
      if (status == null || id == null) return;
      final zone = _zoneByAdminId((id as num).toInt());
      if (zone == null) return;
      zone.status = statusFromAdmin(status as num);
      notifyListeners();
    } else if (e.name == 'order_created' || e.name == 'order_updated') {
      _onOrderEvent(OrderEvent.fromJson(e.data));
      _orderEvents.add(null);
    }
  }

  // Order events carry the full item list, so the zone's order is built
  // straight from it. Only Pending/Confirmed count as active; a settled or
  // cancelled order clears the zone's order. Table status is left to
  // table_updated, the single source of truth for it.
  void _onOrderEvent(OrderEvent event) {
    final tableId = event.tableId;
    if (tableId == null) return;
    final zone = _zoneByAdminId(tableId);
    if (zone == null) return;
    final active = event.status == 2 || event.status == 3;
    if (!active) {
      zone.activeOrder = null;
      notifyListeners();
      return;
    }
    // Events never carry createdAt (and sometimes not the charges), so keep
    // what the zone already knew about the same order.
    final prev = zone.activeOrder;
    final known = prev != null && prev.id == event.orderId ? prev : null;
    final order = OrderSummary(
      id: event.orderId,
      orderNo: event.orderNo ?? '',
      orderType: known?.orderType,
      status: event.status ?? 0,
      subtotal: event.items.fold(0, (sum, i) => sum + i.lineTotal),
      serviceCharge: event.serviceCharge ?? known?.serviceCharge,
      roomRate: event.roomRate ?? known?.roomRate,
      createdAt: event.createdAt ?? known?.createdAt,
      grandTotal: event.grandTotal ?? known?.grandTotal ?? 0,
      items: event.items,
    );
    zone.activeOrder = order;
    notifyListeners();

    // An order this app hasn't seen in full: pull it once so its timer can start.
    if (order.createdAt == null) {
      api.activeOrderForTable(tableId).then((fresh) {
        zone.activeOrder = fresh;
        notifyListeners();
      }).catchError((_) {});
    }
  }

  /// Applies the result of an order action taken here (create, add items,
  /// confirm, cancel, settle), then double-checks the table's status
  /// straight from restoAdmin in case its live event was missed.
  void orderChanged(Zone zone, OrderSummary? order) {
    zone.activeOrder = order;
    notifyListeners();
    final adminId = zone.adminTableId;
    if (adminId == null) return;
    api.adminTables().then((tables) {
      for (final t in tables) {
        if (t.id == adminId) {
          zone.status = statusFromAdmin(t.status);
          zone.adminRoomCharge = t.roomCharge;
          notifyListeners();
        }
      }
    }).catchError((_) {});
  }

  /// Refetches one zone's order (after an edit made from this app).
  Future<void> refreshOrder(Zone zone) async {
    if (zone.adminTableId == null) return;
    zone.activeOrder = await api.activeOrderForTable(zone.adminTableId!);
    notifyListeners();
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    stream.dispose();
    _orderEvents.close();
    super.dispose();
  }
}
