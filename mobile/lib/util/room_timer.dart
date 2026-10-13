import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';

/// Countdown for an hourly room's booking (the linked table has a
/// ROOM_CHARGE), derived purely from what restoAdmin stores. Booked hours =
/// SERVICE_CHARGE / rate; the booking ends at order creation + booked hours.
/// Same rules as the web dashboard's src/utils/roomTimer.ts.
class RoomTiming {
  final double hours;
  final DateTime start;
  final DateTime end;
  final Duration remaining; // negative once expired = overtime
  const RoomTiming(this.hours, this.start, this.end, this.remaining);

  bool get expired => remaining <= Duration.zero;
}

const endingSoon = Duration(minutes: 15);

RoomTiming? getRoomTiming(OrderSummary? order, DateTime now, {double fallbackRate = 0}) {
  final rate = (order?.roomRate ?? 0) > 0 ? order!.roomRate! : fallbackRate;
  // Without SERVICE_CHARGE the booked hours are unknown: show nothing rather
  // than a countdown that might be wrong.
  if (order?.createdAt == null || rate <= 0 || order!.serviceCharge == null) return null;
  final start = DateTime.tryParse(order.createdAt!);
  if (start == null) return null;
  final hours = bookedHours(order.serviceCharge!, rate);
  final end = start.add(Duration(milliseconds: (hours * 3600000).round()));
  return RoomTiming(hours, start.toLocal(), end.toLocal(), end.difference(now));
}

/// Booked hours from a service charge and hourly rate, to the half hour, 1h minimum.
double bookedHours(double serviceCharge, double rate) {
  if (rate <= 0) return 0;
  final hours = ((serviceCharge / rate) * 2).round() / 2;
  return hours < 1 ? 1 : hours;
}

enum TimerTone { normal, endingSoon, expired }

TimerTone timerTone(RoomTiming t) {
  if (t.expired) return TimerTone.expired;
  return t.remaining <= endingSoon ? TimerTone.endingSoon : TimerTone.normal;
}

Color timerColor(RoomTiming t) => switch (timerTone(t)) {
      TimerTone.normal => Colors.white,
      TimerTone.endingSoon => AppColors.yellow300,
      TimerTone.expired => AppColors.rose400,
    };

/// h:mm:ss, e.g. 1:05:09.
String formatDuration(Duration d) {
  final totalSec = d.inSeconds.abs();
  final h = totalSec ~/ 3600;
  final m = (totalSec % 3600) ~/ 60;
  final s = totalSec % 60;
  return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
}

/// Coarse "how long ago": "just now", "12m", "1h 05m".
String formatWait(Duration d) {
  final totalMin = d.isNegative ? 0 : d.inMinutes;
  if (totalMin < 1) return 'just now';
  if (totalMin < 60) return '${totalMin}m';
  return '${totalMin ~/ 60}h ${(totalMin % 60).toString().padLeft(2, '0')}m';
}

/// 2 -> "2h", 1.5 -> "1.5h"
String formatHours(double hours) => hours == hours.roundToDouble() ? '${hours.round()}h' : '${hours.toStringAsFixed(1)}h';

/// "45m left" or "Expired · 0:12:30 over"
String timerSummary(RoomTiming t) =>
    t.expired ? 'Expired · ${formatDuration(t.remaining)} over' : '${formatDuration(t.remaining)} left';
