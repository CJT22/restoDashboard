import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_client.dart';

/// What the sidebar's connection badge shows (same as the web dashboard's
/// ConnectionStatus in src/services/adminSync.ts):
///   connecting   - first connection attempt still in progress
///   live         - stream up and the server is connected to restoAdmin
///   adminOffline - stream up, but the server can't reach restoAdmin
///   offline      - the dashboard server itself is unreachable (retrying)
enum ConnectionStatus { connecting, live, adminOffline, offline }

class StreamEvent {
  final String name;
  final Map<String, dynamic> data;
  const StreamEvent(this.name, this.data);
}

/// The server's /api/admin/stream (server-sent events), kept open and
/// reopened a few seconds after it drops. Carries table_updated,
/// order_created, order_updated and bridge_status events, and session_ended
/// when the server ends this device's session.
class LiveStream {
  static const _reopenDelay = Duration(seconds: 3);
  // The server sends a heartbeat every 25s; silence for this long means the
  // connection is dead even if the socket hasn't noticed yet.
  static const _silenceTimeout = Duration(seconds: 60);

  final ApiClient api;
  LiveStream(this.api);

  final _events = StreamController<StreamEvent>.broadcast();
  final _status = StreamController<ConnectionStatus>.broadcast();

  Stream<StreamEvent> get events => _events.stream;
  Stream<ConnectionStatus> get statusChanges => _status.stream;

  ConnectionStatus _current = ConnectionStatus.connecting;
  ConnectionStatus get status => _current;

  bool? _bridgeConnected;
  bool _streamOpen = false;
  bool _running = false;
  StreamSubscription<String>? _sub;
  http.Client? _client;
  Timer? _reopenTimer;
  Timer? _silenceTimer;

  void start() {
    if (_running) return;
    _running = true;
    _open();
  }

  void stop() {
    _running = false;
    _reopenTimer?.cancel();
    _silenceTimer?.cancel();
    _closeConnection();
    _streamOpen = false;
    _bridgeConnected = null;
    _setStatus(ConnectionStatus.connecting);
  }

  void _setStatus(ConnectionStatus next) {
    if (_current == next) return;
    _current = next;
    _status.add(next);
  }

  void _refreshStatus() {
    if (!_streamOpen) return;
    _setStatus(_bridgeConnected == false ? ConnectionStatus.adminOffline : ConnectionStatus.live);
  }

  Future<void> _open() async {
    if (!_running) return;
    try {
      final client = _client = http.Client();
      final res = await api.openStream(client).timeout(const Duration(seconds: 15));
      if (!_running) return;
      if (res.statusCode == 401) {
        // The session is gone (signed out, or signed in elsewhere).
        String body = '';
        try {
          body = await res.stream.bytesToString();
        } catch (_) {}
        Map<String, dynamic> json = {};
        try {
          json = Map<String, dynamic>.from(jsonDecode(body));
        } catch (_) {}
        _down();
        api.reportSignedOut(json);
        return;
      }
      if (res.statusCode != 200) {
        _down();
        _scheduleReopen();
        return;
      }

      _streamOpen = true;
      _bridgeConnected = null;
      _refreshStatus();
      _resetSilenceTimer();

      String? eventName;
      final data = StringBuffer();
      _sub = res.stream.transform(utf8.decoder).transform(const LineSplitter()).listen(
        (line) {
          _resetSilenceTimer();
          if (line.isEmpty) {
            // Blank line: dispatch the event gathered so far.
            if (data.isNotEmpty) _dispatch(eventName ?? 'message', data.toString());
            eventName = null;
            data.clear();
          } else if (line.startsWith(':')) {
            // Comment (heartbeat).
          } else if (line.startsWith('event:')) {
            eventName = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            if (data.isNotEmpty) data.write('\n');
            data.write(line.substring(5).trimLeft());
          }
        },
        onError: (_) => _dropped(),
        onDone: _dropped,
        cancelOnError: true,
      );
    } catch (_) {
      _down();
      _scheduleReopen();
    }
  }

  void _dispatch(String name, String raw) {
    Map<String, dynamic> json;
    try {
      json = Map<String, dynamic>.from(jsonDecode(raw));
    } catch (_) {
      return;
    }
    if (name == 'bridge_status') {
      _bridgeConnected = json['connected'] == true;
      _refreshStatus();
      return;
    }
    // Sent just before the server closes the stream because this session
    // ended (e.g. the account signed in on another device): back to the
    // sign-in page now, with the reason, rather than on a failed reconnect.
    if (name == 'session_ended') {
      api.reportSignedOut({'code': json['reason']});
      return;
    }
    _events.add(StreamEvent(name, json));
  }

  void _resetSilenceTimer() {
    _silenceTimer?.cancel();
    _silenceTimer = Timer(_silenceTimeout, _dropped);
  }

  void _closeConnection() {
    _sub?.cancel();
    _sub = null;
    _client?.close();
    _client = null;
  }

  void _down() {
    _closeConnection();
    _streamOpen = false;
    _silenceTimer?.cancel();
    _setStatus(ConnectionStatus.offline);
  }

  // The server closes the stream when the session ends, so a drop is also
  // how a sign-out shows up; the reopen then gets a 401 (handled above).
  void _dropped() {
    _down();
    _scheduleReopen();
  }

  void _scheduleReopen() {
    if (!_running || (_reopenTimer?.isActive ?? false)) return;
    _reopenTimer = Timer(_reopenDelay, _open);
  }

  void dispose() {
    stop();
    _events.close();
    _status.close();
  }
}
