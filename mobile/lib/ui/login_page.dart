import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../fullscreen.dart';
import '../theme.dart';
import 'common.dart';

/// Staff sign in with their own restoAdmin account, like the web dashboard.
/// Also holds the dashboard server's address, since a tablet app has no
/// page URL to take it from.
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
  late final _server = TextEditingController(text: widget.api.baseUrl);
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();
  bool _showPassword = false;
  bool _submitting = false;
  String? _error;
  // Only a build without its own address asks for one; it's tucked away
  // once set, and shown again when missing or asked for.
  late bool _editServer = !ApiClient.hasBuiltInBaseUrl && widget.api.baseUrl.isEmpty;

  @override
  void dispose() {
    _server.dispose();
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final username = _username.text.trim();
    if (_editServer && _server.text.trim().isEmpty) {
      setState(() {
        _error = "Enter the dashboard's address, e.g. http://192.168.1.10:3500.";
        _editServer = true;
      });
      return;
    }
    if (username.isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your username and password.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      if (_editServer) await widget.api.setBaseUrl(_server.text);
      final user = await widget.api.signIn(username, _password.text);
      await widget.onSignedIn(user);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _password.clear();
        _submitting = false;
      });
    }
  }

  InputDecoration _decoration({Widget? suffix, String? hint}) => InputDecoration(
        filled: true,
        fillColor: const Color(0xFF0E0F1A),
        suffixIcon: suffix,
        hintText: hint,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      );

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate400)),
      );

  // Hidden from staff: holding the title for 3 seconds lets a technician
  // point this tablet at another server without a new build.
  Future<void> _editServerAsTechnician() async {
    final changed = await showServerOverrideDialog(context, widget.api);
    if (!changed || !mounted) return;
    setState(() {
      _server.text = widget.api.baseUrl;
      _editServer = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final notice = widget.notice;
    return Scaffold(
      backgroundColor: AppColors.bg,
      // Staff can opt out of fullscreen before signing in; the dashboard's
      // own toggle shares this setting.
      floatingActionButton: FullscreenPill(controller: widget.fullscreen),
      floatingActionButtonLocation: FullscreenPill.location,
      // A soft glow behind the logo, so the navy badge stands off the page.
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.5),
            radius: 0.7,
            colors: [Color(0x384F46E5), Color(0x00000000)],
          ),
        ),
        child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    // The Blue Moon badge (it spells out the name). Holding it
                    // for 3 seconds is the technician's way in to the server
                    // address (see _editServerAsTechnician).
                    RawGestureDetector(
                      gestures: {
                        LongPressGestureRecognizer: GestureRecognizerFactoryWithHandlers<LongPressGestureRecognizer>(
                          () => LongPressGestureRecognizer(duration: const Duration(seconds: 3)),
                          (r) => r.onLongPress = _editServerAsTechnician,
                        ),
                      },
                      // A faint gold ring and halo separate the dark disc from
                      // the dark page; at 160 its "Family KTV" line is legible.
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.all(5),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.gold.withValues(alpha: 0.35), width: 1.5),
                            boxShadow: [
                              BoxShadow(color: AppColors.indigo500.withValues(alpha: 0.35), blurRadius: 48, spreadRadius: 4),
                              BoxShadow(color: AppColors.gold.withValues(alpha: 0.12), blurRadius: 18),
                            ],
                          ),
                          child: Image.asset('assets/blue_moon_logo.png',
                              width: 160, height: 160, filterQuality: FilterQuality.medium, semanticLabel: 'Blue Moon'),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    // "FLOOR DASHBOARD" in the logo's gold, between thin gold rules.
                    Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Container(width: 28, height: 1, color: AppColors.gold.withValues(alpha: 0.4)),
                      const SizedBox(width: 12),
                      Text('FLOOR DASHBOARD',
                          style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 2.4,
                              color: AppColors.gold.withValues(alpha: 0.85))),
                      const SizedBox(width: 12),
                      Container(width: 28, height: 1, color: AppColors.gold.withValues(alpha: 0.4)),
                    ]),
                    if (ApiClient.appEnv != 'prod')
                      Center(
                        child: Container(
                          margin: const EdgeInsets.only(top: 8),
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
                      ),
                    const SizedBox(height: 28),
                    // A gold hairline along the card's top edge ties it to the logo.
                    Stack(children: [
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          color: AppColors.cardAlt,
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(24),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          const Text('Sign in',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                          const SizedBox(height: 16),
                          if (notice != null && _error == null) ...[
                            NoticeBox(
                                color: AppColors.amber500,
                                textColor: AppColors.amber200,
                                icon: Icons.info_outline,
                                child: Text(notice)),
                            const SizedBox(height: 16),
                          ],
                          if (_editServer) ...[
                            _label('Dashboard address'),
                            TextField(
                              controller: _server,
                              enabled: !_submitting,
                              keyboardType: TextInputType.url,
                              autocorrect: false,
                              decoration: _decoration(hint: 'http://192.168.1.10:3500'),
                            ),
                            const SizedBox(height: 16),
                          ],
                          _label('Username'),
                          TextField(
                            controller: _username,
                            enabled: !_submitting,
                            autocorrect: false,
                            enableSuggestions: false,
                            autofillHints: const [AutofillHints.username],
                            textInputAction: TextInputAction.next,
                            onSubmitted: (_) => _passwordFocus.requestFocus(),
                            decoration: _decoration(),
                          ),
                          const SizedBox(height: 16),
                          _label('Password'),
                          TextField(
                            controller: _password,
                            focusNode: _passwordFocus,
                            enabled: !_submitting,
                            obscureText: !_showPassword,
                            autofillHints: const [AutofillHints.password],
                            textInputAction: TextInputAction.go,
                            onSubmitted: (_) => _submit(),
                            decoration: _decoration(
                              suffix: IconButton(
                                tooltip: _showPassword ? 'Hide password' : 'Show password',
                                icon: Icon(_showPassword ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                                    size: 18, color: AppColors.slate500),
                                onPressed: () => setState(() => _showPassword = !_showPassword),
                              ),
                            ),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 16),
                            NoticeBox(
                                color: AppColors.rose500,
                                textColor: AppColors.rose200,
                                icon: Icons.warning_amber_rounded,
                                child: Text(_error!)),
                          ],
                          const SizedBox(height: 18),
                          SizedBox(
                            height: 48,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(colors: [AppColors.indigo600, Color(0xFF7C3AED)]),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(12),
                                  onTap: _submitting ? null : _submit,
                                  child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                                    _submitting
                                        ? const SizedBox(
                                            width: 16,
                                            height: 16,
                                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                        : const Icon(Icons.login, size: 18, color: Colors.white),
                                    const SizedBox(width: 8),
                                    Text(_submitting ? 'Signing in…' : 'Sign in',
                                        style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white)),
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
                              child: Text('Signing in here signs this account out on any other device.',
                                  style: TextStyle(fontSize: 11, color: AppColors.slate500, height: 1.4)),
                            ),
                          ]),
                        ]),
                      ),
                      Positioned(
                        top: 0,
                        left: 48,
                        right: 48,
                        child: Container(
                          height: 1,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(colors: [
                              AppColors.gold.withValues(alpha: 0),
                              AppColors.gold.withValues(alpha: 0.6),
                              AppColors.gold.withValues(alpha: 0),
                            ]),
                          ),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 14),
                    const Text(
                      'Sign in with your restoAdmin account.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 11, color: AppColors.slate500, height: 1.5),
                    ),
                    // A build's own address is shown, not editable (see
                    // _editServerAsTechnician).
                    if (ApiClient.hasBuiltInBaseUrl || widget.api.isOverridden)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(
                            'Server: ${widget.api.baseUrl}${widget.api.isOverridden ? ' (technician override)' : ''}',
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 11, color: AppColors.slate500)),
                      )
                    else if (!_editServer)
                      TextButton(
                        onPressed: () => setState(() => _editServer = true),
                        child: Text('Server: ${widget.api.baseUrl} · Change',
                            style: const TextStyle(fontSize: 11, color: AppColors.slate500)),
                      ),
                  ]),
                ),
              ),
            ),
          ),
      ),
    );
  }
}

/// The technician's server address dialog. Resolves true if it changed.
Future<bool> showServerOverrideDialog(BuildContext context, ApiClient api) async {
  final result = await showDialog<String>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.8),
    builder: (_) => _ServerOverrideDialog(api: api),
  );
  if (result == null) return false;
  if (ApiClient.hasBuiltInBaseUrl) {
    await api.setOverride(result);
  } else {
    await api.setBaseUrl(result);
  }
  return true;
}

class _ServerOverrideDialog extends StatefulWidget {
  final ApiClient api;
  const _ServerOverrideDialog({required this.api});

  @override
  State<_ServerOverrideDialog> createState() => _ServerOverrideDialogState();
}

class _ServerOverrideDialogState extends State<_ServerOverrideDialog> {
  late final _field = TextEditingController(text: widget.api.baseUrl);

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.cardAlt,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24), side: const BorderSide(color: Color(0x33FFFFFF))),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Server address',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
            const SizedBox(height: 6),
            Text(
                ApiClient.hasBuiltInBaseUrl
                    ? 'For technicians. This build uses ${ApiClient.builtInBaseUrl}; '
                        'an address saved here replaces it on this tablet only.'
                    : 'For technicians. The dashboard address this tablet signs in to.',
                style: const TextStyle(fontSize: 13, color: AppColors.slate300, height: 1.45)),
            const SizedBox(height: 16),
            TextField(
              controller: _field,
              autofocus: true,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(
                filled: true,
                fillColor: Color(0xFF0E0F1A),
                hintText: 'http://192.168.1.10:3500',
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              ),
            ),
            const SizedBox(height: 20),
            Row(children: [
              if (ApiClient.hasBuiltInBaseUrl && widget.api.isOverridden)
                PillButton(
                    label: 'Use built-in',
                    color: AppColors.subtle,
                    textColor: AppColors.slate300,
                    onPressed: () => Navigator.pop(context, '')),
              const Spacer(),
              PillButton(
                  label: 'Cancel',
                  color: AppColors.subtle,
                  textColor: AppColors.slate300,
                  onPressed: () => Navigator.pop(context)),
              const SizedBox(width: 10),
              PillButton(label: 'Save', onPressed: () => Navigator.pop(context, _field.text)),
            ]),
          ]),
        ),
      ),
    );
  }
}
