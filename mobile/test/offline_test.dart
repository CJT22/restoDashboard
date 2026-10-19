import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resto_dashboard/api/api_client.dart';
import 'package:resto_dashboard/api/live_stream.dart';
import 'package:resto_dashboard/api/models.dart';
import 'package:resto_dashboard/state/dashboard_state.dart';
import 'package:resto_dashboard/state/offline_queue.dart';
import 'package:resto_dashboard/theme.dart';
import 'package:resto_dashboard/ui/shell.dart';
import 'package:resto_dashboard/ui/table_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Order changes saved on the tablet while restoAdmin can't be reached
// (state/offline_queue.dart) and how the floor shows them.

const _beer = QueuedItem(menuId: 7, name: 'San Miguel Pale Pilsen', unitPrice: 95, qty: 2);
const _sisig = QueuedItem(menuId: 9, name: 'Sisig', unitPrice: 320, qty: 1);

OrderSummary _serverOrder({double? service, double? rate}) => OrderSummary(
      id: 41,
      orderNo: 'ORD-41',
      orderType: 'DINE_IN',
      status: 2,
      subtotal: 320,
      serviceCharge: service,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      roomRate: rate,
      grandTotal: 320 + (service ?? 0),
      items: const [OrderLineItem(id: 5, menuId: 9, name: 'Sisig', quantity: 1, unitPrice: 320, lineTotal: 320)],
    );

Future<OfflineQueue> _queue([Map<String, Object> prefs = const {}]) async {
  SharedPreferences.setMockInitialValues(prefs);
  return OfflineQueue(await SharedPreferences.getInstance());
}

Future<DashboardState> _offlineState() async {
  SharedPreferences.setMockInitialValues({});
  final api = await ApiClient.create();
  final json = jsonDecode(File('../src/data/floorLayout.json').readAsStringSync());
  return DashboardState(api, FloorLayout.fromJson(json))..connection = ConnectionStatus.offline;
}

void main() {
  test('a saved order takes later items and room hours as one create', () async {
    final q = await _queue();
    final at = DateTime(2026, 10, 19, 20, 15);
    q.queueCreate(12, 'DINE_IN', [_beer], 1, at);
    final localId = q.localOrderFor(12)!.localOrderId!;
    expect(localId, isNegative);

    q.queueAddItems(12, localId, [_beer, _sisig]);
    q.queueRoomCharge(12, localId, 2.5);

    expect(q.actions, hasLength(1));
    final create = q.actions.single;
    expect([for (final i in create.items) (i.menuId, i.qty)], [(7, 4), (9, 1)]);
    expect(create.roomChargeQty, 2.5);

    final order = q.overlay(12, null, 500)!;
    expect(order.isLocal, isTrue);
    expect(order.subtotal, 4 * 95 + 320);
    expect(order.serviceCharge, 2.5 * 500);
    expect(order.grandTotal, 4 * 95 + 320 + 1250);
    expect(order.items.every((i) => i.isLocal), isTrue);
    expect(DateTime.parse(order.createdAt!).isAtSameMomentAs(at), isTrue);
  });

  test("changes to restoAdmin's order show on top of it", () async {
    final q = await _queue();
    final server = _serverOrder(service: 500, rate: 500);
    q.queueAddItems(12, server.id, [_beer]);
    q.queueAddItems(12, server.id, [_beer]);
    q.queueRoomCharge(12, server.id, 1.5);
    q.queueRoomCharge(12, server.id, 2);

    // Repeat changes to one order fold together: one add, the latest hours.
    expect(q.actions.map((a) => a.type), [OfflineActionType.addItems, OfflineActionType.roomCharge]);
    final order = q.overlay(12, server, 500)!;
    expect(order.id, 41);
    expect(order.items, hasLength(2));
    expect(order.items.last.quantity, 4);
    expect(order.serviceCharge, 1000);
    expect(order.grandTotal, 320 + 4 * 95 + 1000);
    // Other orders are untouched.
    final other = _serverOrder().copyWith(status: 3);
    expect(q.overlay(13, OrderSummary.fromApi({...other.toJson(), 'id': 42}), 500)!.items, hasLength(1));
  });

  test('what staff add while a change is on its way is kept', () async {
    final q = await _queue();
    q.queueCreate(12, 'DINE_IN', [_beer], 1, DateTime.now());
    final create = q.actions.single;
    final sentItems = [...create.items];
    final sentRoom = create.roomChargeQty;
    // Added to the saved order while its create is being sent.
    q.queueAddItems(12, create.localOrderId!, [_sisig, _beer]);
    q.queueRoomCharge(12, create.localOrderId!, 2);

    q.sent(create, 41, sentItems, sentRoom);

    expect(q.actions.map((a) => a.type), [OfflineActionType.addItems, OfflineActionType.roomCharge]);
    expect(q.actions.every((a) => a.orderId == 41), isTrue);
    expect([for (final i in q.actions.first.items) (i.menuId, i.qty)], [(7, 2), (9, 1)]);
    expect(q.actions.last.roomChargeQty, 2);
  });

  test('the queue survives the app closing', () async {
    final q = await _queue();
    q.queueCreate(12, 'TAKE_OUT', [_beer], null, DateTime.utc(2026, 10, 19, 12));
    q.queueAddItems(14, 41, [_sisig]);
    q.fail(q.actions.last, 'Not enough stock');

    final saved = (await SharedPreferences.getInstance()).getString('offline_queue')!;
    final again = await _queue({'offline_queue': saved});
    expect(again.actions, hasLength(2));
    expect(again.actions.first.orderType, 'TAKE_OUT');
    expect(again.actions.first.createdAt, DateTime.utc(2026, 10, 19, 12));
    expect(again.actions.last.error, 'Not enough stock');
    expect(again.hasSendable, isTrue);
    expect(again.failedCount, 1);
  });

  test('offline, a new order is saved and the table shows it', () async {
    final state = await _offlineState();
    final zone = state.zones.firstWhere((z) => z.adminTableId != null);
    zone.adminRoomCharge = 500;

    final r = await state.createOrder(zone, 'DINE_IN', [_beer], 1);
    expect(r.ok && r.queued, isTrue);
    expect(zone.activeOrder?.isLocal, isTrue);
    expect(zone.status, TableStatus.occupied);
    expect(zone.unsynced, isTrue);
    expect(zone.activeOrder!.grandTotal, 2 * 95 + 500);

    await state.addItems(zone, zone.activeOrder!, [_sisig]);
    await state.updateRoomCharge(zone, zone.activeOrder!, 2);
    expect(state.offline.actions, hasLength(1));
    expect(zone.activeOrder!.grandTotal, 2 * 95 + 320 + 1000);

    state.discard(state.offline.actions.single);
    expect(zone.activeOrder, isNull);
    expect(zone.unsynced, isFalse);
  });

  testWidgets('saved changes in the sidebar and an offline order dialog', (tester) async {
    final state = await _offlineState();
    final zone = state.zones.firstWhere((z) => z.adminTableId != null && z.floor == 1);
    await state.createOrder(zone, 'DINE_IN', [_beer, _sisig], null);
    state.offline.queueAddItems(9999, 77, [_beer]);
    state.offline.fail(state.offline.actions.last, 'Not enough stock in restoAdmin: Beer.');

    tester.view.physicalSize = const Size(1024, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(),
      home: DashboardShell(
          state: state, user: const DashboardUser(id: 1, username: 's', firstName: 'Test', lastName: 'Staff'), onSignOut: () {}),
    ));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.byTooltip('2 changes saved on this tablet'), findsOneWidget);
    await tester.tap(find.byTooltip('Expand sidebar'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('2 changes saved on this tablet'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);

    showDialog<void>(
        context: tester.element(find.byType(DashboardShell)), builder: (_) => TableDetailDialog(state: state, zone: zone));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('NOT SYNCED'), findsWidgets);
    expect(find.textContaining('Settling, cancelling and editing items need a connection'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
