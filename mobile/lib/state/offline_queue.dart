import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/models.dart';

// Order changes taken while restoAdmin can't be reached, kept on this tablet
// until they can be sent. App only: the web dashboard asks for a connection
// instead. Modelled on the staff app's offline queue (restoapp-bluemoon's
// offline_sync_service.dart), cut down to what the dashboard does offline:
// new orders, added items (Add Items and Quick Add Drinks) and room hours.
// Settling, cancelling and editing items need a connection.
//
// Changes to an order that's itself still waiting here are folded into it,
// so an order saved offline always goes to restoAdmin as one create, with
// no temporary-id bookkeeping. DashboardState shows these changes on top of
// what restoAdmin last said (overlay) and sends them when it can.

/// One menu item line of a saved change.
class QueuedItem {
  final int menuId;
  final String name;
  final double unitPrice;
  final int qty;
  const QueuedItem({required this.menuId, required this.name, required this.unitPrice, required this.qty});

  factory QueuedItem.fromJson(Map<String, dynamic> j) => QueuedItem(
        menuId: (j['menuId'] as num).toInt(),
        name: (j['name'] ?? '').toString(),
        unitPrice: (j['unitPrice'] as num).toDouble(),
        qty: (j['qty'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => {'menuId': menuId, 'name': name, 'unitPrice': unitPrice, 'qty': qty};

  /// What the dashboard server's order routes take.
  Map<String, num> get payload => {'menuId': menuId, 'qty': qty, 'unitPrice': unitPrice};
}

List<Map<String, num>> itemsPayload(List<QueuedItem> items) => [for (final i in items) i.payload];

enum OfflineActionType { createOrder, addItems, roomCharge }

class OfflineAction {
  final String id;
  final OfflineActionType type;
  final int adminTableId;
  // When it was taken. A new order is recorded in restoAdmin at this time,
  // so its room timer runs from here, not from when it synced.
  final DateTime createdAt;
  // addItems / roomCharge: the restoAdmin order they change.
  final int? orderId;
  // createOrder: the order's id until it syncs (negative, see
  // OrderSummary.isLocal) and its type.
  final int? localOrderId;
  final String? orderType;
  // createOrder / addItems.
  List<QueuedItem> items;
  // createOrder (null for a table with no room charge) / roomCharge.
  double? roomChargeQty;
  // restoAdmin refused it (e.g. not enough stock): it waits for Retry or
  // Discard instead of being sent again on its own.
  String? error;

  OfflineAction({
    required this.id,
    required this.type,
    required this.adminTableId,
    required this.createdAt,
    this.orderId,
    this.localOrderId,
    this.orderType,
    this.items = const [],
    this.roomChargeQty,
    this.error,
  });

  bool get failed => error != null;

  factory OfflineAction.fromJson(Map<String, dynamic> j) => OfflineAction(
        id: j['id'].toString(),
        type: OfflineActionType.values.byName(j['type'].toString()),
        adminTableId: (j['adminTableId'] as num).toInt(),
        createdAt: DateTime.parse(j['createdAt'].toString()),
        orderId: (j['orderId'] as num?)?.toInt(),
        localOrderId: (j['localOrderId'] as num?)?.toInt(),
        orderType: j['orderType']?.toString(),
        items: [for (final i in (j['items'] as List? ?? [])) QueuedItem.fromJson(Map<String, dynamic>.from(i))],
        roomChargeQty: (j['roomChargeQty'] as num?)?.toDouble(),
        error: j['error']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type.name,
        'adminTableId': adminTableId,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'orderId': ?orderId,
        'localOrderId': ?localOrderId,
        'orderType': ?orderType,
        'items': [for (final i in items) i.toJson()],
        'roomChargeQty': ?roomChargeQty,
        'error': ?error,
      };
}

// Adds [extra] to [items], one line per menu item.
List<QueuedItem> _mergeItems(List<QueuedItem> items, List<QueuedItem> extra) {
  final merged = [...items];
  for (final e in extra) {
    final i = merged.indexWhere((m) => m.menuId == e.menuId);
    if (i == -1) {
      merged.add(e);
    } else {
      final m = merged[i];
      merged[i] = QueuedItem(menuId: m.menuId, name: m.name, unitPrice: m.unitPrice, qty: m.qty + e.qty);
    }
  }
  return merged;
}

/// The saved changes, oldest first, kept in shared preferences so they
/// survive the app closing and signing out.
class OfflineQueue extends ChangeNotifier {
  static const _prefsKey = 'offline_queue';

  final SharedPreferences _prefs;
  final List<OfflineAction> actions = [];
  int _nextId = 0;

  OfflineQueue(this._prefs) {
    final saved = _prefs.getString(_prefsKey);
    if (saved == null) return;
    try {
      for (final a in jsonDecode(saved) as List) {
        actions.add(OfflineAction.fromJson(Map<String, dynamic>.from(a)));
      }
    } catch (e) {
      debugPrint('[offline] could not read the saved queue: $e');
    }
  }

  void _changed() {
    _prefs.setString(_prefsKey, jsonEncode([for (final a in actions) a.toJson()]));
    notifyListeners();
  }

  String _newId(DateTime now) => '${now.microsecondsSinceEpoch}-${_nextId++}';

  bool get isEmpty => actions.isEmpty;
  int get failedCount => actions.where((a) => a.failed).length;

  /// Whether any of them still goes on its own (not waiting for Retry).
  bool get hasSendable => actions.any((a) => !a.failed);

  bool hasPendingFor(int adminTableId) => actions.any((a) => a.adminTableId == adminTableId);

  /// The table's new order, if it's one saved here and not in restoAdmin yet.
  OfflineAction? localOrderFor(int adminTableId) {
    for (final a in actions) {
      if (a.type == OfflineActionType.createOrder && a.adminTableId == adminTableId) return a;
    }
    return null;
  }

  OfflineAction _localOrder(int localOrderId) =>
      actions.firstWhere((a) => a.type == OfflineActionType.createOrder && a.localOrderId == localOrderId);

  void queueCreate(int adminTableId, String orderType, List<QueuedItem> items, double? roomChargeQty, DateTime createdAt) {
    actions.add(OfflineAction(
      id: _newId(createdAt),
      type: OfflineActionType.createOrder,
      adminTableId: adminTableId,
      createdAt: createdAt,
      // Negative and unique: when it was taken.
      localOrderId: -createdAt.millisecondsSinceEpoch,
      orderType: orderType,
      items: items,
      roomChargeQty: roomChargeQty,
    ));
    _changed();
  }

  /// Items for [orderId]: onto the saved order itself if it's one, else onto
  /// the items already waiting for that order.
  void queueAddItems(int adminTableId, int orderId, List<QueuedItem> items) {
    final now = DateTime.now();
    if (orderId < 0) {
      final order = _localOrder(orderId);
      order.items = _mergeItems(order.items, items);
    } else {
      final i = actions.indexWhere((a) => a.type == OfflineActionType.addItems && a.orderId == orderId && !a.failed);
      if (i == -1) {
        actions.add(OfflineAction(
            id: _newId(now), type: OfflineActionType.addItems, adminTableId: adminTableId, createdAt: now, orderId: orderId, items: items));
      } else {
        actions[i].items = _mergeItems(actions[i].items, items);
      }
    }
    _changed();
  }

  /// The room hours for [orderId]; only the latest is kept.
  void queueRoomCharge(int adminTableId, int orderId, double qty) {
    final now = DateTime.now();
    if (orderId < 0) {
      _localOrder(orderId).roomChargeQty = qty;
    } else {
      final i = actions.indexWhere((a) => a.type == OfflineActionType.roomCharge && a.orderId == orderId);
      if (i == -1) {
        actions.add(OfflineAction(
            id: _newId(now), type: OfflineActionType.roomCharge, adminTableId: adminTableId, createdAt: now, orderId: orderId, roomChargeQty: qty));
      } else {
        actions[i]
          ..roomChargeQty = qty
          ..error = null;
      }
    }
    _changed();
  }

  void remove(OfflineAction action) {
    actions.remove(action);
    _changed();
  }

  /// [action] reached restoAdmin as [sentItems] / [sentRoomQty], for the
  /// restoAdmin order [orderId]. Drops it, keeping whatever staff added to
  /// it while it was on its way as a change of its own for that order.
  void sent(OfflineAction action, int? orderId, List<QueuedItem> sentItems, double? sentRoomQty) {
    final i = actions.indexOf(action);
    if (i == -1) return;
    final later = <OfflineAction>[];
    if (orderId != null && orderId > 0) {
      final leftover = <QueuedItem>[];
      for (final item in action.items) {
        final sentQty = sentItems.where((s) => s.menuId == item.menuId).fold<int>(0, (s, e) => s + e.qty);
        if (item.qty > sentQty) {
          leftover.add(QueuedItem(menuId: item.menuId, name: item.name, unitPrice: item.unitPrice, qty: item.qty - sentQty));
        }
      }
      final now = DateTime.now();
      if (leftover.isNotEmpty) {
        later.add(OfflineAction(
            id: _newId(now), type: OfflineActionType.addItems, adminTableId: action.adminTableId, createdAt: now, orderId: orderId, items: leftover));
      }
      final roomQty = action.roomChargeQty;
      if (roomQty != null && roomQty != sentRoomQty) {
        later.add(OfflineAction(
            id: _newId(now), type: OfflineActionType.roomCharge, adminTableId: action.adminTableId, createdAt: now, orderId: orderId, roomChargeQty: roomQty));
      }
    }
    actions.replaceRange(i, i + 1, later);
    _changed();
  }

  void fail(OfflineAction action, String error) {
    action.error = error;
    _changed();
  }

  void retry(OfflineAction action) {
    action.error = null;
    _changed();
  }

  /// [server]: the table's order as restoAdmin last showed it. Returns it
  /// with this table's saved changes on top: the saved new order if the
  /// table has none in restoAdmin, plus waiting items (shown with negative
  /// ids, see OrderLineItem.isLocal) and room hours. [roomRate] is the
  /// table's hourly charge.
  OrderSummary? overlay(int adminTableId, OrderSummary? server, double roomRate) {
    var nextLineId = -1;
    List<OrderLineItem> lines(List<QueuedItem> items) => [
          for (final i in items)
            OrderLineItem(
                id: nextLineId--, menuId: i.menuId, name: i.name, quantity: i.qty.toDouble(), unitPrice: i.unitPrice, lineTotal: i.qty * i.unitPrice),
        ];

    final local = localOrderFor(adminTableId);
    if (server == null) {
      if (local == null) return null;
      final items = lines(local.items);
      final service = roomRate > 0 ? (local.roomChargeQty ?? 1) * roomRate : 0.0;
      final subtotal = items.fold<double>(0, (s, i) => s + i.lineTotal);
      return OrderSummary(
        id: local.localOrderId!,
        orderNo: '',
        orderType: local.orderType,
        // Dashboard orders are confirmed as they're created.
        status: 2,
        subtotal: subtotal,
        serviceCharge: service,
        createdAt: local.createdAt.toUtc().toIso8601String(),
        roomRate: roomRate > 0 ? roomRate : null,
        grandTotal: subtotal + service,
        items: items,
      );
    }

    // Waiting for this order: items added to it, and a saved new order that
    // will be added to it when it syncs (the table got an order meanwhile).
    final extra = <QueuedItem>[...?local?.items];
    double? roomQty;
    for (final a in actions) {
      if (a.orderId != server.id) continue;
      if (a.type == OfflineActionType.addItems) extra.addAll(a.items);
      if (a.type == OfflineActionType.roomCharge) roomQty = a.roomChargeQty;
    }
    if (extra.isEmpty && roomQty == null) return server;

    final added = lines(extra);
    var grandTotal = server.grandTotal + added.fold<double>(0, (s, i) => s + i.lineTotal);
    double? service = server.serviceCharge;
    final rate = (server.roomRate ?? 0) > 0 ? server.roomRate! : roomRate;
    if (roomQty != null && rate > 0) {
      // Only the current room's hours change; earlier rooms of a moved order
      // (the rest of the service charge) stay as they were.
      final current = server.roomHours;
      service = current != null ? (server.serviceCharge ?? 0) + (roomQty - current) * rate : roomQty * rate;
      grandTotal += service - (server.serviceCharge ?? 0);
    }
    return server.copyWith(
        items: [...server.items, ...added], serviceCharge: service, roomHours: roomQty, grandTotal: grandTotal);
  }
}
