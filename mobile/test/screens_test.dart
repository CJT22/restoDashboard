import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:resto_dashboard/api/api_client.dart';
import 'package:resto_dashboard/api/models.dart';
import 'package:resto_dashboard/fullscreen.dart';
import 'package:resto_dashboard/state/dashboard_state.dart';
import 'package:resto_dashboard/theme.dart';
import 'package:resto_dashboard/ui/shell.dart';
import 'package:resto_dashboard/ui/table_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Renders every screen at a landscape tablet size with the real floor layout
// and a few sample orders, so layout overflows and build errors show up
// without a device. Network calls fail in tests; every screen must cope.

OrderSummary _order(int id, {double? roomRate, double? service, List<(String, double, double)> items = const []}) =>
    OrderSummary(
      id: id,
      orderNo: 'ORD-$id',
      orderType: 'DINE_IN',
      status: 2,
      subtotal: 0,
      serviceCharge: service,
      createdAt: DateTime.now().subtract(const Duration(minutes: 50)).toUtc().toIso8601String(),
      roomRate: roomRate,
      grandTotal: items.fold<double>(0, (s, i) => s + i.$2 * i.$3) + (service ?? 0),
      items: [
        for (var i = 0; i < items.length; i++)
          OrderLineItem(id: id * 100 + i, menuId: i + 1, name: items[i].$1, quantity: items[i].$2, unitPrice: items[i].$3, lineTotal: items[i].$2 * items[i].$3),
      ],
    );

Future<DashboardState> _state() async {
  SharedPreferences.setMockInitialValues({'dashboard_base_url': 'http://127.0.0.1:9'});
  final api = await ApiClient.create();
  final json = jsonDecode(File('../src/data/floorLayout.json').readAsStringSync());
  final state = DashboardState(api, FloorLayout.fromJson(json));
  // Sample orders: a room nearly out of time, a long tab, a plain table.
  final rooms = state.zones.where((z) => z.floor == 1).toList();
  rooms[0]
    ..status = TableStatus.occupied
    ..adminRoomCharge = 500
    ..activeOrder = _order(1, roomRate: 500, service: 500, items: [('San Miguel Pale Pilsen', 4, 95), ('Sisig', 1, 320)]);
  rooms[1]
    ..status = TableStatus.occupied
    ..activeOrder = _order(2, items: [
      for (var i = 0; i < 9; i++) ('Item number $i with a long name', 1 + i.toDouble(), 150),
    ]);
  rooms[2].status = TableStatus.reserved;
  state.zones.firstWhere((z) => z.floor == 2)
    ..status = TableStatus.occupied
    ..adminRoomCharge = 800
    ..activeOrder = _order(3, roomRate: 800, service: 800);
  return state;
}

Future<void> _pumpShell(WidgetTester tester, DashboardState state,
    {Size size = const Size(1340, 800), VoidCallback? onSignOut}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildTheme(),
    home: DashboardShell(
      state: state,
      user: const DashboardUser(id: 1, username: 'staff', firstName: 'Test', lastName: 'Staff'),
      fullscreen: FullscreenController(),
      onSignOut: onSignOut ?? () {},
    ),
  ));
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  testWidgets('floor plan, both floors, both sidebar layouts', (tester) async {
    final state = await _state();
    await _pumpShell(tester, state);
    expect(find.text('1st Floor'), findsWidgets);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('2nd Floor').first);
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);

    await tester.tap(find.byTooltip('Collapse sidebar'));
    await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('Expand sidebar'));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('All Tables & Rooms and Active Orders', (tester) async {
    final state = await _state();
    await _pumpShell(tester, state);
    await tester.tap(find.text('All Tables & Rooms'));
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);
    expect(find.text('New Order →'), findsWidgets);

    await tester.tap(find.text('Active Orders').first);
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);
    expect(find.text('View Order →'), findsWidgets);
  });

  testWidgets('order detail dialog', (tester) async {
    final state = await _state();
    await _pumpShell(tester, state);
    final zone = state.zones.firstWhere((z) => z.activeOrder?.id == 2);
    final context = tester.element(find.byType(DashboardShell));
    showDialog<void>(context: context, builder: (_) => TableDetailDialog(state: state, zone: zone));
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);
    expect(find.text('Add Items'), findsOneWidget);
    expect(find.text('Settle'), findsOneWidget);
  });

  testWidgets('small 1024x600 tablet: every view', (tester) async {
    final state = await _state();
    await _pumpShell(tester, state, size: const Size(1024, 600));
    expect(tester.takeException(), isNull);
    for (final tab in ['All Tables & Rooms', 'Active Orders']) {
      await tester.tap(find.text(tab).first);
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull, reason: tab);
    }
    final zone = state.zones.firstWhere((z) => z.activeOrder?.id == 1);
    showDialog<void>(
        context: tester.element(find.byType(DashboardShell)),
        builder: (_) => TableDetailDialog(state: state, zone: zone));
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull, reason: 'detail dialog');
  });

  testWidgets('sign out asks first', (tester) async {
    var signedOut = 0;
    await _pumpShell(tester, await _state(), onSignOut: () => signedOut++);
    final button = find.byTooltip('Sign out Test Staff');
    await tester.tap(button);
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Sign out Test Staff?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(signedOut, 0);
    await tester.tap(button);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Sign out'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(signedOut, 1);
  });

  testWidgets('status chips and sidebar tiles share the filters', (tester) async {
    await _pumpShell(tester, await _state());
    final chip = find.byWidgetPredicate((w) => w is Tooltip && (w.message ?? '').startsWith('Available: '));
    expect(find.text('Filtering: Available Only'), findsNothing);
    await tester.tap(chip);
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Filtering: Available Only'), findsOneWidget);
    // The sidebar's Available tile shows the same state and turns it back off.
    await tester.tap(find.byTooltip('Showing available tables'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byWidgetPredicate((w) => w is Tooltip && w.message == 'Tap to show available'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
