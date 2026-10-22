import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../state/menu_catalog.dart';
import '../state/offline_queue.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/room_timer.dart';
import 'add_items_screen.dart';
import 'common.dart';
import 'new_order_screen.dart';
import 'settle_dialog.dart';

double _roundToHalf(double v) => (v * 2).round() / 2;

/// Opens a zone the way the web dashboard does: a linked zone with no open
/// order goes straight to New Order; once there's an order (or after one is
/// created), its detail view.
Future<void> openZone(BuildContext context, DashboardState state, Zone zone) async {
  if (zone.adminTableId != null && zone.activeOrder == null) {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => NewOrderScreen(state: state, zone: zone)),
    );
    if (created != true || !context.mounted) return;
  }
  if (!context.mounted) return;
  await showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.7),
    builder: (_) => TableDetailDialog(state: state, zone: zone),
  );
}

/// A zone's status and open order, with every order action
/// (src/components/TableDetailModal.tsx).
class TableDetailDialog extends StatefulWidget {
  final DashboardState state;
  final Zone zone;
  const TableDetailDialog({super.key, required this.state, required this.zone});

  @override
  State<TableDetailDialog> createState() => _TableDetailDialogState();
}

class _TableDetailDialogState extends State<TableDetailDialog> {
  String? _error;
  List<Map<String, dynamic>>? _insufficient;
  bool _confirmingCancel = false;
  bool _actionBusy = false;
  // The item row / drink whose change is in flight, so repeat taps can't race it.
  int? _savingItemId;
  int? _savingDrinkId;
  // This table's hourly room-charge rate (0 = none), fetched on open.
  double _roomRate = 0;
  bool _roomSaving = false;
  MenuCatalog? _catalog;
  // Once an order has shown, its going away (cancelled or settled, here or
  // in restoAdmin) closes this dialog.
  bool _hadOrder = false;
  bool _closing = false;

  DashboardState get state => widget.state;
  Zone get zone => widget.zone;

  @override
  void initState() {
    super.initState();
    _hadOrder = zone.activeOrder != null;
    state.addListener(_onStateChanged);
    final adminId = zone.adminTableId;
    if (adminId != null) {
      // Fresh copy on open; live events keep it current after that. Offline,
      // the last copy stays (and the notice says so).
      state.refreshOrder(zone).catchError((Object e) {
        if (mounted && !(e is ApiException && e.network)) setState(() => _error = e.toString());
      });
      state.roomRate(zone).then((r) {
        if (mounted) setState(() => _roomRate = r);
      });
    }
    loadMenuCatalog(state.api).then((c) {
      if (mounted) setState(() => _catalog = c);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    if (!mounted) return;
    if (zone.activeOrder != null) {
      _hadOrder = true;
    } else if (_hadOrder && !_closing) {
      _closing = true;
      // Also closes anything opened on top of it (Add Items, Settle), whose
      // order is gone too.
      final route = ModalRoute.of(context);
      final navigator = Navigator.of(context);
      navigator.popUntil((r) => r == route);
      navigator.pop();
      return;
    }
    setState(() {});
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _error = null;
      _insufficient = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  void _fail(MutationResult r, String fallback) {
    if (!mounted) return;
    setState(() {
      if (r.kind == 'insufficient') {
        _insufficient = r.insufficient;
      } else {
        _error = r.message ?? fallback;
      }
    });
  }

  Future<void> _changeRoomCharge(double qty) async {
    final order = zone.activeOrder;
    if (order == null || _roomRate <= 0 || _roomSaving) return;
    setState(() => _roomSaving = true);
    await _run(() async {
      // Saved on this tablet instead when restoAdmin can't be reached.
      final r = await state.updateRoomCharge(zone, order, _roundToHalf(qty < 0 ? 0 : qty));
      if (!r.ok) _fail(r, 'Failed to update room charge');
    });
    if (mounted) setState(() => _roomSaving = false);
  }

  // A ±1 acts on the row's newest line, leaving older ones (often already
  // prepared) alone; a newest line at its last unit is deleted instead.
  Future<void> _stepRow(OrderLineGroup row, int delta) async {
    final newest = row.lines.last;
    final r = delta < 0 && newest.quantity <= 1
        ? await state.api.deleteItem(newest.id)
        : await state.api.updateItemQty(newest.id, newest.quantity + delta);
    if (r.ok) {
      await state.refreshOrder(zone);
    } else {
      _fail(r, 'Failed to update item');
    }
  }

  Future<void> _rowStep(OrderLineGroup row, int delta) async {
    if (_savingItemId != null || _savingDrinkId != null) return;
    if (delta < 0 && row.quantity <= 1) return;
    setState(() => _savingItemId = row.id);
    await _run(() => _stepRow(row, delta));
    if (mounted) setState(() => _savingItemId = null);
  }

  // Trash removes the item entirely: every line it has on the order.
  Future<void> _deleteRow(OrderLineGroup row) async {
    if (_savingItemId != null || _savingDrinkId != null) return;
    setState(() => _savingItemId = row.id);
    await _run(() async {
      try {
        for (final line in row.lines) {
          final r = await state.api.deleteItem(line.id);
          if (!r.ok) {
            _fail(r, 'Failed to delete item');
            break;
          }
        }
      } finally {
        // Also after a partial failure, so the rows show what's really left.
        await state.refreshOrder(zone).catchError((_) {});
      }
    });
    if (mounted) setState(() => _savingItemId = null);
  }

  // Settling, cancelling and editing items need restoAdmin, and an order
  // that's still saved on this tablet has nothing there to change yet.
  bool _canChange(OrderSummary order) => state.online && !order.isLocal;

  // A row can be edited once all of its lines are in restoAdmin.
  bool _canEditRow(OrderSummary order, OrderLineGroup row) => _canChange(order) && !row.lines.any((l) => l.isLocal);

  // A drink already on the order goes on its row like that row's +; with no
  // connection it's added as a new line instead (saved on this tablet).
  Future<void> _quickDrink(CatalogItem drink) async {
    final order = zone.activeOrder;
    if (order == null || _savingDrinkId != null || _savingItemId != null) return;
    setState(() => _savingDrinkId = drink.id);
    await _run(() async {
      final rows = groupOrderLines(order.items);
      for (final row in rows) {
        if (row.menuId == drink.id && _canEditRow(order, row)) {
          await _stepRow(row, 1);
          return;
        }
      }
      final r = await state.addItems(zone, order, [QueuedItem(menuId: drink.id, name: drink.name, unitPrice: drink.price, qty: 1)]);
      if (!r.ok) _fail(r, 'Failed to add ${drink.name}');
    });
    if (mounted) setState(() => _savingDrinkId = null);
  }

  Future<void> _confirm() async {
    final order = zone.activeOrder;
    if (order == null) return;
    setState(() => _actionBusy = true);
    await _run(() async {
      final r = await state.api.confirmOrder(order.id);
      r.ok ? state.orderChanged(zone, order.copyWith(status: 2)) : _fail(r, 'Failed to confirm order');
    });
    if (mounted) setState(() => _actionBusy = false);
  }

  Future<void> _cancel() async {
    final order = zone.activeOrder;
    if (order == null) return;
    setState(() => _actionBusy = true);
    await _run(() async {
      final r = await state.api.cancelOrder(order.id);
      r.ok ? state.orderChanged(zone, null) : _fail(r, 'Failed to cancel order');
    });
    if (mounted) setState(() => _actionBusy = false);
  }

  Future<void> _settle() async {
    final order = zone.activeOrder;
    if (order == null) return;
    if (await showSettleDialog(context, state: state, zone: zone, orderId: order.id)) {
      state.orderChanged(zone, null);
    }
  }

  Future<void> _addItems() async {
    final order = zone.activeOrder;
    if (order == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => AddItemsScreen(state: state, zone: zone, order: order)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final order = zone.activeOrder;
    final rows = groupOrderLines(order?.items ?? const []);
    // The current room's hours; 0 = waived.
    final roomQty = roomHoursOf(order, _roomRate);
    final busyRow = _savingItemId != null;

    return Dialog(
      backgroundColor: AppColors.panel,
      insetPadding: const EdgeInsets.all(24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24), side: const BorderSide(color: AppColors.borderStrong)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _header(),
          Flexible(
            child: ListView(shrinkWrap: true, padding: const EdgeInsets.all(24), children: [
              Row(children: [
                const Icon(Icons.restaurant_menu, size: 16, color: AppColors.amber400),
                const SizedBox(width: 8),
                const Text('Order', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
                const Spacer(),
                if (order != null)
                  Text('${formatOrderType(order.orderType)} • ${formatItemCount(rows.length)}',
                      style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
              ]),
              const SizedBox(height: 12),
              if (zone.adminTableId == null) ...[
                const NoticeBox(
                  color: AppColors.amber500,
                  textColor: AppColors.amber200,
                  icon: Icons.warning_amber_rounded,
                  child: Text("This zone isn't linked to a restoAdmin table, so orders can't be placed from here. "
                      'Please let a developer know.'),
                ),
                const SizedBox(height: 12),
              ],
              if (order != null && !state.online) ...[
                const OfflineNotice('Offline. Added items and room hours are saved on this tablet and sent to '
                    'restoAdmin when the connection is back. Settling, cancelling and editing items need a connection.'),
                const SizedBox(height: 12),
              ] else if (order != null && order.isLocal) ...[
                const OfflineNotice('This order is saved on this tablet and is being sent to restoAdmin. '
                    'Settling, cancelling and editing items wait until it has arrived.'),
                const SizedBox(height: 12),
              ],
              if (_error != null) ...[NoticeBox.error(_error!), const SizedBox(height: 12)],
              if (_insufficient != null && _insufficient!.isNotEmpty) ...[
                InsufficientNotice(_insufficient!),
                const SizedBox(height: 12),
              ],
              if (order == null && zone.adminTableId != null)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
                ),
              if (order != null) ...[
                if (_roomRate > 0) ...[
                  FaintCard(
                    padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
                    child: Row(children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(children: [
                            const TextSpan(text: 'Room Charge — '),
                            if (roomQty <= 0) ...[
                              const TextSpan(
                                  text: 'Waived', style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.emerald400)),
                              TextSpan(
                                  text: '  (${pesoShort(_roomRate)}/hr not charged)',
                                  style: const TextStyle(fontSize: 11, color: AppColors.slate500)),
                            ] else ...[
                              TextSpan(text: '${formatQty(roomQty)}h × ${pesoShort(_roomRate)}'),
                              const TextSpan(
                                  text: '  (0 to waive)', style: TextStyle(fontSize: 11, color: AppColors.slate500)),
                            ],
                          ]),
                          style: const TextStyle(fontSize: 13, color: Colors.white),
                        ),
                      ),
                      QtyStepper(
                        amount: peso(roomQty * _roomRate),
                        onDecrement: _roomSaving || roomQty <= 0 ? null : () => _changeRoomCharge(roomQty - 0.5),
                        onIncrement: _roomSaving ? null : () => _changeRoomCharge(roomQty + 0.5),
                        onReset: _roomSaving || roomQty == 1 ? null : () => _changeRoomCharge(1),
                        resetLabel: 'Reset to 1 hour',
                      ),
                    ]),
                  ),
                  const SizedBox(height: 8),
                ],
                NowBuilder(
                  enabled: getRoomTiming(order, DateTime.now(), fallbackRate: _roomRate) != null,
                  builder: (context, now) {
                    final t = getRoomTiming(order, now, fallbackRate: _roomRate);
                    if (t == null) return const SizedBox.shrink();
                    final tone = timerTone(t);
                    final tint = switch (tone) {
                      TimerTone.normal => null,
                      TimerTone.endingSoon => AppColors.yellow400,
                      TimerTone.expired => AppColors.rose500,
                    };
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: FaintCard(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                        color: tint?.withValues(alpha: 0.1),
                        borderColor: tint?.withValues(alpha: 0.3),
                        child: Row(children: [
                          Expanded(
                            child: Text(
                                '${formatHours(t.hours)} booked · ${formatClockTime(t.start)} – ${formatClockTime(t.end)}',
                                style: const TextStyle(fontSize: 12, color: Colors.white)),
                          ),
                          Text(
                            t.expired ? 'EXPIRED +${formatDuration(t.remaining)}' : '${formatDuration(t.remaining)} left',
                            style: TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w700, color: timerColor(t), fontFeatures: tabular),
                          ),
                        ]),
                      ),
                    );
                  },
                ),
                if (rows.isEmpty)
                  const EmptyBox('No items on this order.')
                else
                  for (final row in rows)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: FaintCard(
                        padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
                        child: Row(children: [
                          Expanded(
                            child: Text('${formatQty(row.quantity)}x ${row.name}',
                                overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: Colors.white)),
                          ),
                          QtyStepper(
                            amount: peso(row.lineTotal),
                            onDecrement:
                                busyRow || row.quantity <= 1 || !_canEditRow(order, row) ? null : () => _rowStep(row, -1),
                            onIncrement: busyRow || !_canEditRow(order, row) ? null : () => _rowStep(row, 1),
                            onRemove: _canEditRow(order, row) ? () => _deleteRow(row) : null,
                          ),
                        ]),
                      ),
                    ),
                const SizedBox(height: 4),
                PillButton(label: 'Add Items', icon: Icons.add, height: 44, expand: true, onPressed: _addItems),
                if (_catalog != null) ...[
                  const SizedBox(height: 12),
                  QuickAddDrinks(
                    drinks: _catalog!.quickDrinks,
                    qtyOf: (menuId) {
                      for (final r in rows) {
                        if (r.menuId == menuId) return r.quantity;
                      }
                      return 0;
                    },
                    onAdd: _quickDrink,
                    busyId: _savingDrinkId,
                  ),
                ],
              ],
            ]),
          ),
          _footer(order),
        ]),
      ),
    );
  }

  Widget _header() => Container(
        padding: const EdgeInsets.all(24),
        decoration: const BoxDecoration(
          gradient: LinearGradient(colors: [Color(0x0AFFFFFF), Colors.transparent]),
          border: Border(bottom: BorderSide(color: AppColors.border)),
        ),
        child: Row(children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.indigo500.withValues(alpha: 0.2),
              border: Border.all(color: AppColors.indigo500.withValues(alpha: 0.3)),
              borderRadius: BorderRadius.circular(16),
            ),
            alignment: Alignment.center,
            child: Text(zone.code,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.indigo400)),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(
                  child: Text(zone.name,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white)),
                ),
                const SizedBox(width: 8),
                StatusBadge(zone.status, withIcon: true),
                if (zone.unsynced) ...[const SizedBox(width: 6), const UnsyncedBadge()],
              ]),
              const SizedBox(height: 2),
              Text('Floor ${zone.floor} • ${zoneKindLabel(zone, _roomRate)}',
                  style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
            ]),
          ),
          SquareIconButton(icon: Icons.close, iconSize: 20, onPressed: () => Navigator.pop(context)),
        ]),
      );

  Widget _footer(OrderSummary? order) => Container(
        padding: const EdgeInsets.all(20),
        decoration: const BoxDecoration(color: AppColors.footer, border: Border(top: BorderSide(color: AppColors.border))),
        child: Row(children: [
          Text.rich(
            TextSpan(children: [
              const TextSpan(text: 'Grand Total: '),
              TextSpan(
                  text: peso(order?.grandTotal ?? 0),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
            ]),
            style: const TextStyle(fontSize: 12, color: AppColors.slate400, fontFeatures: tabular),
          ),
          const Spacer(),
          if (order != null) ...[
            CancelOrderControl(
              confirming: _confirmingCancel,
              busy: _actionBusy,
              enabled: _canChange(order),
              onAsk: () => setState(() => _confirmingCancel = true),
              onConfirm: _cancel,
              onDismiss: () => setState(() => _confirmingCancel = false),
            ),
            // Dashboard orders are confirmed on creation; this only shows for
            // a Pending order that came from restoAdmin.
            if (order.status == 3) ...[
              const SizedBox(width: 8),
              PillButton(
                  label: 'Confirm',
                  icon: Icons.check,
                  height: 38,
                  fontSize: 12,
                  onPressed: _actionBusy || !_canChange(order) ? null : _confirm),
            ],
            if (order.status == 2) ...[
              const SizedBox(width: 8),
              PillButton(
                  label: 'Settle',
                  icon: Icons.account_balance_wallet_outlined,
                  color: AppColors.emerald600,
                  height: 38,
                  fontSize: 12,
                  onPressed: _canChange(order) ? _settle : null),
            ],
            const SizedBox(width: 8),
          ],
          PillButton(label: 'Done', height: 38, fontSize: 12, onPressed: () => Navigator.pop(context)),
        ]),
      );
}
