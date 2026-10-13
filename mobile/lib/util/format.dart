import '../api/models.dart';

/// ₱1,234.50
String peso(double amount) {
  final negative = amount < 0;
  final fixed = amount.abs().toStringAsFixed(2);
  final parts = fixed.split('.');
  final whole = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return '${negative ? '−' : ''}₱$whole.${parts[1]}';
}

/// ₱1,234 (no decimals when whole), for menu prices and rates.
String pesoShort(double amount) {
  if (amount == amount.roundToDouble()) {
    final whole = amount.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
    return '₱$whole';
  }
  return peso(amount);
}

/// 2 -> "2", 1.5 -> "1.5"
String formatQty(double qty) => qty == qty.roundToDouble() ? qty.round().toString() : qty.toString();

String formatItemCount(int count) => '$count item${count == 1 ? '' : 's'}';

const orderTypes = [
  ('DINE_IN', 'Dine In'),
  ('TAKE_OUT', 'Take Out'),
  ('DELIVERY', 'Delivery'),
];

/// Falls back to Dine In for an order whose type isn't known yet (live
/// events don't carry it).
String formatOrderType(String? type) {
  final value = (type == null || type.isEmpty) ? 'DINE_IN' : type;
  for (final (v, label) in orderTypes) {
    if (v == value) return label;
  }
  return value;
}

/// Order items listed before the rest collapse to "+N more".
const maxListedOrderItems = 5;

/// One menu item's lines on an order, shown as a single row. restoAdmin
/// never merges added items into an existing line, so the same item can sit
/// on an order as several lines. id/unitPrice come from the first line;
/// quantity/lineTotal are totals; [lines] keeps the real rows, oldest first.
class OrderLineGroup {
  final int menuId;
  final String name;
  double quantity;
  double lineTotal;
  final List<OrderLineItem> lines;
  OrderLineGroup(this.menuId, this.name, this.quantity, this.lineTotal, this.lines);

  int get id => lines.first.id;
}

List<OrderLineGroup> groupOrderLines(List<OrderLineItem> items) {
  final groups = <int, OrderLineGroup>{};
  for (final it in items) {
    final g = groups[it.menuId];
    if (g != null) {
      g.quantity += it.quantity;
      g.lineTotal += it.lineTotal;
      g.lines.add(it);
    } else {
      groups[it.menuId] = OrderLineGroup(it.menuId, it.name, it.quantity, it.lineTotal, [it]);
    }
  }
  return groups.values.toList();
}

/// A–Z with numbers compared by value, so ROOM 2 comes before ROOM 12.
int naturalCompare(String a, String b) {
  final re = RegExp(r'(\d+)|(\D+)');
  final ta = re.allMatches(a.toLowerCase()).map((m) => m.group(0)!).toList();
  final tb = re.allMatches(b.toLowerCase()).map((m) => m.group(0)!).toList();
  for (var i = 0; i < ta.length && i < tb.length; i++) {
    final na = int.tryParse(ta[i]);
    final nb = int.tryParse(tb[i]);
    final c = (na != null && nb != null) ? na.compareTo(nb) : ta[i].compareTo(tb[i]);
    if (c != 0) return c;
  }
  return ta.length.compareTo(tb.length);
}

int byZoneName(Zone a, Zone b) => naturalCompare(a.name, b.name);

/// Whether a zone is a room: restoAdmin bills it an hourly ROOM_CHARGE.
bool isRoomZone(Zone zone, [double fallbackRate = 0]) => (zone.adminRoomCharge ?? fallbackRate) > 0;

String zoneKindLabel(Zone zone, [double fallbackRate = 0]) => isRoomZone(zone, fallbackRate) ? 'Room' : 'Table';

/// "P1 • Floor 1 • Table"
String formatZoneSubtitle(Zone zone, [double fallbackRate = 0]) =>
    '${zone.name} • Floor ${zone.floor} • ${zoneKindLabel(zone, fallbackRate)}';

const floorLabels = {1: '1st Floor', 2: '2nd Floor'};

String _two(int n) => n.toString().padLeft(2, '0');

/// 1:44 PM
String formatClockTime(DateTime t) {
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${_two(t.minute)} ${t.hour < 12 ? 'AM' : 'PM'}';
}

/// 1:44:22 PM
String formatClockTimeWithSeconds(DateTime t) {
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${_two(t.minute)}:${_two(t.second)} ${t.hour < 12 ? 'AM' : 'PM'}';
}

const _weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const _months = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/// TUESDAY, SEPTEMBER 15
String formatLongDate(DateTime t) => '${_weekdays[t.weekday - 1]}, ${_months[t.month - 1]} ${t.day}';
