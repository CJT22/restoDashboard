import 'package:flutter_test/flutter_test.dart';
import 'package:resto_dashboard/api/models.dart';
import 'package:resto_dashboard/util/room_timer.dart';

// Booked room hours and the countdown (util/room_timer.dart, same rules as
// src/utils/roomTimer.ts), including a room whose charge was waived.

OrderSummary _order(double serviceCharge) => OrderSummary(
      id: 1,
      orderNo: 'ORD-1',
      orderType: 'DINE_IN',
      status: 2,
      subtotal: 500,
      serviceCharge: serviceCharge,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      roomRate: 1500,
      grandTotal: 500 + serviceCharge,
      items: const [],
    );

void main() {
  test('booked hours follow the service charge, to the half hour', () {
    expect(bookedHours(3000, 1500), 2);
    expect(bookedHours(2250, 1500), 1.5);
  });

  test('a waived room has 0 hours and no countdown', () {
    expect(bookedHours(0, 1500), 0);
    expect(getRoomTiming(_order(0), DateTime.now()), isNull);
  });

  test('a booked room counts down', () {
    final t = getRoomTiming(_order(1500), DateTime.now());
    expect(t?.hours, 1);
    expect(t?.expired, isFalse);
  });
}
