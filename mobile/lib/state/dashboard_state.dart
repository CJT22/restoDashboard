import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/live_stream.dart';
import '../api/models.dart';
import 'offline_queue.dart';

/// Every zone's live status and open order, kept in step with restoAdmin the
/// same way the web dashboard's App.tsx does: a full resync on start, from
/// the refresh button and after an outage, plus live table/order events in
/// between.
///
/// App only: order changes made while restoAdmin can't be reached are saved
/// on this tablet ([offline]) and sent once it can, and the last floor seen
/// is saved so the app starts with no connection. Each zone shows what
/// restoAdmin last said with the saved changes on top (see [_apply]).
class DashboardState extends ChangeNotifier {
  static const _prefsCachedFloor = 'cached_floor';
  // How often saved changes are tried again while the connection is up
  // (after a failed send), on top of trying the moment it comes back.
  static const _retryEvery = Duration(seconds: 15);

  final ApiClient api;
  final LiveStream stream;
  final OfflineQueue offline;
  final List<Zone> zones;
  final List<InfoPanel> panels;

  ConnectionStatus connection = ConnectionStatus.connecting;
  DateTime? lastSyncedAt;

  // What restoAdmin last said per zone id, before the saved changes go on top.
  final Map<String, OrderSummary?> _serverOrders = {};
  final Map<String, TableStatus> _serverStatus = {};

  bool _syncing = false;

  /// Saved changes are being sent right now.
  bool get syncing => _syncing;

  final List<StreamSubscription> _subs = [];
  Timer? _retryTimer;
  Timer? _saveTimer;

  /// Fires after every order event, for the Total Sales widget's refetch.
  final _orderEvents = StreamController<void>.broadcast();
  Stream<void> get orderEvents => _orderEvents.stream;

  /// Messages for staff about saved changes as they sync, shown by the shell.
  final _notices = StreamController<String>.broadcast();
  Stream<String> get notices => _notices.stream;

  DashboardState(this.api, FloorLayout layout)
      : stream = LiveStream(api),
        offline = OfflineQueue(api.prefs),
        zones = layout.zones.map(Zone.fromLayout).toList(),
        panels = layout.panels {
    offline.addListener(notifyListeners);
  }

  /// Order changes are sent to restoAdmin unless the connection is known to
  /// be down; then they're saved here (see [createOrder]).
  bool get online => connection == ConnectionStatus.live || connection == ConnectionStatus.connecting;

  void start() {
    _restoreFloor();
    _catchUp();
    ConnectionStatus? previous;
    _subs.add(stream.statusChanges.listen((status) {
      connection = status;
      notifyListeners();
      // Events sent while the stream (or the server's link to restoAdmin)
      // was down are never replayed, so catch up in full, after sending
      // anything saved meanwhile.
      if (status == ConnectionStatus.live) {
        if (previous == ConnectionStatus.offline || previous == ConnectionStatus.adminOffline) {
          _catchUp();
        } else {
          syncNow();
        }
      }
      previous = status;
    }));
    _subs.add(stream.events.listen(_onEvent));
    stream.start();
    _retryTimer = Timer.periodic(_retryEvery, (_) {
      if (online && offline.hasSendable) syncNow();
    });
  }

  Future<void> _catchUp() async {
    await syncNow();
    await resync().catchError((_) {});
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

  // Shows [z] as restoAdmin last said, with the saved changes on top: a
  // saved new order makes the table Occupied until restoAdmin says so.
  void _apply(Zone z) {
    final id = z.adminTableId;
    if (id == null) return;
    final server = _serverOrders[z.id];
    z.activeOrder = offline.overlay(id, server, z.adminRoomCharge ?? 0);
    final status = _serverStatus[z.id];
    if (status != null) z.status = status;
    if (server == null && offline.localOrderFor(id) != null) z.status = TableStatus.occupied;
    z.unsynced = offline.hasPendingFor(id);
    _scheduleSaveFloor();
  }

  void _setServerOrder(Zone z, OrderSummary? order) {
    _serverOrders[z.id] = order;
    _apply(z);
  }

  void _setServerStatus(Zone z, TableStatus status) {
    _serverStatus[z.id] = status;
    _apply(z);
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
        z.adminRoomCharge = remote.roomCharge;
        _serverStatus[z.id] = statusFromAdmin(remote.status);
      }
    }
    if (orders is Map<int, OrderSummary>) {
      for (final z in zones) {
        if (z.adminTableId != null) _serverOrders[z.id] = orders[z.adminTableId];
      }
    }
    zones.forEach(_apply);
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
      _setServerStatus(zone, statusFromAdmin(status as num));
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
      _setServerOrder(zone, null);
      notifyListeners();
      return;
    }
    // Events never carry createdAt (and sometimes not the charges), so keep
    // what the zone already knew about the same order.
    final prev = _serverOrders[zone.id];
    final known = prev != null && prev.id == event.orderId ? prev : null;
    // The current room's hours from before still hold if the charge didn't
    // change; otherwise they're re-derived from it, unless the event says.
    final sameCharge = event.serviceCharge == null || event.serviceCharge == known?.serviceCharge;
    final order = OrderSummary(
      id: event.orderId,
      orderNo: event.orderNo ?? '',
      orderType: known?.orderType,
      status: event.status ?? 0,
      subtotal: event.items.fold(0, (sum, i) => sum + i.lineTotal),
      serviceCharge: event.serviceCharge ?? known?.serviceCharge,
      roomRate: event.roomRate ?? known?.roomRate,
      createdAt: event.createdAt ?? known?.createdAt,
      roomHours: event.roomHours ?? (sameCharge ? known?.roomHours : null),
      roomStartedAt: event.roomStartedAt ?? known?.roomStartedAt,
      grandTotal: event.grandTotal ?? known?.grandTotal ?? 0,
      items: event.items,
    );
    _setServerOrder(zone, order);
    notifyListeners();

    // An order this app hasn't seen in full: pull it once so its timer can start.
    if (order.createdAt == null) {
      api.activeOrderForTable(tableId).then((fresh) {
        _setServerOrder(zone, fresh);
        notifyListeners();
      }).catchError((_) {});
    }
  }

  /// Applies the result of an order action taken here (create, add items,
  /// confirm, cancel, settle), then double-checks the table's status
  /// straight from restoAdmin in case its live event was missed.
  void orderChanged(Zone zone, OrderSummary? order) {
    _setServerOrder(zone, order);
    notifyListeners();
    final adminId = zone.adminTableId;
    if (adminId == null) return;
    api.adminTables().then((tables) {
      for (final t in tables) {
        if (t.id == adminId) {
          zone.adminRoomCharge = t.roomCharge;
          _setServerStatus(zone, statusFromAdmin(t.status));
          notifyListeners();
        }
      }
    }).catchError((_) {});
  }

  /// Refetches one zone's order (after an edit made from this app).
  Future<void> refreshOrder(Zone zone) async {
    if (zone.adminTableId == null) return;
    _setServerOrder(zone, await api.activeOrderForTable(zone.adminTableId!));
    notifyListeners();
  }

  /// The table's hourly room charge, fresh if restoAdmin answers, else the
  /// last one seen.
  Future<double> roomRate(Zone zone) async {
    try {
      return await api.roomChargeRate(zone.adminTableId!);
    } catch (_) {
      return zone.adminRoomCharge ?? 0;
    }
  }

  // ---- Order changes that work offline ----

  // Sends [send] if live. Null means it didn't get through and should be
  // saved instead; any other answer (done or refused) is returned.
  Future<MutationResult?> _trySend(Future<MutationResult> Function() send) async {
    if (!online) return null;
    try {
      final r = await send();
      return r.transient ? null : r;
    } on ApiException catch (e) {
      if (e.network) return null;
      rethrow;
    }
  }

  void _saved(Zone zone) {
    _apply(zone);
    notifyListeners();
  }

  /// A new order for [zone]: sent now if possible, else saved here
  /// ([MutationResult.queued]). Either way the zone shows it.
  Future<MutationResult> createOrder(Zone zone, String orderType, List<QueuedItem> items, double? roomChargeQty) async {
    final adminId = zone.adminTableId!;
    // Taken now, whenever it reaches restoAdmin; also what makes a resend
    // of a create whose answer was lost find the order it already made.
    final createdAt = DateTime.now();
    final r = await _trySend(
        () => api.createOrder(adminId, orderType, itemsPayload(items), roomChargeQty, createdAt: createdAt));
    if (r != null) {
      if (r.ok) orderChanged(zone, await api.activeOrderForTable(adminId).catchError((_) => null));
      return r;
    }
    offline.queueCreate(adminId, orderType, items, roomChargeQty, createdAt);
    _saved(zone);
    return const MutationResult.queued();
  }

  /// Items for [order] (Add Items, Quick Add Drinks): sent now if possible,
  /// else saved here. Always saved for an order that's itself still saved.
  Future<MutationResult> addItems(Zone zone, OrderSummary order, List<QueuedItem> items) async {
    if (!order.isLocal) {
      final r = await _trySend(() => api.addItems(order.id, itemsPayload(items)));
      if (r != null) {
        if (r.ok) await refreshOrder(zone).catchError((_) {});
        return r;
      }
    }
    offline.queueAddItems(zone.adminTableId!, order.id, items);
    _saved(zone);
    return const MutationResult.queued();
  }

  /// The room hours for [order], like [addItems].
  Future<MutationResult> updateRoomCharge(Zone zone, OrderSummary order, double qty) async {
    if (!order.isLocal) {
      final r = await _trySend(() => api.updateRoomCharge(order.id, qty));
      if (r != null) {
        if (r.ok) await refreshOrder(zone).catchError((_) {});
        return r;
      }
    }
    offline.queueRoomCharge(zone.adminTableId!, order.id, qty);
    _saved(zone);
    return const MutationResult.queued();
  }

  /// Sends the saved changes, oldest first, until one doesn't get through
  /// (the rest wait for the next try). One restoAdmin refuses is kept with
  /// its reason for Retry or Discard (see [retry], [discard]).
  Future<void> syncNow() async {
    if (_syncing || !offline.hasSendable) return;
    _syncing = true;
    notifyListeners();
    try {
      for (final a in [...offline.actions]) {
        if (a.failed) continue;
        // Staff can add to it while it's on its way; see OfflineQueue.sent.
        final sentItems = [...a.items];
        final sentRoomQty = a.roomChargeQty;
        final MutationResult r;
        try {
          r = await _sendSaved(a);
        } on ApiException catch (e) {
          if (e.network) break;
          offline.fail(a, e.message);
          continue;
        }
        if (r.transient) break;
        if (r.ok) {
          await _synced(a, r, sentItems, sentRoomQty);
        } else {
          offline.fail(a, _refusal(r));
          final zone = _zoneByAdminId(a.adminTableId);
          if (zone != null) _apply(zone);
        }
      }
    } finally {
      _syncing = false;
      notifyListeners();
    }
  }

  Future<MutationResult> _sendSaved(OfflineAction a) => switch (a.type) {
        OfflineActionType.createOrder => api.createOrder(
            a.adminTableId, a.orderType ?? 'DINE_IN', itemsPayload(a.items), a.roomChargeQty,
            createdAt: a.createdAt, mergeOnConflict: true),
        // Logged in restoAdmin at the time it was done, not when it synced.
        OfflineActionType.addItems => api.addItems(a.orderId!, itemsPayload(a.items), clientAt: a.createdAt),
        OfflineActionType.roomCharge => api.updateRoomCharge(a.orderId!, a.roomChargeQty!, clientAt: a.createdAt),
      };

  static String _refusal(MutationResult r) {
    if (r.kind == 'insufficient' && r.insufficient.isNotEmpty) {
      final names = r.insufficient.map((i) => i['ingredientName'] ?? i['name']).whereType<Object>().join(', ');
      return names.isEmpty ? 'Not enough stock in restoAdmin.' : 'Not enough stock in restoAdmin: $names.';
    }
    return r.message ?? 'restoAdmin refused it.';
  }

  // Sent: the zone takes restoAdmin's copy of the order before the saved
  // change is dropped, so it doesn't flicker back to empty in between.
  Future<void> _synced(OfflineAction a, MutationResult r, List<QueuedItem> sentItems, double? sentRoomQty) async {
    final zone = _zoneByAdminId(a.adminTableId);
    OrderSummary? fresh;
    var fetched = false;
    try {
      fresh = await api.activeOrderForTable(a.adminTableId);
      fetched = true;
    } catch (_) {}
    offline.sent(a, r.id ?? a.orderId, sentItems, sentRoomQty);
    if (zone == null) return;
    if (fetched) {
      orderChanged(zone, fresh);
    } else {
      _saved(zone);
    }
    if (r.merged) {
      _notices.add('${zone.name} already had an open order, so the order saved offline was added to it. '
          'Check its room hours.');
    }
  }

  /// Sends a refused change again, now.
  Future<void> retry(OfflineAction action) async {
    offline.retry(action);
    await syncNow();
  }

  /// Drops a saved change without sending it.
  void discard(OfflineAction action) {
    offline.remove(action);
    final zone = _zoneByAdminId(action.adminTableId);
    if (zone != null) _saved(zone);
  }

  /// The zone a saved change is for (for listing them).
  Zone? zoneForAction(OfflineAction action) => _zoneByAdminId(action.adminTableId);

  // ---- The floor's saved copy, for starting with no connection ----

  void _scheduleSaveFloor() {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(seconds: 2), _saveFloor);
  }

  void _saveFloor() {
    final tables = <String, dynamic>{};
    for (final z in zones) {
      final id = z.adminTableId;
      if (id == null || !_serverStatus.containsKey(z.id)) continue;
      tables['$id'] = {
        'status': _serverStatus[z.id]!.name,
        'roomCharge': z.adminRoomCharge,
        'order': _serverOrders[z.id]?.toJson(),
      };
    }
    api.prefs.setString(_prefsCachedFloor, jsonEncode({'syncedAt': lastSyncedAt?.toIso8601String(), 'tables': tables}));
  }

  void _restoreFloor() {
    final saved = api.prefs.getString(_prefsCachedFloor);
    if (saved == null) {
      zones.forEach(_apply);
      return;
    }
    try {
      final json = Map<String, dynamic>.from(jsonDecode(saved));
      final tables = Map<String, dynamic>.from(json['tables'] ?? {});
      for (final z in zones) {
        final t = tables['${z.adminTableId}'];
        if (t is! Map) continue;
        _serverStatus[z.id] = TableStatus.values.byName(t['status'].toString());
        z.adminRoomCharge = (t['roomCharge'] as num?)?.toDouble();
        final order = t['order'];
        _serverOrders[z.id] = order is Map ? OrderSummary.fromApi(Map<String, dynamic>.from(order)) : null;
      }
      lastSyncedAt = json['syncedAt'] == null ? null : DateTime.tryParse(json['syncedAt'].toString());
    } catch (e) {
      debugPrint('[offline] could not read the saved floor: $e');
    }
    zones.forEach(_apply);
    notifyListeners();
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _retryTimer?.cancel();
    if (_saveTimer?.isActive ?? false) {
      _saveTimer!.cancel();
      _saveFloor();
    }
    offline.removeListener(notifyListeners);
    stream.dispose();
    _orderEvents.close();
    _notices.close();
    super.dispose();
  }
}
