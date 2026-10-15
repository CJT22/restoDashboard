import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Keeps Android's status and navigation bars hidden, always; there is no
/// toggle. "Sticky immersive" leaves them a swipe away from an edge (for
/// back, home and recents), and they hide again on their own after a few
/// seconds.
class Fullscreen with WidgetsBindingObserver {
  Fullscreen._();

  /// Hides the bars before the first frame, and keeps them hidden.
  static Future<void> start() {
    WidgetsBinding.instance.addObserver(Fullscreen._());
    return _apply();
  }

  static Future<void> _apply() => SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

  // Android can drop immersive mode while the app is in the background, so
  // re-apply it on return.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _apply();
  }
}

/// Drops the top inset. Android keeps reporting the hidden status bar's
/// strip (about 39dp on the tablets) as a top inset, so every SafeArea below
/// it would otherwise leave that much empty space at the top of the sidebar,
/// each view, dialogs and order screens.
class FullscreenInsets extends StatelessWidget {
  final Widget child;
  const FullscreenInsets({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return MediaQuery(data: mq.removePadding(removeTop: true).removeViewPadding(removeTop: true), child: child);
  }
}
