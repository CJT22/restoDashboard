import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import 'common.dart';

const _paymentMethods = ['CASH', 'CARD', 'GCASH', 'BANK'];

/// Records a full or partial payment (src/components/SettlePaymentModal.tsx).
/// Resolves true once restoAdmin accepted it.
Future<bool> showSettleDialog(BuildContext context,
    {required DashboardState state, required Zone zone, required int orderId}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.7),
    builder: (_) => _SettleDialog(state: state, zone: zone, orderId: orderId),
  );
  return result ?? false;
}

class _SettleDialog extends StatefulWidget {
  final DashboardState state;
  final Zone zone;
  final int orderId;
  const _SettleDialog({required this.state, required this.zone, required this.orderId});

  @override
  State<_SettleDialog> createState() => _SettleDialogState();
}

class _SettleDialogState extends State<_SettleDialog> {
  bool _loading = true;
  double _remaining = 0;
  String _method = 'CASH';
  final _amount = TextEditingController();
  final _ref = TextEditingController();
  bool _submitting = false;
  String? _error;

  double get _amountPaid => double.tryParse(_amount.text.trim()) ?? 0;

  @override
  void initState() {
    super.initState();
    widget.state.api.billing(widget.orderId).then((billing) {
      if (!mounted) return;
      final rem = billing == null ? 0.0 : (billing.amountDue - billing.amountPaid).clamp(0, double.infinity).toDouble();
      setState(() {
        _remaining = rem;
        _amount.text = rem.toStringAsFixed(2);
        if (billing != null && _paymentMethods.contains(billing.paymentMethod)) _method = billing.paymentMethod;
        _loading = false;
      });
    }).catchError((Object e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    });
  }

  @override
  void dispose() {
    _amount.dispose();
    _ref.dispose();
    super.dispose();
  }

  bool get _valid => _amountPaid > 0 && _amountPaid <= _remaining + 1e-6;

  Future<void> _submit() async {
    if (!_valid || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final ref = _ref.text.trim();
      final r = await widget.state.api.settleOrder(widget.orderId, _method, _amountPaid, ref.isEmpty ? null : ref);
      if (!mounted) return;
      if (r.ok) {
        Navigator.pop(context, true);
        return;
      }
      setState(() => _error = r.message ?? 'Failed to settle order');
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.panel,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24), side: const BorderSide(color: AppColors.borderStrong)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.border))),
              child: Row(children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                      color: AppColors.emerald500.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.account_balance_wallet_outlined, size: 20, color: AppColors.emerald400),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Settle Order',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                    Text(formatZoneSubtitle(widget.zone), style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
                  ]),
                ),
                SquareIconButton(icon: Icons.close, size: 32, onPressed: () => Navigator.pop(context, false)),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: _loading
                  ? const Text('Loading balance…', style: TextStyle(fontSize: 12, color: AppColors.slate500))
                  : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      FaintCard(
                        child: Row(children: [
                          const Expanded(
                              child: Text('Remaining balance', style: TextStyle(fontSize: 12, color: AppColors.slate300))),
                          Text(peso(_remaining),
                              style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
                        ]),
                      ),
                      const SizedBox(height: 16),
                      const FieldLabel('Payment Method'),
                      Wrap(spacing: 6, runSpacing: 6, children: [
                        for (final m in _paymentMethods)
                          ChoiceChip(
                            label: Text(m),
                            selected: _method == m,
                            onSelected: (_) => setState(() => _method = m),
                            selectedColor: AppColors.indigo600,
                            backgroundColor: AppColors.subtle,
                            labelStyle: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: _method == m ? Colors.white : AppColors.slate300),
                            side: const BorderSide(color: AppColors.border),
                            showCheckmark: false,
                          ),
                      ]),
                      const SizedBox(height: 16),
                      const FieldLabel('Amount Paid (partial payment allowed)'),
                      TextField(
                        controller: _amount,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                        onChanged: (_) => setState(() {}),
                        style: const TextStyle(fontSize: 14, fontFeatures: tabular),
                        decoration: const InputDecoration(prefixText: '₱ '),
                      ),
                      const SizedBox(height: 16),
                      const FieldLabel('Payment Reference (optional)'),
                      TextField(
                        controller: _ref,
                        style: const TextStyle(fontSize: 14),
                        decoration: const InputDecoration(hintText: 'e.g. GCash ref no.'),
                      ),
                    ]),
            ),
            if (_error != null)
              Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), child: NoticeBox.error(_error!)),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                color: AppColors.footer,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: Align(
                alignment: Alignment.centerRight,
                child: PillButton(
                  label: _submitting
                      ? 'Settling…'
                      : (_amountPaid < _remaining ? 'Record Partial Payment' : 'Settle in Full'),
                  color: AppColors.emerald600,
                  onPressed: _loading || _submitting || !_valid ? null : _submit,
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
