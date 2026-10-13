import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api/api_client.dart';
import 'api/models.dart';
import 'fullscreen.dart';
import 'state/dashboard_state.dart';
import 'theme.dart';
import 'ui/login_page.dart';
import 'ui/shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // A floor dashboard is a landscape tablet screen, like the web version.
  await SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
  // Opens in fullscreen every launch, before the first frame shows the bars.
  final fullscreen = FullscreenController();
  await fullscreen.apply();
  final api = await ApiClient.create();
  runApp(DashboardApp(api: api, fullscreen: fullscreen));
}

class DashboardApp extends StatelessWidget {
  final ApiClient api;
  final FullscreenController fullscreen;
  const DashboardApp({super.key, required this.api, required this.fullscreen});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Blue Moon Dashboard',
      debugShowCheckedModeBanner: false,
      showPerformanceOverlay: const bool.fromEnvironment('PERF_OVERLAY'),
      theme: buildTheme(),
      home: AuthGate(api: api, fullscreen: fullscreen),
      builder: (context, child) => FullscreenInsets(controller: fullscreen, child: child!),
    );
  }
}

sealed class _AuthState {}

class _Checking extends _AuthState {}

class _SignedOut extends _AuthState {
  final String? notice;
  _SignedOut(this.notice);
}

class _SignedIn extends _AuthState {
  final DashboardUser user;
  final DashboardState state;
  _SignedIn(this.user, this.state);
}

/// Shows the sign-in page until this device is signed in, then the
/// dashboard. Goes back to the sign-in page (with the reason) whenever a
/// call reports the session is gone, like the web dashboard's AuthGate.
class AuthGate extends StatefulWidget {
  final ApiClient api;
  final FullscreenController fullscreen;
  const AuthGate({super.key, required this.api, required this.fullscreen});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  _AuthState _auth = _Checking();
  StreamSubscription? _signedOutSub;

  ApiClient get api => widget.api;

  @override
  void initState() {
    super.initState();
    _signedOutSub = api.signedOut.listen((reason) {
      if (_auth is _SignedIn) _toSignedOut(signedOutMessages[reason]);
    });
    _restore();
  }

  Future<void> _restore() async {
    if (api.baseUrl.isEmpty || !api.hasSession) {
      setState(() => _auth = _SignedOut(null));
      return;
    }
    try {
      final user = await api.currentUser();
      if (user == null) {
        setState(() => _auth = _SignedOut(null));
      } else {
        await _enter(user);
      }
    } catch (e) {
      setState(() => _auth = _SignedOut(e.toString()));
    }
  }

  // Loads the floor layout, then starts live sync.
  Future<void> _enter(DashboardUser user) async {
    final layout = await api.layout();
    final state = DashboardState(api, layout)..start();
    if (!mounted) {
      state.dispose();
      return;
    }
    setState(() => _auth = _SignedIn(user, state));
  }

  void _toSignedOut(String? notice) {
    final current = _auth;
    // Back to the root, closing any open order screen or dialog.
    Navigator.of(context).popUntil((route) => route.isFirst);
    setState(() => _auth = _SignedOut(notice));
    if (current is _SignedIn) current.state.dispose();
  }

  Future<void> _signOut() async {
    await api.signOut();
    _toSignedOut(null);
  }

  @override
  void dispose() {
    _signedOutSub?.cancel();
    final current = _auth;
    if (current is _SignedIn) current.state.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return switch (_auth) {
      _Checking() => const Scaffold(
          body: Center(child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.5))),
        ),
      _SignedOut(:final notice) =>
        LoginPage(api: api, notice: notice, fullscreen: widget.fullscreen, onSignedIn: _enter),
      _SignedIn(:final user, :final state) =>
        DashboardShell(state: state, user: user, fullscreen: widget.fullscreen, onSignOut: _signOut),
    };
  }
}
