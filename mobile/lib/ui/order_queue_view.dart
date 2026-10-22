import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/dashboard_state.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/room_timer.dart';
import 'common.dart';
import 'directory_view.dart';
import 'settle_dialog.dart';

class _ReceiptRow {
  final String key;
  final String? qty;
  final String label;
  final double amount;
  final bool muted;
  const _ReceiptRow(this.key, this.label, this.amount, {this.qty, this.muted = false});
}

// The card's receipt: room charge, up to 5 item rows, "+N more items"
// carrying the rest, and whatever else restoAdmin's total holds (tax,
// discounts), so the rows always add up to the total under them.
List<_ReceiptRow> _receipt(OrderSummary order, double roomRate) {
  final rows = <_ReceiptRow>[];
  final service = order.serviceCharge ?? 0;
  final hours = bookedHours(service, roomRate);
  if (roomRate > 0 && hours <= 0) {
    // A waived room still gets its row, so it's clear it wasn't billed.
    rows.add(const _ReceiptRow('room', 'Room charge · Waived', 0));
  } else if (service > 0) {
    rows.add(_ReceiptRow('room', roomRate > 0 ? 'Room charge · ${formatHours(hours)}' : 'Service charge', service));
  }
  final lines = groupOrderLines(order.items);
  for (final l in lines.take(maxListedOrderItems)) {
    rows.add(_ReceiptRow('item-${l.menuId}', l.name, l.lineTotal, qty: '${formatQty(l.quantity)}×'));
  }
  final hidden = lines.skip(maxListedOrderItems).toList();
  if (hidden.isNotEmpty) {
    rows.add(_ReceiptRow('more', '+${hidden.length} more item${hidden.length == 1 ? '' : 's'}',
        hidden.fold(0.0, (s, l) => s + l.lineTotal),
        muted: true));
  }
  final itemsTotal = lines.fold(0.0, (s, l) => s + l.lineTotal);
  final other = order.grandTotal - itemsTotal - service;
  if (other.abs() >= 0.005) {
    rows.add(_ReceiptRow('other', other > 0 ? 'Tax & other charges' : 'Discount', other, muted: true));
  }
  return rows;
}

/// Open orders, longest-waiting first, with Confirm / Cancel / Settle right
/// on each card (src/components/OrderQueueView.tsx).
class OrderQueueView extends StatefulWidget {
  final DashboardState state;
  final int floor;
  final int floorRequest;
  final ValueChanged<int> onSelectFloor;
  final ValueChanged<Zone> onSelectZone;
  const OrderQueueView({
    super.key,
    required this.state,
    required this.floor,
    required this.floorRequest,
    required this.onSelectFloor,
    required this.onSelectZone,
  });

  @override
  State<OrderQueueView> createState() => _OrderQueueViewState();
}

class _OrderQueueViewState extends State<OrderQueueView> {
  late int? _floor = widget.floor;
  String? _busyZoneId;
  String? _confirmingCancelId;
  String? _error;

  DashboardState get state => widget.state;

  // A floor card tapped in the sidebar switches this view's floor too.
  @override
  void didUpdateWidget(OrderQueueView old) {
    super.didUpdateWidget(old);
    if (old.floorRequest != widget.floorRequest) _floor = widget.floor;
  }

  void _selectFloor(int? f) {
    setState(() => _floor = f);
    if (f != null) widget.onSelectFloor(f);
  }

  static DateTime? _start(Zone z) => z.activeOrder?.createdAt == null ? null : DateTime.tryParse(z.activeOrder!.createdAt!);

  Future<void> _confirm(Zone z) async {
    final order = z.activeOrder;
    if (order == null) return;
    setState(() {
      _busyZoneId = z.id;
      _error = null;
    });
    try {
      final r = await state.api.confirmOrder(order.id);
      if (r.ok) {
        state.orderChanged(z, order.copyWith(status: 2));
      } else {
        _error = r.message ?? 'Failed to confirm order';
      }
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() => _busyZoneId = null);
  }

  Future<void> _cancel(Zone z) async {
    final order = z.activeOrder;
    if (order == null) return;
    setState(() {
      _busyZoneId = z.id;
      _error = null;
    });
    try {
      final r = await state.api.cancelOrder(order.id);
      if (r.ok) {
        state.orderChanged(z, null);
        _confirmingCancelId = null;
      } else {
        _error = r.message ?? 'Failed to cancel order';
      }
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() => _busyZoneId = null);
  }

  Future<void> _settle(Zone z) async {
    final order = z.activeOrder;
    if (order == null) return;
    final settled = await showSettleDialog(context, state: state, zone: z, orderId: order.id);
    if (settled) state.orderChanged(z, null);
  }

  @override
  Widget build(BuildContext context) {
    final all = state.zones.where((z) => z.hasActiveOrder).toList();
    int countOn(int? f) => f == null ? all.length : all.where((z) => z.floor == f).length;
    // Oldest first, like a queue; unknown start times go last.
    final active = all.where((z) => _floor == null || z.floor == _floor).toList()
      ..sort((a, b) {
        final sa = _start(a), sb = _start(b);
        if (sa == null && sb == null) return 0;
        if (sa == null) return 1;
        if (sb == null) return -1;
        return sa.compareTo(sb);
      });
    final otherFloors = _floor == null ? <int>[] : [1, 2].where((f) => f != _floor && countOn(f) > 0).toList();

    return Container(
      decoration: const BoxDecoration(gradient: workspaceGradient),
      child: SafeArea(
        left: false,
        child: NowBuilder(
          enabled: active.isNotEmpty,
          builder: (context, now) => ListView(padding: const EdgeInsets.all(32), children: [
            PageHeader(
              title: 'Active Orders',
              icon: Icons.restaurant_menu,
              iconColor: AppColors.amber400,
              subtitle: 'Open orders, longest-waiting first. Confirm, cancel or settle them right here.',
              trailing: Segmented<int?>(options: floorFilterOptions(countOn), value: _floor, onChanged: _selectFloor),
            ),
            if (_error != null) ...[const SizedBox(height: 16), NoticeBox.error(_error!)],
            const SizedBox(height: 24),
            if (active.isEmpty)
              _empty(otherFloors, countOn)
            else
              for (final f in _floor == null ? [1, 2] : [_floor!])
                if (active.any((z) => z.floor == f)) ...[
                  if (_floor == null) floorHeading(f, active.where((z) => z.floor == f).length),
                  CardGrid(children: [for (final z in active.where((z) => z.floor == f)) _card(z, now)]),
                  const SizedBox(height: 32),
                ],
          ]),
        ),
      ),
    );
  }

  Widget _empty(List<int> otherFloors, int Function(int?) countOn) => Container(
        padding: const EdgeInsets.all(64),
        decoration: BoxDecoration(
          color: const Color(0x05FFFFFF),
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(children: [
          const Icon(Icons.check_circle_outline, size: 48, color: AppColors.emerald400),
          const SizedBox(height: 12),
          if (otherFloors.isNotEmpty) ...[
            Text('No active orders on the ${floorLabels[_floor]}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white)),
            const SizedBox(height: 4),
            Text('${otherFloors.map((f) => '${countOn(f)} on the ${floorLabels[f]}').join(' · ')}.',
                style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
            const SizedBox(height: 16),
            PillButton(
              label: 'Show all floors',
              color: AppColors.subtle,
              borderColor: AppColors.border,
              textColor: AppColors.slate200,
              fontSize: 12,
              onPressed: () => _selectFloor(null),
            ),
          ] else ...[
            const Text('All Clear! No Orders Need Action',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white)),
            const SizedBox(height: 4),
            const Text("New orders will appear here as soon as they're placed.",
                style: TextStyle(fontSize: 12, color: AppColors.slate400)),
          ],
        ]),
      );

  Widget _card(Zone z, DateTime now) {
    final order = z.activeOrder!;
    final busy = _busyZoneId == z.id;
    final roomRate = (order.roomRate ?? 0) > 0 ? order.roomRate! : (z.adminRoomCharge ?? 0);
    final timing = getRoomTiming(order, now, fallbackRate: roomRate);
    final start = _start(z);
    final rows = _receipt(order, roomRate);
    final confirming = _confirmingCancelId == z.id;
    // These need restoAdmin, and an order saved on this tablet isn't there yet.
    final canChange = state.online && !order.isLocal;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: zoneCardDecoration(z.status),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InkWell(onTap: () => widget.onSelectZone(z), child: ZoneCardHeader(zone: z, timing: timing, showFloor: true)),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: Text.rich(
              TextSpan(children: [
                TextSpan(text: '${formatOrderType(order.orderType)} • ${formatItemCount(groupOrderLines(order.items).length)}'),
                if (start != null)
                  TextSpan(
                    text: () {
                      final w = formatWait(now.difference(start));
                      // Short, so it fits beside "View Order →".
                      return w == 'just now' ? ' • just now' : ' • $w ago';
                    }(),
                    style: const TextStyle(color: AppColors.slate500),
                  ),
              ]),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: AppColors.slate300),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: () => widget.onSelectZone(z),
            child: const Text('View Order →',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.indigo400)),
          ),
        ]),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.only(top: 12),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.border))),
          child: rows.isEmpty
              ? const Text('No items yet.', style: TextStyle(fontSize: 12, color: AppColors.slate500))
              : Column(children: [
                  for (final r in rows)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(children: [
                        Expanded(
                          child: Text.rich(
                            TextSpan(children: [
                              if (r.qty != null)
                                TextSpan(
                                    text: '${r.qty} ',
                                    style: const TextStyle(color: AppColors.slate400, fontFeatures: tabular)),
                              TextSpan(text: r.label),
                            ]),
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: r.muted ? AppColors.slate400 : AppColors.slate200,
                              fontStyle: r.muted ? FontStyle.italic : null,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(peso(r.amount),
                            style: TextStyle(
                                fontSize: 12,
                                color: r.muted ? AppColors.slate400 : AppColors.slate300,
                                fontFeatures: tabular)),
                      ]),
                    ),
                ]),
        ),
        Container(
          margin: const EdgeInsets.only(top: 8),
          padding: const EdgeInsets.only(top: 12),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.border))),
          child: Row(children: [
            const Expanded(child: Text('Total', style: TextStyle(fontSize: 12, color: AppColors.slate400))),
            Text(peso(order.grandTotal),
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white, fontFeatures: tabular)),
          ]),
        ),
        const Spacer(),
        const SizedBox(height: 16),
        // Cancel and the next step side by side across the card; while
        // confirming a cancel, its prompt takes the row.
        if (confirming && canChange)
          CancelOrderControl(
            confirming: true,
            busy: busy,
            prompt: 'Cancel order?',
            onAsk: () {},
            onConfirm: () => _cancel(z),
            onDismiss: () => setState(() => _confirmingCancelId = null),
          )
        else
          Row(children: [
            Expanded(
              child: CancelOrderControl(
                confirming: false,
                busy: busy,
                buttonLabel: 'Cancel',
                expand: true,
                enabled: canChange,
                onAsk: () => setState(() => _confirmingCancelId = z.id),
                onConfirm: () => _cancel(z),
                onDismiss: () {},
              ),
            ),
            // Only for a Pending order from restoAdmin; dashboard orders
            // are confirmed on creation.
            if (order.status == 3) ...[
              const SizedBox(width: 8),
              Expanded(
                child: PillButton(
                    label: 'Confirm',
                    icon: Icons.check,
                    height: 38,
                    fontSize: 12,
                    expand: true,
                    onPressed: busy || !canChange ? null : () => _confirm(z)),
              ),
            ],
            if (order.status == 2) ...[
              const SizedBox(width: 8),
              Expanded(
                child: PillButton(
                    label: 'Settle',
                    icon: Icons.account_balance_wallet_outlined,
                    color: AppColors.emerald600,
                    height: 38,
                    fontSize: 12,
                    expand: true,
                    onPressed: canChange ? () => _settle(z) : null),
              ),
            ],
          ]),
      ]),
    );
  }
}
