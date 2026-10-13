// Data shapes shared with the web dashboard (src/types.ts) and the JSON the
// dashboard server (server/index.ts) returns. Field meanings match restoAdmin:
// see the comments in src/types.ts for the details.

/// restoAdmin's restaurant_tables.STATUS, as the dashboard names it. The
/// dashboard never sets it; restoAdmin does (order lifecycle, Table Settings).
enum TableStatus { available, occupied, reserved, unavailable }

TableStatus statusFromAdmin(num? status) {
  switch (status?.toInt()) {
    case 0:
      return TableStatus.unavailable;
    case 2:
      return TableStatus.occupied;
    case 3:
      return TableStatus.reserved;
    default:
      return TableStatus.available;
  }
}

double _d(dynamic v, [double fallback = 0]) {
  if (v == null) return fallback;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString()) ?? fallback;
}

double? _dOrNull(dynamic v) => v == null ? null : _d(v);

int _i(dynamic v, [int fallback = 0]) {
  if (v == null) return fallback;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString()) ?? fallback;
}

class OrderLineItem {
  final int id; // order_items.IDNo
  final int menuId;
  final String name;
  final double quantity;
  final double unitPrice;
  final double lineTotal;

  const OrderLineItem({
    required this.id,
    required this.menuId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
  });

  /// A row from the server's REST order shape (mapAdminOrderItem).
  factory OrderLineItem.fromApi(Map<String, dynamic> row) => OrderLineItem(
        id: _i(row['id']),
        menuId: _i(row['menuId']),
        name: (row['menuName'] ?? '').toString(),
        quantity: _d(row['qty']),
        unitPrice: _d(row['unitPrice']),
        lineTotal: _d(row['lineTotal']),
      );

  /// A row from a live order_created/order_updated event (restoAdmin's raw
  /// column names).
  factory OrderLineItem.fromEvent(Map<String, dynamic> row) => OrderLineItem(
        id: _i(row['IDNo']),
        menuId: _i(row['MENU_ID']),
        name: (row['MENU_NAME'] ?? '').toString(),
        quantity: _d(row['QTY']),
        unitPrice: _d(row['UNIT_PRICE']),
        lineTotal: _d(row['LINE_TOTAL']),
      );
}

/// A zone's open order, from restoAdmin. Status: 3=Pending, 2=Confirmed,
/// 1=Settled, -1=Cancelled.
class OrderSummary {
  final int id;
  final String orderNo;
  final String? orderType;
  final int status;
  final double subtotal;
  // Includes the linked table's room charge; can be missing from a live event.
  final double? serviceCharge;
  final String? createdAt;
  // The table's hourly ROOM_CHARGE at fetch time (0/null = not an hourly room).
  final double? roomRate;
  final double grandTotal;
  final List<OrderLineItem> items;

  const OrderSummary({
    required this.id,
    required this.orderNo,
    required this.orderType,
    required this.status,
    required this.subtotal,
    required this.serviceCharge,
    required this.createdAt,
    required this.roomRate,
    required this.grandTotal,
    required this.items,
  });

  factory OrderSummary.fromApi(Map<String, dynamic> row) => OrderSummary(
        id: _i(row['id']),
        orderNo: (row['orderNo'] ?? '').toString(),
        orderType: row['orderType']?.toString(),
        status: _i(row['status']),
        subtotal: _d(row['subtotal']),
        serviceCharge: _dOrNull(row['serviceCharge']),
        createdAt: row['createdAt']?.toString(),
        roomRate: _dOrNull(row['roomRate']),
        grandTotal: _d(row['grandTotal']),
        items: (row['items'] is List)
            ? (row['items'] as List).map((e) => OrderLineItem.fromApi(Map<String, dynamic>.from(e))).toList()
            : const [],
      );

  OrderSummary copyWith({int? status, double? roomRate}) => OrderSummary(
        id: id,
        orderNo: orderNo,
        orderType: orderType,
        status: status ?? this.status,
        subtotal: subtotal,
        serviceCharge: serviceCharge,
        createdAt: createdAt,
        roomRate: roomRate ?? this.roomRate,
        grandTotal: grandTotal,
        items: items,
      );

  bool get isActive => status == 2 || status == 3;
}

/// A table or room on the floor plan: its fixed geometry and restoAdmin link
/// from floorLayout.json, plus live status and order from restoAdmin.
class Zone {
  final String id;
  final String name;
  final String code;
  final int floor; // 1 or 2
  final int? adminTableId;
  final String? adminTableName;
  // Percentages (0-100) of the 16:9 floor plan frame.
  final double x, y, width, height;

  TableStatus status;
  OrderSummary? activeOrder;
  double? adminRoomCharge;

  Zone({
    required this.id,
    required this.name,
    required this.code,
    required this.floor,
    required this.adminTableId,
    required this.adminTableName,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.status = TableStatus.available,
    this.activeOrder,
    this.adminRoomCharge,
  });

  factory Zone.fromLayout(Map<String, dynamic> j) => Zone(
        id: j['id'].toString(),
        name: (j['name'] ?? '').toString(),
        code: (j['code'] ?? '').toString(),
        floor: _i(j['floor'], 1),
        adminTableId: j['adminTableId'] == null ? null : _i(j['adminTableId']),
        adminTableName: j['adminTableName']?.toString(),
        x: _d(j['x']),
        y: _d(j['y']),
        width: _d(j['width']),
        height: _d(j['height']),
      );

  bool get hasActiveOrder => activeOrder?.isActive ?? false;
}

enum InfoWidgetType { roomTimers, activeOrders, totalSales, occupancy }

InfoWidgetType? _widgetType(String s) {
  for (final t in InfoWidgetType.values) {
    if (t.name == s) return t;
  }
  return null;
}

/// Which floor(s) a widget lists: 1, 2, or both (null).
typedef FloorScope = int?;

/// A read-only widget panel placed on the floor plan (floorLayout.json).
class InfoPanel {
  final String id;
  final int floor;
  final List<InfoWidgetType> widgets;
  final String layout; // auto | stack | row
  final Map<InfoWidgetType, FloorScope> widgetFloors;
  final double x, y, width, height;

  const InfoPanel({
    required this.id,
    required this.floor,
    required this.widgets,
    required this.layout,
    required this.widgetFloors,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  factory InfoPanel.fromLayout(Map<String, dynamic> j) {
    final floors = <InfoWidgetType, FloorScope>{};
    final raw = j['widgetFloors'];
    if (raw is Map) {
      raw.forEach((key, value) {
        final type = _widgetType(key.toString());
        if (type != null) floors[type] = value == 'all' ? null : _i(value, 1);
      });
    }
    return InfoPanel(
      id: j['id'].toString(),
      floor: _i(j['floor'], 1),
      widgets: (j['widgets'] as List? ?? []).map((w) => _widgetType(w.toString())).whereType<InfoWidgetType>().toList(),
      layout: (j['layout'] ?? 'auto').toString(),
      widgetFloors: floors,
      x: _d(j['x']),
      y: _d(j['y']),
      width: _d(j['width']),
      height: _d(j['height']),
    );
  }

  FloorScope startingScope(InfoWidgetType type) => widgetFloors.containsKey(type) ? widgetFloors[type] : floor;
}

class FloorLayout {
  final List<Map<String, dynamic>> zones;
  final List<InfoPanel> panels;
  const FloorLayout(this.zones, this.panels);

  factory FloorLayout.fromJson(Map<String, dynamic> j) => FloorLayout(
        (j['zones'] as List? ?? []).map((e) => Map<String, dynamic>.from(e)).toList(),
        (j['panels'] as List? ?? []).map((e) => InfoPanel.fromLayout(Map<String, dynamic>.from(e))).toList(),
      );
}

class AdminTable {
  final int id;
  final String tableNumber;
  final double? roomCharge;
  final int status;
  const AdminTable({required this.id, required this.tableNumber, required this.roomCharge, required this.status});

  factory AdminTable.fromJson(Map<String, dynamic> j) => AdminTable(
        id: _i(j['id']),
        tableNumber: (j['tableNumber'] ?? '').toString(),
        roomCharge: _dOrNull(j['roomCharge']),
        status: _i(j['status'], 1),
      );
}

class DashboardUser {
  final int id;
  final String username;
  final String firstName;
  final String lastName;
  const DashboardUser({required this.id, required this.username, required this.firstName, required this.lastName});

  factory DashboardUser.fromJson(Map<String, dynamic> j) => DashboardUser(
        id: _i(j['id']),
        username: (j['username'] ?? '').toString(),
        firstName: (j['firstName'] ?? '').toString(),
        lastName: (j['lastName'] ?? '').toString(),
      );

  String get displayName {
    final full = '$firstName $lastName'.trim();
    return full.isEmpty ? username : full;
  }
}

class MenuItem {
  final int id;
  final String name;
  final double price;
  final String categoryName;
  const MenuItem({required this.id, required this.name, required this.price, required this.categoryName});

  factory MenuItem.fromJson(Map<String, dynamic> j) => MenuItem(
        id: _i(j['id']),
        name: (j['name'] ?? '').toString(),
        price: _d(j['price']),
        categoryName: (j['categoryName'] ?? '').toString(),
      );
}

class MenuPopularity {
  final int menuId;
  final double qty;
  final double revenue;
  const MenuPopularity(this.menuId, this.qty, this.revenue);

  factory MenuPopularity.fromJson(Map<String, dynamic> j) =>
      MenuPopularity(_i(j['menuId']), _d(j['qty']), _d(j['revenue']));
}

class Billing {
  final String paymentMethod;
  final double amountDue;
  final double amountPaid;
  const Billing({required this.paymentMethod, required this.amountDue, required this.amountPaid});

  factory Billing.fromJson(Map<String, dynamic> j) => Billing(
        paymentMethod: (j['paymentMethod'] ?? '').toString(),
        amountDue: _d(j['amountDue']),
        amountPaid: _d(j['amountPaid']),
      );
}

class SalesSummary {
  final String period;
  final double totalPaid;
  final int paidCount;
  const SalesSummary(this.period, this.totalPaid, this.paidCount);

  factory SalesSummary.fromJson(Map<String, dynamic> j) =>
      SalesSummary((j['period'] ?? '').toString(), _d(j['totalPaid']), _i(j['paidCount']));
}

/// The flat result shape of the server's order mutations (see
/// server/adminClient.ts): ok, plus kind/message/insufficient on failure.
class MutationResult {
  final bool ok;
  final String? kind; // conflict | insufficient | error
  final String? message;
  final int? existingOrderId;
  final List<Map<String, dynamic>> insufficient;

  const MutationResult({required this.ok, this.kind, this.message, this.existingOrderId, this.insufficient = const []});

  factory MutationResult.fromJson(Map<String, dynamic> j) => MutationResult(
        ok: j['ok'] == true,
        kind: j['kind']?.toString(),
        message: (j['message'] ?? j['error'])?.toString(),
        existingOrderId: j['existingOrderId'] == null ? null : _i(j['existingOrderId']),
        insufficient: (j['insufficient'] is List)
            ? (j['insufficient'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList()
            : const [],
      );
}

/// A live order_created/order_updated event.
class OrderEvent {
  final int orderId;
  final int? tableId;
  final int? status;
  final String? orderNo;
  final double? grandTotal;
  final double? serviceCharge;
  final double? roomRate;
  final String? createdAt;
  final List<OrderLineItem> items;

  const OrderEvent({
    required this.orderId,
    required this.tableId,
    required this.status,
    required this.orderNo,
    required this.grandTotal,
    required this.serviceCharge,
    required this.roomRate,
    required this.createdAt,
    required this.items,
  });

  factory OrderEvent.fromJson(Map<String, dynamic> j) => OrderEvent(
        orderId: _i(j['orderId']),
        tableId: j['tableId'] == null ? null : _i(j['tableId']),
        status: j['status'] == null ? null : _i(j['status']),
        orderNo: j['orderNo']?.toString(),
        grandTotal: _dOrNull(j['grandTotal']),
        serviceCharge: _dOrNull(j['serviceCharge']),
        roomRate: _dOrNull(j['roomRate']),
        createdAt: j['createdAt']?.toString(),
        items: (j['items'] is List)
            ? (j['items'] as List).map((e) => OrderLineItem.fromEvent(Map<String, dynamic>.from(e))).toList()
            : const [],
      );
}
