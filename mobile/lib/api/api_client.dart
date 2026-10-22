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
  // The server couldn't be reached (or didn't answer), as opposed to
  // answering with an error.
  final bool network;
  ApiException(this.message, {this.network = false});
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
/// Each build carries its own address (`config/<flavor>.json`) and it can't
/// be changed on the tablet. A build without one (prod until its server is
/// set) can't sign in.
class ApiClient {
  // Addresses an older version let staff type or a technician override.
  // Nothing reads them anymore; cleared on start.
  static const _legacyPrefs = ['dashboard_base_url', 'dashboard_base_url_override'];
  static const _prefsSession = 'dashboard_session';
  static const _cookieName = 'rd_session';
  // Last good copies of what the app needs to start and take orders with no
  // connection (see offline_queue.dart).
  static const _prefsCachedUser = 'cached_user';
  static const _prefsCachedLayout = 'cached_layout';
  static const _prefsCachedMenu = 'cached_menu';
  static const _prefsCachedPopularity = 'cached_menu_popularity';

  /// The build's address, from `--dart-define-from-file=config/<flavor>.json`.
  static final builtInBaseUrl = cleanBaseUrl(const String.fromEnvironment('DASHBOARD_URL'));

  final SharedPreferences _prefs;
  final http.Client _http = http.Client();

  String? _sessionId;

  final _signedOut = StreamController<SignedOutReason>.broadcast();

  /// Fires whenever a call finds the session gone (signed out elsewhere,
  /// expired, or the account signed in on another device).
  Stream<SignedOutReason> get signedOut => _signedOut.stream;

  ApiClient._(this._prefs) : _sessionId = _prefs.getString(_prefsSession) {
    for (final key in _legacyPrefs) {
      _prefs.remove(key);
    }
  }

  static Future<ApiClient> create() async => ApiClient._(await SharedPreferences.getInstance());

  static bool get hasBuiltInBaseUrl => builtInBaseUrl.isNotEmpty;

  /// Which build this is (prod, dev or local), from the same config file.
  static const appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'prod');

  String get baseUrl => builtInBaseUrl;
  bool get hasSession => _sessionId != null;

  /// For the app's other saved state (offline_queue.dart, the floor's copy).
  SharedPreferences get prefs => _prefs;

  static String cleanBaseUrl(String url) {
    var cleaned = url.trim();
    while (cleaned.endsWith('/')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }
    if (cleaned.isNotEmpty && !cleaned.contains('://')) cleaned = 'http://$cleaned';
    return cleaned;
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
    if (baseUrl.isEmpty) throw ApiException('This build has no dashboard address yet.');
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
      throw ApiException("The dashboard server didn't answer. Check the connection and try again.", network: true);
    } catch (_) {
      throw ApiException("Can't reach the dashboard server. Check the connection and try again.", network: true);
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
      throw ApiException((json['error'] ?? json['message'] ?? fallbackMessage).toString(),
          network: status >= 502 && status <= 504);
    }
    return json['data'];
  }

  // For order mutations, whose answers are the flat {ok, kind, message} shape.
  // A 401, a 502-504 (the server couldn't reach restoAdmin) or an answer
  // with no body is marked transient: it may work if sent again later.
  Future<MutationResult> _mutate(String method, String path, [Object? body]) async {
    final (status, json) = await _send(method, path, body: body);
    final transient = status == 401 || (status >= 502 && status <= 504);
    if (json.isEmpty) {
      return MutationResult(ok: false, message: 'No answer from the dashboard server', transient: transient || status >= 500);
    }
    return MutationResult.fromJson(json, transient: transient);
  }

  // A read that falls back to its last good copy when the server can't be
  // reached; any other failure still throws.
  Future<T> _cachedRead<T>(String key, Future<dynamic> Function() fetch, T Function(dynamic data) parse) async {
    try {
      final data = await fetch();
      _prefs.setString(key, jsonEncode(data));
      return parse(data);
    } on ApiException catch (e) {
      final saved = _prefs.getString(key);
      if (!e.network || saved == null) rethrow;
      return parse(jsonDecode(saved));
    }
  }

  // ---- Auth (server/auth.ts) ----

  /// The signed-in user, or null if not signed in. Throws if unreachable.
  Future<DashboardUser?> currentUser() async {
    if (_sessionId == null) return null;
    final (status, json) = await _send('GET', '/api/auth/me');
    if (status != 200 || json['success'] != true) {
      throw ApiException((json['error'] ?? "Can't reach the dashboard server.").toString(), network: status >= 502);
    }
    final data = json['data'];
    if (data == null) {
      clearSession();
      return null;
    }
    return _keepUser(Map<String, dynamic>.from(data));
  }

  /// Who was signed in when the server last answered, for starting with no
  /// connection. The session itself is checked once the server is back.
  DashboardUser? get cachedUser {
    final saved = _prefs.getString(_prefsCachedUser);
    if (_sessionId == null || saved == null) return null;
    try {
      return DashboardUser.fromJson(Map<String, dynamic>.from(jsonDecode(saved)));
    } catch (_) {
      return null;
    }
  }

  DashboardUser _keepUser(Map<String, dynamic> data) {
    _prefs.setString(_prefsCachedUser, jsonEncode(data));
    return DashboardUser.fromJson(data);
  }

  /// Quick login: the server signs in with the shared dashboard account,
  /// whose credentials stay on the server.
  Future<DashboardUser> signIn() async {
    final (status, json) = await _send('POST', '/api/auth/login');
    if (status != 200 || json['success'] != true) {
      throw ApiException((json['error'] ?? 'Sign-in failed. Please try again.').toString());
    }
    return _keepUser(Map<String, dynamic>.from(json['data']));
  }

  Future<void> signOut() async {
    try {
      await _send('POST', '/api/auth/logout');
    } catch (_) {}
    clearSession();
    _prefs.remove(_prefsCachedUser);
  }

  // ---- Floor layout ----

  Future<FloorLayout> layout() => _cachedRead(_prefsCachedLayout, () => _getData('/api/layout', 'Failed to load the floor plan'),
      (data) => FloorLayout.fromJson(Map<String, dynamic>.from(data)));

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

  // Both fall back to the last menu fetched, so orders can be taken offline.
  Future<List<MenuItem>> menu() => _cachedRead(
      _prefsCachedMenu,
      () => _getData('/api/admin/menu', 'Failed to load the menu from restoAdmin'),
      (data) => (data as List? ?? []).map((e) => MenuItem.fromJson(Map<String, dynamic>.from(e))).toList());

  Future<List<MenuPopularity>> menuPopularity() => _cachedRead(
      _prefsCachedPopularity,
      () => _getData('/api/admin/menu/popularity', 'Failed to load top revenue items from restoAdmin'),
      (data) => (data as List? ?? []).map((e) => MenuPopularity.fromJson(Map<String, dynamic>.from(e))).toList());

  Future<SalesSummary> sales(String period) async => SalesSummary.fromJson(
      Map<String, dynamic>.from(await _getData('/api/admin/sales?period=$period', 'Failed to load sales from restoAdmin')));

  /// [createdAt] (when the order was taken) makes the create safe to send
  /// again: the server derives the order number from it, so a repeat finds
  /// the order it already made. [mergeOnConflict] adds the items to the
  /// table's open order if it has one (for orders saved while offline).
  Future<MutationResult> createOrder(int adminTableId, String orderType, List<Map<String, num>> items, double? roomChargeQty,
          {required DateTime createdAt, bool mergeOnConflict = false}) =>
      _mutate('POST', '/api/admin/orders', {
        'tableId': adminTableId,
        'orderType': orderType,
        'items': items,
        'roomChargeQty': ?roomChargeQty,
        'createdAt': createdAt.toUtc().toIso8601String(),
        if (mergeOnConflict) 'mergeOnConflict': true,
      });

  /// [clientAt] is when it was really done, for a change saved offline and
  /// sent later: restoAdmin's Activity tab then shows that time.
  Future<MutationResult> addItems(int orderId, List<Map<String, num>> items, {DateTime? clientAt}) =>
      _mutate('POST', '/api/admin/orders/$orderId/items', {
        'items': items,
        if (clientAt != null) 'clientAt': clientAt.toUtc().toIso8601String(),
      });

  Future<MutationResult> updateRoomCharge(int orderId, double roomChargeQty, {DateTime? clientAt}) =>
      _mutate('PATCH', '/api/admin/orders/$orderId/room-charge', {
        'roomChargeQty': roomChargeQty,
        if (clientAt != null) 'clientAt': clientAt.toUtc().toIso8601String(),
      });

  Future<MutationResult> confirmOrder(int orderId) => _mutate('PATCH', '/api/admin/orders/$orderId/status', {'status': 2});

  Future<MutationResult> cancelOrder(int orderId) => _mutate('PATCH', '/api/admin/orders/$orderId/status', {'status': -1});

  /// Changes item lines of an open order in one go: [changes] maps an order
  /// item id to its new qty, 0 removing it. restoAdmin logs it as one edit.
  Future<MutationResult> editOrderItems(int orderId, Map<int, double> changes) =>
      _mutate('PUT', '/api/admin/orders/$orderId/items', {
        'changes': [
          for (final c in changes.entries) {'itemId': c.key, 'qty': c.value}
        ],
      });

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
