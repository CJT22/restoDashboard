import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import 'common.dart';
import 'order_screen.dart';

double _roundToHalf(double v) => (v * 2).round() / 2;

/// Starts an order for a linked zone with no open order
/// (src/components/NewOrderScreen.tsx). Pops with true once the order exists.
class NewOrderScreen extends StatefulWidget {
  final DashboardState state;
  final Zone zone;
  const NewOrderScreen({super.key, required this.state, required this.zone});

  @override
  State<NewOrderScreen> createState() => _NewOrderScreenState();
}

class _NewOrderScreenState extends State<NewOrderScreen> with MenuCatalogLoader {
  final _cart = OrderCart();
  String _orderType = 'DINE_IN';
  // This table's hourly room-charge rate (0 = none), fetched on demand.
  double _roomRate = 0;
  double _roomQty = 1;
  bool _submitting = false;
  String? _error;
  List<Map<String, dynamic>>? _insufficient;
  int? _conflictOrderId;

  Zone get zone => widget.zone;

  @override
  void initState() {
    super.initState();
    loadCatalog(widget.state.api);
    _cart.addListener(_changed);
    widget.state.roomRate(zone).then((rate) {
      if (mounted) setState(() => _roomRate = rate);
    });
  }

  void _changed() => setState(() {});

  @override
  void dispose() {
    _cart.removeListener(_changed);
    _cart.dispose();
    super.dispose();
  }

  bool get _hasRoom => _roomRate > 0;
  // Staff can lower it to 0 to waive the room charge, as in the staff app.
  // A waived room needs at least one item: restoAdmin won't take an empty order.
  bool get _roomWaived => _hasRoom && _roomQty <= 0;
  double get _roomTotal => _hasRoom ? _roomQty * _roomRate : 0;
  bool get _canSubmit => !_cart.isEmpty || (_hasRoom && !_roomWaived);

  // After adding to the existing order: fetch it so the detail view opens on it.
  Future<void> _finish() async {
    final fresh = await widget.state.api.activeOrderForTable(zone.adminTableId!);
    widget.state.orderChanged(zone, fresh);
    if (mounted) Navigator.of(context).pop(fresh != null);
  }

  // Sent, or saved on this tablet when restoAdmin can't be reached; the
  // zone shows it either way, and the detail view opens on it.
  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
      _insufficient = null;
    });
    try {
      final r = await widget.state.createOrder(zone, _orderType, _cart.items, _hasRoom ? _roomQty : null);
      if (r.ok) {
        if (mounted) Navigator.of(context).pop(zone.activeOrder != null);
        return;
      }
      if (r.kind == 'conflict') {
        _conflictOrderId = r.existingOrderId ?? 0;
        _error = r.message;
      } else if (r.kind == 'insufficient') {
        _insufficient = r.insufficient;
      } else {
        _error = r.message ?? 'Failed to create order';
      }
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() => _submitting = false);
  }

  Future<void> _addToExisting() async {
    if (_conflictOrderId == null || _cart.isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
      _insufficient = null;
    });
    try {
      final r = await widget.state.api.addItems(_conflictOrderId!, _cart.payload());
      if (r.ok) {
        await _finish();
        return;
      }
      if (r.kind == 'insufficient') {
        _insufficient = r.insufficient;
      } else {
        _error = r.message ?? 'Failed to add items to the existing order';
      }
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final total = _cart.subtotal + _roomTotal;
    final conflict = _conflictOrderId != null;
    // Extra guests in a room. A plain cart line (it's also in Extras), so it's
    // sent and totalled as usual, but like Room Charge it isn't listed under
    // Order Items: its stepper is the one place to change it.
    final pax = _hasRoom ? catalog?.paxItem : null;
    final paxQty = pax == null ? 0.0 : _cart.qtyOf(pax.id);
    final itemCount = _cart.unitCount - paxQty.toInt();

    final aside = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(
        child: ListView(padding: const EdgeInsets.all(16), children: [
          ListenableBuilder(
            listenable: widget.state,
            builder: (context, _) => widget.state.online
                ? const SizedBox.shrink()
                : const Padding(
                    padding: EdgeInsets.only(bottom: 16),
                    child: OfflineNotice('Offline. This order will be saved on this tablet and sent to restoAdmin '
                        'when the connection is back.'),
                  ),
          ),
          const FieldLabel('Order Type'),
          Row(children: [
            for (final (value, label) in orderTypes) ...[
              if (value != orderTypes.first.$1) const SizedBox(width: 6),
              Expanded(
                child: PillButton(
                  label: label,
                  height: 38,
                  fontSize: 12,
                  color: _orderType == value ? AppColors.indigo600 : AppColors.subtle,
                  textColor: _orderType == value ? Colors.white : AppColors.slate300,
                  borderColor: _orderType == value ? AppColors.indigo500 : AppColors.border,
                  onPressed: () => setState(() => _orderType = value),
                ),
              ),
            ],
          ]),
          if (_hasRoom) ...[
            const SizedBox(height: 16),
            const FieldLabel('Room Charge'),
            FaintCard(
              padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    _roomWaived
                        ? const Text('Waived',
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.emerald400))
                        : Text('${formatQty(_roomQty)}h × ${pesoShort(_roomRate)}',
                            style: const TextStyle(fontSize: 13, color: Colors.white)),
                    Text(_roomWaived ? '${pesoShort(_roomRate)}/hr not charged' : 'Lower to 0 to waive',
                        style: const TextStyle(fontSize: 11, color: AppColors.slate500)),
                  ]),
                ),
                QtyStepper(
                  amount: peso(_roomTotal),
                  onDecrement: _roomQty <= 0 ? null : () => setState(() => _roomQty = _roundToHalf(_roomQty - 0.5)),
                  onIncrement: () => setState(() => _roomQty = _roundToHalf(_roomQty + 0.5)),
                  onReset: _roomQty == 1 ? null : () => setState(() => _roomQty = 1),
                  resetLabel: 'Reset to 1 hour',
                ),
              ]),
            ),
          ],
          if (pax != null) ...[
            const SizedBox(height: 16),
            const FieldLabel('Additional Pax'),
            FaintCard(
              padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${formatQty(paxQty)} × ${pesoShort(pax.price)}',
                        style: const TextStyle(fontSize: 13, color: Colors.white)),
                    const Text('Per extra guest', style: TextStyle(fontSize: 11, color: AppColors.slate500)),
                  ]),
                ),
                QtyStepper(
                  amount: peso(paxQty * pax.price),
                  onDecrement: paxQty <= 0 ? null : () => _cart.decrement(pax.id),
                  onIncrement: () => _cart.add(pax),
                  onReset: paxQty <= 0 ? null : () => _cart.remove(pax.id),
                  resetLabel: 'Clear additional pax',
                ),
              ]),
            ),
          ],
          const SizedBox(height: 16),
          FieldLabel('Order Items', suffix: itemCount > 0 ? '$itemCount' : null),
          CartLineList(cart: _cart, emptyText: 'Tap items on the menu to add them.', hideMenuId: pax?.id),
          if (_roomWaived && _cart.isEmpty) ...[
            const SizedBox(height: 8),
            const Text('A waived room needs at least one item to start an order.',
                style: TextStyle(fontSize: 11, color: AppColors.slate500)),
          ],
          if (_insufficient != null && _insufficient!.isNotEmpty) ...[
            const SizedBox(height: 12),
            InsufficientNotice(_insufficient!),
          ],
          if (_error != null && !conflict) ...[const SizedBox(height: 12), NoticeBox.error(_error!)],
          if (conflict) ...[
            const SizedBox(height: 12),
            const NoticeBox(
              color: AppColors.amber500,
              textColor: AppColors.amber200,
              child: Text('This table already has an active order. Add these items to it instead?'),
            ),
          ],
        ]),
      ),
      Container(
        padding: const EdgeInsets.all(16),
        decoration: const BoxDecoration(color: AppColors.footer, border: Border(top: BorderSide(color: AppColors.border))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (catalog != null) ...[
            QuickAddDrinks(
              drinks: catalog!.quickDrinks,
              qtyOf: _cart.qtyOf,
              onAdd: _cart.add,
              onDecrement: (d) => _cart.decrement(d.id),
            ),
            const SizedBox(height: 12),
          ],
          Row(children: [
            const Expanded(child: Text('Total', style: TextStyle(fontSize: 12, color: AppColors.slate400))),
            Text(peso(total),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
          ]),
          const SizedBox(height: 12),
          conflict
              ? PillButton(
                  label: _submitting ? 'Adding…' : 'Add Items to Existing Order',
                  color: AppColors.amber600,
                  height: 46,
                  expand: true,
                  onPressed: _submitting || _cart.isEmpty ? null : _addToExisting,
                )
              : PillButton(
                  label: _submitting ? 'Creating…' : 'Create Order',
                  height: 46,
                  expand: true,
                  onPressed: _submitting || !_canSubmit ? null : _submit,
                ),
        ]),
      ),
    ]);

    return OrderScreen(
      title: 'New Order',
      subtitle: formatZoneSubtitle(zone, _roomRate),
      catalog: catalog,
      catalogError: catalogError,
      cart: _cart,
      dirty: !_cart.isEmpty && !_submitting,
      aside: aside,
    );
  }
}
