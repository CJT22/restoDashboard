import 'package:flutter/material.dart';

import '../api/app_update.dart';
import '../theme.dart';
import 'common.dart';

/// The sign-in page's "Check for updates" modal: checks the server, then says
/// the app is up to date or offers the new version ("Update now?" No / Yes),
/// downloads it and opens Android's installer. The startup check opens it
/// with the [found] update straight away. App only: the web dashboard
/// updates itself on reload.
Future<void> showUpdateDialog(BuildContext context, AppUpdates updates, {UpdateCheck? found}) => showDialog<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.black.withValues(alpha: 0.8),
      builder: (context) => _UpdateDialog(updates: updates, found: found),
    );

enum _Step { checking, upToDate, available, downloading, failed }

class _UpdateDialog extends StatefulWidget {
  final AppUpdates updates;
  final UpdateCheck? found;
  const _UpdateDialog({required this.updates, this.found});

  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  late _Step _step;
  UpdateCheck? _check;
  double _progress = 0;
  String _error = '';
  // What "Try again" repeats: the check, or the download.
  bool _failedDownload = false;

  @override
  void initState() {
    super.initState();
    _check = widget.found;
    _step = _check == null ? _Step.checking : _Step.available;
    if (_check == null) _runCheck();
  }

  Future<void> _runCheck() async {
    setState(() => _step = _Step.checking);
    try {
      final check = await widget.updates.check();
      if (!mounted) return;
      setState(() {
        _check = check;
        _step = check.update == null ? _Step.upToDate : _Step.available;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _failedDownload = false;
        _step = _Step.failed;
      });
    }
  }

  Future<void> _install() async {
    setState(() {
      _step = _Step.downloading;
      _progress = 0;
    });
    try {
      await widget.updates.downloadAndInstall(_check!.update!, onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      });
      // Android's installer is on screen now; it closes the app once the
      // update is confirmed.
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _failedDownload = true;
        _step = _Step.failed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final check = _check;
    final update = check?.update;
    final (IconData icon, Color tone, Color iconColor, String title) = switch (_step) {
      _Step.checking => (Icons.system_update, AppColors.indigo500, AppColors.indigo300, 'Checking for updates…'),
      _Step.upToDate => (Icons.check_circle_outline, AppColors.emerald500, AppColors.emerald400, "You're up to date"),
      _Step.available => (Icons.system_update, AppColors.indigo500, AppColors.indigo300, 'Update available'),
      _Step.downloading => (Icons.downloading, AppColors.indigo500, AppColors.indigo300, 'Downloading update…'),
      _Step.failed => (Icons.warning_amber_rounded, AppColors.rose500, AppColors.rose400,
          _failedDownload ? 'Update failed' : "Couldn't check for updates"),
    };

    return PopScope(
      canPop: _step != _Step.downloading,
      child: Dialog(
        backgroundColor: AppColors.cardAlt,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24), side: const BorderSide(color: Color(0x33FFFFFF))),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: tone.withValues(alpha: 0.2),
                    border: Border.all(color: tone.withValues(alpha: 0.3)),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(icon, color: iconColor),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                    const SizedBox(height: 6),
                    DefaultTextStyle.merge(
                      style: const TextStyle(fontSize: 13, color: AppColors.slate300, height: 1.45),
                      child: switch (_step) {
                        _Step.checking => const Text('Asking the dashboard server for the latest version.'),
                        _Step.upToDate => Text('This tablet has the latest version (${check!.installedName}).'),
                        _Step.available => Text('Version ${update!.versionName} is ready. This tablet has '
                            '${check!.installedName}. Update now?'),
                        _Step.downloading => const Text("Keep the app open. Android's installer opens when it's done."),
                        _Step.failed => Text(_error),
                      },
                    ),
                  ]),
                ),
              ]),
              if (_step == _Step.checking) ...[
                const SizedBox(height: 20),
                const LinearProgressIndicator(
                    minHeight: 6, color: AppColors.indigo500, backgroundColor: AppColors.subtle),
              ],
              if (_step == _Step.downloading) ...[
                const SizedBox(height: 20),
                ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(
                      value: _progress, minHeight: 6, color: AppColors.indigo500, backgroundColor: AppColors.subtle),
                ),
                const SizedBox(height: 8),
                Text('${(_progress * 100).round()}%',
                    textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
              ],
              if (_step == _Step.available && update!.releaseNotes.trim().isNotEmpty) ...[
                const SizedBox(height: 16),
                FaintCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text("WHAT'S NEW",
                        style: TextStyle(
                            fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppColors.slate500)),
                    const SizedBox(height: 6),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 160),
                      child: SingleChildScrollView(
                        child: Text(update.releaseNotes.trim(),
                            style: const TextStyle(fontSize: 13, color: AppColors.slate200, height: 1.45)),
                      ),
                    ),
                  ]),
                ),
              ],
              if (_step != _Step.checking && _step != _Step.downloading) ...[
                const SizedBox(height: 20),
                const Divider(height: 1),
                const SizedBox(height: 16),
                Row(mainAxisAlignment: MainAxisAlignment.end, children: switch (_step) {
                  _Step.available => [
                      _secondary('No', () => Navigator.pop(context)),
                      const SizedBox(width: 10),
                      PillButton(label: 'Yes, update', icon: Icons.download, onPressed: _install),
                    ],
                  _Step.failed => [
                      _secondary('Close', () => Navigator.pop(context)),
                      const SizedBox(width: 10),
                      PillButton(
                          label: 'Try again', icon: Icons.refresh, onPressed: _failedDownload ? _install : _runCheck),
                    ],
                  _ => [PillButton(label: 'OK', onPressed: () => Navigator.pop(context))],
                }),
              ],
            ]),
          ),
        ),
      ),
    );
  }

  Widget _secondary(String label, VoidCallback onPressed) =>
      PillButton(label: label, color: AppColors.subtle, textColor: AppColors.slate300, onPressed: onPressed);
}
