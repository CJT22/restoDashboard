import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// Why the app went back to the sign-in page, shown above the form.
enum SignedOutReason { sessionReplaced, sessionExpired, unauthenticated }

const signedOutMessages = {
  SignedOutReason.sessionReplaced: 'This account signed in on another device, so it was signed out here.',
  SignedOutReason.sessionExpired: 'Your session expired. Please sign in again.',
  SignedOutReason.unauthenticated: 'You were signed out. Please sign in again.',
};

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

/// Talks to the dashboard server the same way the web dashboard does: its
/// /api routes, as the signed-in user. The server gives each sign-in an
/// opaque session id in its `rd_session` cookie; a browser keeps that cookie
/// by itself, so here it's stored and sent by hand.
///
/// [baseUrl] is the dashboard's web address (e.g. http://192.168.1.10:3500
/// locally, or the server's :2520), which proxies /api to the Node server and
/// also serves the floor plan images.
///
/// Each build carries its own address (`config/<flavor>.json`), so staff never
/// type it. A technician can override it from the sign-in page; only a build
/// without one (prod until its server is set) asks for it there.
class ApiClient {
  static const _prefsBaseUrl = 'dashboard_base_url';
  static const _prefsOverride = 'dashboard_base_url_override';
  static const _prefsSession = 'dashboard_session';
  static const _cookieName = 'rd_session';

  /// The build's address, from `--dart-define-from-file=config/<flavor>.json`.
  static final builtInBaseUrl = cleanBaseUrl(const String.fromEnvironment('DASHBOARD_URL'));

  final SharedPreferences _prefs;
  final http.Client _http = http.Client();

  String? _override;
  String _entered;
  String? _sessionId;

  final _signedOut = StreamController<SignedOutReason>.broadcast();

  /// Fires whenever a call finds the session gone (signed out elsewhere,
  /// expired, or the account signed in on another device).
  Stream<SignedOutReason> get signedOut => _signedOut.stream;

  ApiClient._(this._prefs)
      : _override = _prefs.getString(_prefsOverride),
        _entered = _prefs.getString(_prefsBaseUrl) ?? '',
        _sessionId = _prefs.getString(_prefsSession);

  static Future<ApiClient> create() async => ApiClient._(await SharedPreferences.getInstance());

  static bool get hasBuiltInBaseUrl => builtInBaseUrl.isNotEmpty;

  /// Which build this is (prod, dev or local), from the same config file.
  static const appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'prod');

  String get baseUrl => _override ?? (hasBuiltInBaseUrl ? builtInBaseUrl : _entered);
  bool get isOverridden => _override != null;
  bool get hasSession => _sessionId != null;

  static String cleanBaseUrl(String url) {
    var cleaned = url.trim();
    while (cleaned.endsWith('/')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }
    if (cleaned.isNotEmpty && !cleaned.contains('://')) cleaned = 'http://$cleaned';
    return cleaned;
  }

  /// The address typed on the sign-in page, for a build without its own.
  Future<void> setBaseUrl(String url) async {
    _entered = cleanBaseUrl(url);
    await _prefs.setString(_prefsBaseUrl, _entered);
  }

  /// A technician's replacement for the build's address; null or the
  /// built-in address itself goes back to the built-in one.
  Future<void> setOverride(String? url) async {
    final cleaned = url == null ? '' : cleanBaseUrl(url);
    if (cleaned.isEmpty || cleaned == builtInBaseUrl) {
      _override = null;
      await _prefs.remove(_prefsOverride);
    } else {
      _override = cleaned;
      await _prefs.setString(_prefsOverride, cleaned);
    }
  }

  Uri uri(String path) => Uri.parse('$baseUrl$path');

  Map<String, String> get authHeaders => {if (_sessionId != null) 'Cookie': '$_cookieName=$_sessionId'};

  // Keeps whatever session id the server last set (sign-in, the renewal on
  // /api/auth/me, or the clearing on sign-out).
  void _captureCookie(http.BaseResponse res) {
    final header = res.headers['set-cookie'];
    if (header == null) return;
    final match = RegExp('$_cookieName=([^;]*)').firstMatch(header);
    if (match == null) return;
    final value = Uri.decodeComponent(match.group(1)!);
    _setSession(value.isEmpty ? null : value);
  }

  void _setSession(String? id) {
    _sessionId = id;
    if (id == null) {
      _prefs.remove(_prefsSession);
    } else {
      _prefs.setString(_prefsSession, id);
    }
  }

  void clearSession() => _setSession(null);

  /// Reports a 401 from an /api/admin call as a sign-out.
  void reportSignedOut(Map<String, dynamic> json) {
    final code = json['code'];
    _signedOut.add(code == 'SESSION_REPLACED'
        ? SignedOutReason.sessionReplaced
        : code == 'SESSION_EXPIRED'
            ? SignedOutReason.sessionExpired
            : SignedOutReason.unauthenticated);
  }

  Future<(int, Map<String, dynamic>)> _send(String method, String path, {Object? body}) async {
    if (baseUrl.isEmpty) throw ApiException('Set the dashboard address first.');
    final req = http.Request(method, uri(path));
    req.headers.addAll(authHeaders);
    if (body != null) {
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    final http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
    } on TimeoutException {
      throw ApiException("The dashboard server didn't answer. Check the connection and try again.");
    } catch (_) {
      throw ApiException("Can't reach the dashboard server. Check the connection and try again.");
    }
    _captureCookie(res);
    Map<String, dynamic> json = {};
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is Map) json = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (res.statusCode == 401 && path.startsWith('/api/admin')) reportSignedOut(json);
    return (res.statusCode, json);
  }

  // For reads: the `data` field, or an exception with the server's message.
  Future<dynamic> _getData(String path, String fallbackMessage) async {
    final (status, json) = await _send('GET', path);
    if (status < 200 || status >= 300 || json['success'] == false) {
      throw ApiException((json['error'] ?? json['message'] ?? fallbackMessage).toString());
    }
    return json['data'];
  }

  // For order mutations, whose answers are the flat {ok, kind, message} shape.
  Future<MutationResult> _mutate(String method, String path, [Object? body]) async {
    final (_, json) = await _send(method, path, body: body);
    if (json.isEmpty) return const MutationResult(ok: false, message: 'No answer from the dashboard server');
    return MutationResult.fromJson(json);
  }

  // ---- Auth (server/auth.ts) ----

  /// The signed-in user, or null if not signed in. Throws if unreachable.
  Future<DashboardUser?> currentUser() async {
    if (_sessionId == null) return null;
    final (status, json) = await _send('GET', '/api/auth/me');
    if (status != 200 || json['success'] != true) {
      throw ApiException((json['error'] ?? "Can't reach the dashboard server.").toString());
    }
    final data = json['data'];
    if (data == null) {
      clearSession();
      return null;
    }
    return DashboardUser.fromJson(Map<String, dynamic>.from(data));
  }

  Future<DashboardUser> signIn(String username, String password) async {
    final (status, json) = await _send('POST', '/api/auth/login', body: {'username': username, 'password': password});
    if (status != 200 || json['success'] != true) {
      throw ApiException((json['error'] ?? 'Sign-in failed. Please try again.').toString());
    }
    return DashboardUser.fromJson(Map<String, dynamic>.from(json['data']));
  }

  Future<void> signOut() async {
    try {
      await _send('POST', '/api/auth/logout');
    } catch (_) {}
    clearSession();
  }

  // ---- Floor layout ----

  Future<FloorLayout> layout() async =>
      FloorLayout.fromJson(Map<String, dynamic>.from(await _getData('/api/layout', 'Failed to load the floor plan')));

  String floorPlanImageUrl(int floor) => '$baseUrl/floorplans/${floor == 1 ? 'first' : 'second'}_floor.webp';

  // ---- Tables & orders (server/index.ts /api/admin/*) ----

  Future<List<AdminTable>> adminTables() async {
    final data = await _getData('/api/admin/tables', 'Failed to load Blue Moon tables from restoAdmin');
    return (data as List? ?? []).map((e) => AdminTable.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<double> roomChargeRate(int adminTableId) async {
    final tables = await adminTables();
    for (final t in tables) {
      if (t.id == adminTableId) return t.roomCharge ?? 0;
    }
    return 0;
  }

  Future<OrderSummary?> activeOrderForTable(int adminTableId) async {
    final data = await _getData('/api/admin/orders/by-table/$adminTableId', 'Failed to load the active order from restoAdmin');
    return data == null ? null : OrderSummary.fromApi(Map<String, dynamic>.from(data));
  }

  /// Every open order in the branch, by restoAdmin table id.
  Future<Map<int, OrderSummary>> activeOrders() async {
    final data = await _getData('/api/admin/orders/active', 'Failed to load active orders from restoAdmin');
    final result = <int, OrderSummary>{};
    for (final row in (data as List? ?? [])) {
      final map = Map<String, dynamic>.from(row);
      if (map['tableId'] == null) continue;
      result[(map['tableId'] as num).toInt()] = OrderSummary.fromApi(map);
    }
    return result;
  }

  Future<List<MenuItem>> menu() async {
    final data = await _getData('/api/admin/menu', 'Failed to load the menu from restoAdmin');
    return (data as List? ?? []).map((e) => MenuItem.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<List<MenuPopularity>> menuPopularity() async {
    final data = await _getData('/api/admin/menu/popularity', 'Failed to load top revenue items from restoAdmin');
    return (data as List? ?? []).map((e) => MenuPopularity.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<SalesSummary> sales(String period) async => SalesSummary.fromJson(
      Map<String, dynamic>.from(await _getData('/api/admin/sales?period=$period', 'Failed to load sales from restoAdmin')));

  Future<MutationResult> createOrder(int adminTableId, String orderType, List<Map<String, num>> items, double? roomChargeQty) =>
      _mutate('POST', '/api/admin/orders', {
        'tableId': adminTableId,
        'orderType': orderType,
        'items': items,
        'roomChargeQty': ?roomChargeQty,
      });

  Future<MutationResult> addItems(int orderId, List<Map<String, num>> items) =>
      _mutate('POST', '/api/admin/orders/$orderId/items', {'items': items});

  Future<MutationResult> updateRoomCharge(int orderId, double roomChargeQty) =>
      _mutate('PATCH', '/api/admin/orders/$orderId/room-charge', {'roomChargeQty': roomChargeQty});

  Future<MutationResult> confirmOrder(int orderId) => _mutate('PATCH', '/api/admin/orders/$orderId/status', {'status': 2});

  Future<MutationResult> cancelOrder(int orderId) => _mutate('PATCH', '/api/admin/orders/$orderId/status', {'status': -1});

  Future<MutationResult> updateItemQty(int orderItemId, double qty) =>
      _mutate('PUT', '/api/admin/order-items/$orderItemId', {'qty': qty});

  Future<MutationResult> deleteItem(int orderItemId) => _mutate('DELETE', '/api/admin/order-items/$orderItemId');

  Future<Billing?> billing(int orderId) async {
    final data = await _getData('/api/admin/orders/$orderId/billing', 'Failed to load the billing record from restoAdmin');
    return data == null ? null : Billing.fromJson(Map<String, dynamic>.from(data));
  }

  Future<MutationResult> settleOrder(int orderId, String paymentMethod, double amountPaid, String? paymentRef) =>
      _mutate('PUT', '/api/admin/orders/$orderId/settle', {
        'paymentMethod': paymentMethod,
        'amountPaid': amountPaid,
        'paymentRef': paymentRef,
      });

  /// Opens the live event stream (server-sent events) on [client], which the
  /// caller closes to end it. See live_stream.dart.
  Future<http.StreamedResponse> openStream(http.Client client) {
    final req = http.Request('GET', uri('/api/admin/stream'));
    req.headers.addAll(authHeaders);
    req.headers['Accept'] = 'text/event-stream';
    req.headers['Cache-Control'] = 'no-cache';
    return client.send(req);
  }
}
