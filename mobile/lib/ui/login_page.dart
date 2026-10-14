import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../fullscreen.dart';
import '../theme.dart';
import 'common.dart';

/// One quick login button, no fields, like the web dashboard: the server
/// signs every device in with its shared dashboard account. The server's
/// address is the build's own (`config/<flavor>.json`).
class LoginPage extends StatefulWidget {
  final ApiClient api;
  final String? notice;
  final FullscreenController fullscreen;
  final Future<void> Function(DashboardUser user) onSignedIn;
  const LoginPage(
      {super.key, required this.api, required this.notice, required this.fullscreen, required this.onSignedIn});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  bool _submitting = false;
  String? _error;

  // Where the form and the logo block sit on the page, so the night sky
  // (drawn over the page) keeps clear of them.
  final _pageKey = GlobalKey();
  final _formKey = GlobalKey();
  final _brandKey = GlobalKey();
  final _keepOut = ValueNotifier<List<Rect>>(const []);

  // Measured after every layout (the form grows with a notice or an error).
  // The keys sit outside the entrance animations, so these are where things
  // come to rest. The form gets a wider margin than the logo, whose glow
  // the stars may fill.
  void _measureKeepOut(Duration _) {
    if (!mounted) return;
    final page = _pageKey.currentContext?.findRenderObject() as RenderBox?;
    if (page == null || !page.hasSize) return;
    Rect? rectOf(GlobalKey key, double clearance) {
      final box = key.currentContext?.findRenderObject() as RenderBox?;
      if (box == null || !box.hasSize) return null;
      return (box.localToGlobal(Offset.zero, ancestor: page) & box.size).inflate(clearance);
    }

    final rects = [?rectOf(_formKey, 28), ?rectOf(_brandKey, 10)];
    if (!listEquals(rects, _keepOut.value)) _keepOut.value = rects;
  }

  @override
  void dispose() {
    _keepOut.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final user = await widget.api.signIn();
      await widget.onSignedIn(user);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _submitting = false;
      });
    }
  }

  // Landscape screens get two halves: the Blue Moon brand on the left (logo
  // in its glow, in a quiet night sky) fading into a navy panel with the form
  // on the right. Narrow or portrait screens stack them.
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      // Staff can opt out of fullscreen before signing in; the dashboard's
      // own toggle shares this setting.
      floatingActionButton: FullscreenPill(controller: widget.fullscreen),
      floatingActionButtonLocation: FullscreenPill.location,
      body: Stack(key: _pageKey, children: [
        Positioned.fill(child: _layout()),
        // A quiet night sky across the whole page: plentiful around the moon,
        // thinning toward the form and never on it. It moves only if the
        // form does.
        Positioned.fill(
          child: IgnorePointer(
            child: RepaintBoundary(child: CustomPaint(painter: _StarPainter(_keepOut))),
          ),
        ),
        // A faint grain over everything, so the dark gradients don't step
        // into visible bands.
        Positioned.fill(
          child: IgnorePointer(
            child: Image.asset('assets/grain.png',
                repeat: ImageRepeat.repeat,
                color: const Color.fromRGBO(255, 255, 255, 0.035),
                colorBlendMode: BlendMode.modulate,
                excludeFromSemantics: true),
          ),
        ),
      ]),
    );
  }

  Widget _layout() {
    WidgetsBinding.instance.addPostFrameCallback(_measureKeepOut);
    return LayoutBuilder(builder: (context, box) {
      final wide = box.maxWidth >= 900 && box.maxWidth > box.maxHeight;
      if (wide) {
        return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(flex: 55, child: _brand(wide: true)),
          Expanded(flex: 45, child: Container(color: AppColors.panel, child: _formPanel())),
        ]);
      }
      // The navy behind everything, so the form panel reaches the bottom.
      return Container(
        color: AppColors.panel,
        child: SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: box.maxHeight),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SizedBox(height: math.max(320, box.maxHeight * 0.44), child: _brand(wide: false)),
              Padding(padding: const EdgeInsets.only(bottom: 32), child: _formPanel()),
            ]),
          ),
        ),
      );
    });
  }

  Widget _brand({required bool wide}) {
    return Stack(fit: StackFit.expand, children: [
      const ColoredBox(color: AppColors.bg),
      // The moon's glow.
      const DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(radius: 0.6, colors: [Color(0x4D4F46E5), Color(0x004F46E5)]),
        ),
      ),
      // Fades into the navy form panel, with no hard edge.
      Positioned(
        top: wide ? 0 : null,
        bottom: 0,
        right: 0,
        left: wide ? null : 0,
        width: wide ? 320 : null,
        height: wide ? null : 140,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: wide ? Alignment.centerLeft : Alignment.topCenter,
              end: wide ? Alignment.centerRight : Alignment.bottomCenter,
              colors: const [Color(0x00141628), AppColors.panel],
            ),
          ),
        ),
      ),
      Center(
        child: _Entrance(
          key: _brandKey,
          begin: const Offset(0, 0),
          scaleFrom: 0.94,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            // The Blue Moon badge (it spells out the name). A faint gold ring
            // and halo separate the dark disc from the dark page.
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.gold.withValues(alpha: 0.35), width: 1.5),
                boxShadow: [
                  BoxShadow(color: AppColors.indigo500.withValues(alpha: 0.38), blurRadius: 64, spreadRadius: 1),
                  BoxShadow(color: AppColors.gold.withValues(alpha: 0.14), blurRadius: 22),
                ],
              ),
              child: Image.asset('assets/blue_moon_logo.png',
                  width: wide ? 232 : 160,
                  height: wide ? 232 : 160,
                  filterQuality: FilterQuality.medium,
                  semanticLabel: 'Blue Moon'),
            ),
            const SizedBox(height: 24),
            // "FLOOR DASHBOARD" in the logo's gold, between thin gold rules.
            Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 32, height: 1, color: AppColors.gold.withValues(alpha: 0.4)),
              const SizedBox(width: 12),
              Text('FLOOR DASHBOARD',
                  style: TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 2.8, color: AppColors.gold.withValues(alpha: 0.85))),
              const SizedBox(width: 12),
              Container(width: 32, height: 1, color: AppColors.gold.withValues(alpha: 0.4)),
            ]),
            const SizedBox(height: 10),
            const Text('Tables, rooms and orders, live at a glance.',
                style: TextStyle(fontSize: 14, color: AppColors.slate400)),
            // Dev is the everyday build ("Blue Moon"); the others are tagged,
            // like their app names.
            if (ApiClient.appEnv != 'dev')
              Container(
                margin: const EdgeInsets.only(top: 14),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.amber500.withValues(alpha: 0.15),
                  border: Border.all(color: AppColors.amber500.withValues(alpha: 0.4)),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text('${ApiClient.appEnv.toUpperCase()} BUILD',
                    style: const TextStyle(
                        fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.amber300)),
              ),
          ]),
        ),
      ),
      if (wide)
        Positioned(
          left: 32,
          bottom: 20,
          child: Text('© ${DateTime.now().year} 3CORE LeadersTech',
              style: const TextStyle(fontSize: 11, color: AppColors.slate600)),
        ),
    ]);
  }

  Widget _formPanel() {
    final notice = widget.notice;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: ConstrainedBox(
          key: _formKey,
          constraints: const BoxConstraints(maxWidth: 384),
          child: _Entrance(
            begin: const Offset(24, 0),
            delay: const Duration(milliseconds: 80),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Welcome back',
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: Colors.white, letterSpacing: -0.3)),
              const SizedBox(height: 4),
              const Text('Tap below to open the floor dashboard.',
                  style: TextStyle(fontSize: 14, color: AppColors.slate400)),
              const SizedBox(height: 24),
              if (!ApiClient.hasBuiltInBaseUrl) ...[
                const NoticeBox(
                    color: AppColors.rose500,
                    textColor: AppColors.rose200,
                    icon: Icons.warning_amber_rounded,
                    child: Text("This build has no dashboard address yet, so it can't sign in. "
                        "Install a build made with the server's address.")),
                const SizedBox(height: 16),
              ] else if (notice != null && _error == null) ...[
                NoticeBox(
                    color: AppColors.amber500,
                    textColor: AppColors.amber200,
                    icon: Icons.info_outline,
                    child: Text(notice)),
                const SizedBox(height: 16),
              ],
              if (_error != null) ...[
                NoticeBox(
                    color: AppColors.rose500,
                    textColor: AppColors.rose200,
                    icon: Icons.warning_amber_rounded,
                    child: Text(_error!)),
                const SizedBox(height: 16),
              ],
              const SizedBox(height: 8),
              SizedBox(
                height: 64,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [AppColors.indigo600, Color(0xFF7C3AED)]),
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(color: AppColors.indigo500.withValues(alpha: 0.25), blurRadius: 15, offset: const Offset(0, 10)),
                    ],
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: _submitting || !ApiClient.hasBuiltInBaseUrl ? null : _submit,
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        _submitting
                            ? const SizedBox(
                                width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.login, size: 20, color: Colors.white),
                        const SizedBox(width: 10),
                        Text(_submitting ? 'Signing in…' : 'Quick Login',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                      ]),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Padding(
                  padding: EdgeInsets.only(top: 1),
                  child: Icon(Icons.info_outline, size: 14, color: AppColors.slate500),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: Text('Signing in here signs out any other device using the dashboard.',
                      style: TextStyle(fontSize: 11, color: AppColors.slate500, height: 1.4)),
                ),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}

class _Star {
  final double x, y, radius, opacity;
  final bool gold, bright;
  const _Star(this.x, this.y, this.radius, this.opacity, this.gold, this.bright);
}

// The same sky as the web version's (LoginPage.tsx): a fixed seed and the
// same generator, so both draw identical stars. Spread across the page,
// denser on the moon's side and thinning out to the right; a few brighter,
// a few in the logo's gold.
final _stars = () {
  var seed = 7;
  double next() {
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
    return seed / 4294967296;
  }

  return [
    for (var i = 0; i < 160; i++)
      _Star(math.pow(next(), 1.35).toDouble(), next(), 0.5 + next() * 0.9, 0.22 + next() * 0.5, next() < 0.06,
          next() < 0.08),
  ];
}();

class _StarPainter extends CustomPainter {
  // Areas to leave starless: the form and the logo block, with margins.
  final ValueListenable<List<Rect>> keepOut;
  _StarPainter(this.keepOut) : super(repaint: keepOut);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    final keepOut = this.keepOut.value;
    for (final star in _stars) {
      final centre = Offset(star.x * size.width, star.y * size.height);
      if (keepOut.any((rect) => rect.contains(centre))) continue;
      final color = star.gold ? AppColors.gold : Colors.white;
      final radius = star.bright ? star.radius + 0.5 : star.radius;
      if (star.bright) {
        paint.color = color.withValues(alpha: star.opacity * 0.15);
        canvas.drawCircle(centre, radius * 4, paint);
      }
      paint.color = color.withValues(alpha: star.opacity);
      canvas.drawCircle(centre, radius, paint);
    }
  }

  @override
  bool shouldRepaint(_StarPainter oldDelegate) => oldDelegate.keepOut != keepOut;
}

/// Plays once on first build: fades its child in while easing it from
/// [begin] (and [scaleFrom]) to rest.
class _Entrance extends StatelessWidget {
  final Widget child;
  final Offset begin;
  final double scaleFrom;
  final Duration delay;
  const _Entrance(
      {super.key, required this.child, this.begin = Offset.zero, this.scaleFrom = 1, this.delay = Duration.zero});

  static const _duration = Duration(milliseconds: 450);

  @override
  Widget build(BuildContext context) {
    final total = _duration + delay;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: total,
      curve: Interval(delay.inMilliseconds / total.inMilliseconds, 1, curve: Curves.easeOut),
      child: child,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: begin * (1 - t),
          child: Transform.scale(scale: scaleFrom + (1 - scaleFrom) * t, child: child),
        ),
      ),
    );
  }
}
