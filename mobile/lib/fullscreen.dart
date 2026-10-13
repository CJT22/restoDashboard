import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// Whether Android's status and navigation bars are hidden, shared by the
/// sign-in page and the dashboard so their toggles always agree.
///
/// Every launch starts in fullscreen; turning it off lasts until the app is
/// closed. "Sticky immersive" leaves the bars a swipe away from an edge, and
/// they hide again on their own.
class FullscreenController extends ValueNotifier<bool> with WidgetsBindingObserver {
  FullscreenController() : super(true) {
    WidgetsBinding.instance.addObserver(this);
  }

  Future<void> apply() =>
      SystemChrome.setEnabledSystemUIMode(value ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge);

  void toggle() {
    value = !value;
    apply();
  }

  // Android can drop immersive mode while the app is in the background, so
  // re-apply it on return; the toggles then never show the wrong label.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) apply();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}

/// Drops the top inset while in fullscreen. Android keeps reporting the
/// hidden status bar's strip (about 39dp on the tablets) as a top inset, so
/// every SafeArea below it would otherwise leave that much empty space at
/// the top of the sidebar, each view, dialogs and order screens.
class FullscreenInsets extends StatelessWidget {
  final FullscreenController controller;
  final Widget child;
  const FullscreenInsets({super.key, required this.controller, required this.child});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: controller,
      child: child,
      builder: (context, on, child) {
        if (!on) return child!;
        final mq = MediaQuery.of(context);
        return MediaQuery(data: mq.removePadding(removeTop: true).removeViewPadding(removeTop: true), child: child!);
      },
    );
  }
}

/// The "Exit Fullscreen" / "Fullscreen" pill for the sign-in page.
class FullscreenPill extends StatelessWidget {
  final FullscreenController controller;
  const FullscreenPill({super.key, required this.controller});

  /// Top-right corner, as far from the top as from the right (below the
  /// status bar when it shows). Scaffold's own endTop sits lower, as it lines
  /// up with where an app bar would be.
  static const location = _TopRight();

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: controller,
      builder: (context, on, _) => Material(
        color: const Color(0xE6141628),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12), side: const BorderSide(color: AppColors.border)),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: controller.toggle,
          child: Container(
            height: 40,
            // The icon's glyph has built-in space on its left, so that side is
            // trimmed to look even with the text's end.
            padding: const EdgeInsets.fromLTRB(11, 0, 14, 0),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(on ? Icons.fullscreen_exit : Icons.fullscreen, size: 18, color: AppColors.slate400),
              const SizedBox(width: 8),
              Text(on ? 'Exit Fullscreen' : 'Fullscreen',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.slate300)),
            ]),
          ),
        ),
      ),
    );
  }
}

class _TopRight extends FloatingActionButtonLocation {
  const _TopRight();

  static const _margin = 16.0;

  @override
  Offset getOffset(ScaffoldPrelayoutGeometry g) => Offset(
        g.scaffoldSize.width - g.minInsets.right - g.floatingActionButtonSize.width - _margin,
        g.minInsets.top + _margin,
      );
}
