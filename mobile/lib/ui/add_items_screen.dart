import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import 'common.dart';
import 'order_screen.dart';

/// Adds items to an open order (src/components/AddItemsScreen.tsx). Items
/// are staged here and sent in one call, so a round can't half-save and a
/// mis-tap is fixed before anything reaches restoAdmin.
class AddItemsScreen extends StatefulWidget {
  final DashboardState state;
  final Zone zone;
  final OrderSummary order;
  const AddItemsScreen({super.key, required this.state, required this.zone, required this.order});

  @override
  State<AddItemsScreen> createState() => _AddItemsScreenState();
}

class _AddItemsScreenState extends State<AddItemsScreen> with MenuCatalogLoader {
  final _cart = OrderCart();
  bool _showExisting = false;
  bool _submitting = false;
  String? _error;
  List<Map<String, dynamic>>? _insufficient;

  @override
  void initState() {
    super.initState();
    loadCatalog(widget.state.api);
    _cart.addListener(_changed);
  }

  void _changed() => setState(() {});

  @override
  void dispose() {
    _cart.removeListener(_changed);
    _cart.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_cart.isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
      _insufficient = null;
    });
    try {
      final r = await widget.state.api.addItems(widget.order.id, _cart.payload());
      if (r.ok) {
        await widget.state.refreshOrder(widget.zone).catchError((_) {});
        if (mounted) Navigator.of(context).pop();
        return;
      }
      if (r.kind == 'insufficient') {
        _insufficient = r.insufficient;
      } else {
        _error = r.message ?? 'Failed to add items';
      }
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    final existing = groupOrderLines(order.items);
    final existingUnits = order.items.fold<double>(0, (s, i) => s + i.quantity);

    final aside = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (existing.isNotEmpty) ...[
            FaintCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => setState(() => _showExisting = !_showExisting),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Row(children: [
                      Expanded(
                        child: Text('Already on this order · ${formatQty(existingUnits)}',
                            style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
                      ),
                      AnimatedRotation(
                        turns: _showExisting ? 0.5 : 0,
                        duration: const Duration(milliseconds: 200),
                        child: const Icon(Icons.expand_more, size: 18, color: AppColors.slate400),
                      ),
                    ]),
                  ),
                ),
                if (_showExisting)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                    child: Column(children: [
                      for (final it in existing)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(children: [
                            Expanded(
                              child: Text('${formatQty(it.quantity)}x ${it.name}',
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 12, color: AppColors.slate300)),
                            ),
                            Text(peso(it.lineTotal),
                                style: const TextStyle(fontSize: 12, color: AppColors.slate500, fontFeatures: tabular)),
                          ]),
                        ),
                    ]),
                  ),
              ]),
            ),
            const SizedBox(height: 16),
          ],
          FieldLabel('Adding', suffix: _cart.unitCount > 0 ? '${_cart.unitCount}' : null),
          CartLineList(cart: _cart, emptyText: 'Tap items on the menu to add them to this order.'),
          if (_insufficient != null && _insufficient!.isNotEmpty) ...[
            const SizedBox(height: 12),
            InsufficientNotice(_insufficient!),
          ],
          if (_error != null) ...[const SizedBox(height: 12), NoticeBox.error(_error!)],
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
            const Expanded(child: Text('Adding', style: TextStyle(fontSize: 12, color: AppColors.slate400))),
            Text(peso(_cart.subtotal),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
          ]),
          Row(children: [
            const Expanded(
                child: Text('Current order total', style: TextStyle(fontSize: 11, color: AppColors.slate500))),
            Text(peso(order.grandTotal),
                style: const TextStyle(fontSize: 11, color: AppColors.slate500, fontFeatures: tabular)),
          ]),
          const SizedBox(height: 12),
          PillButton(
            label: _submitting ? 'Adding…' : 'Add to Order',
            height: 46,
            expand: true,
            onPressed: _submitting || _cart.isEmpty ? null : _submit,
          ),
        ]),
      ),
    ]);

    return OrderScreen(
      title: 'Add Items',
      subtitle: formatZoneSubtitle(widget.zone),
      catalog: catalog,
      catalogError: catalogError,
      cart: _cart,
      dirty: !_cart.isEmpty && !_submitting,
      aside: aside,
    );
  }
}
