import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../state/menu_catalog.dart';
import '../theme.dart';
import '../util/format.dart';

/// Rebuilds [builder] every second with the current time, while [enabled].
class NowBuilder extends StatefulWidget {
  final bool enabled;
  final Widget Function(BuildContext context, DateTime now) builder;
  const NowBuilder({super.key, this.enabled = true, required this.builder});

  @override
  State<NowBuilder> createState() => _NowBuilderState();
}

class _NowBuilderState extends State<NowBuilder> {
  Timer? _timer;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(NowBuilder old) {
    super.didUpdateWidget(old);
    if (old.enabled != widget.enabled) _sync();
  }

  void _sync() {
    _timer?.cancel();
    _timer = null;
    _now = DateTime.now();
    if (widget.enabled) {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _now = DateTime.now()));
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _now);
}

/// A small square icon button, like the web dashboard's w-8/w-9 buttons.
class SquareIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final double size;
  final double iconSize;
  final Color? color;
  final Color? background;
  final String? tooltip;
  const SquareIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.size = 36,
    this.iconSize = 18,
    this.color,
    this.background,
    this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    final button = Material(
      color: background ?? AppColors.subtle,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onPressed,
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(icon, size: iconSize, color: onPressed == null ? AppColors.slate600 : (color ?? AppColors.slate400)),
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip!, child: button);
  }
}

/// A filled pill button (Confirm, Settle, Create Order, …).
class PillButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final Color color;
  final Color textColor;
  final Color? borderColor;
  final double height;
  final bool expand;
  final double fontSize;
  const PillButton({
    super.key,
    required this.label,
    this.icon,
    required this.onPressed,
    this.color = AppColors.indigo600,
    this.textColor = Colors.white,
    this.borderColor,
    this.height = 40,
    this.expand = false,
    this.fontSize = 13,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null;
    final content = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon != null) ...[Icon(icon, size: fontSize + 3, color: textColor), const SizedBox(width: 6)],
        Flexible(
          child: Text(label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: textColor, fontSize: fontSize, fontWeight: FontWeight.w700)),
        ),
      ],
    );
    return Opacity(
      opacity: disabled ? 0.55 : 1,
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onPressed,
          child: Container(
            height: height,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: borderColor == null
                ? null
                : BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: borderColor!)),
            alignment: Alignment.center,
            child: content,
          ),
        ),
      ),
    );
  }
}

/// Coloured notice box: errors, warnings, info.
class NoticeBox extends StatelessWidget {
  final Widget child;
  final Color color; // the -500 shade
  final Color textColor;
  final IconData? icon;
  const NoticeBox({super.key, required this.child, required this.color, required this.textColor, this.icon});

  factory NoticeBox.error(String message) =>
      NoticeBox(color: AppColors.rose500, textColor: AppColors.rose200, child: Text(message));

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        border: Border.all(color: color.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(color: textColor, fontSize: 12, height: 1.4),
        child: icon == null
            ? child
            : Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(icon, size: 16, color: textColor),
                const SizedBox(width: 8),
                Expanded(child: child),
              ]),
      ),
    );
  }
}

/// restoAdmin's "not enough stock" answer to a create/add.
class InsufficientNotice extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  const InsufficientNotice(this.items, {super.key});

  @override
  Widget build(BuildContext context) {
    return NoticeBox(
      color: AppColors.amber500,
      textColor: AppColors.amber200,
      icon: Icons.warning_amber_rounded,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Insufficient inventory', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        for (final i in items)
          Text('${i['ingredientName'] ?? i['name']}: need ${i['required']}, have ${i['available']} ${i['unit'] ?? ''}'),
      ]),
    );
  }
}

/// A table's status as a coloured pill ("OCCUPIED").
class StatusBadge extends StatelessWidget {
  final TableStatus status;
  final bool withIcon;
  const StatusBadge(this.status, {super.key, this.withIcon = false});

  @override
  Widget build(BuildContext context) {
    final c = statusColors[status]!;
    final icon = switch (status) {
      TableStatus.occupied => Icons.people_alt_outlined,
      TableStatus.reserved => Icons.event_outlined,
      TableStatus.unavailable => Icons.block,
      TableStatus.available => Icons.check,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: c.badgeBg,
        border: Border.all(color: c.base),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (withIcon) ...[Icon(icon, size: 12, color: c.text), const SizedBox(width: 4)],
        Text(c.label.toUpperCase(),
            style: TextStyle(color: c.text, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.3)),
      ]),
    );
  }
}

/// The − ₱amount + control shared by the room-charge row and order item
/// rows. The trailing slot holds a trash (remove) or reset button, and is
/// always reserved so rows line up.
class QtyStepper extends StatelessWidget {
  final String amount;
  final VoidCallback? onDecrement;
  final VoidCallback? onIncrement;
  final VoidCallback? onRemove;
  final VoidCallback? onReset;
  final bool showTrailing;
  final String resetLabel;
  const QtyStepper({
    super.key,
    required this.amount,
    required this.onDecrement,
    required this.onIncrement,
    this.onRemove,
    this.onReset,
    this.showTrailing = true,
    this.resetLabel = 'Reset',
  });

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      SquareIconButton(icon: Icons.remove, onPressed: onDecrement, size: 34, iconSize: 16, color: AppColors.slate300),
      SizedBox(
        width: 88,
        child: Text(amount,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.slate300, fontFeatures: tabular)),
      ),
      SquareIconButton(icon: Icons.add, onPressed: onIncrement, size: 34, iconSize: 16, color: AppColors.slate300),
      if (showTrailing) ...[
        const SizedBox(width: 4),
        SizedBox(
          width: 34,
          height: 34,
          child: onRemove != null
              ? SquareIconButton(
                  icon: Icons.delete_outline,
                  onPressed: onRemove,
                  size: 34,
                  iconSize: 17,
                  background: Colors.transparent,
                  color: AppColors.slate500,
                  tooltip: 'Remove item')
              : SquareIconButton(
                  icon: Icons.restart_alt,
                  onPressed: onReset,
                  size: 34,
                  iconSize: 17,
                  background: Colors.transparent,
                  color: AppColors.slate500,
                  tooltip: resetLabel),
        ),
      ],
    ]);
  }
}

/// Segmented picker (floor scopes, sales periods, floor filters).
class Segmented<T> extends StatelessWidget {
  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;
  final bool dense;
  const Segmented({super.key, required this.options, required this.value, required this.onChanged, this.dense = false});

  TextStyle _labelStyle(bool selected) => TextStyle(
        fontSize: dense ? 10 : 12,
        fontWeight: FontWeight.w700,
        color: selected ? Colors.white : (dense ? AppColors.slate300 : AppColors.slate400),
      );

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(dense ? 2 : 4),
      decoration: BoxDecoration(
        color: dense ? const Color(0x14FFFFFF) : const Color(0xFF16182A),
        border: Border.all(color: dense ? const Color(0x14FFFFFF) : AppColors.border),
        borderRadius: BorderRadius.circular(dense ? 8 : 14),
      ),
      child: dense
          ? LayoutBuilder(
              builder: (context, c) {
                final widths = _denseWidths(context, c.maxWidth);
                // The last takes what's left, so rounding never overflows.
                return Row(children: [
                  for (var i = 0; i < options.length - 1; i++) SizedBox(width: widths[i], child: _segment(options[i])),
                  Expanded(child: _segment(options.last)),
                ]);
              },
            )
          : Row(mainAxisSize: MainAxisSize.min, children: [for (final o in options) _segment(o)]),
    );
  }

  // Each segment gets its label's width plus an equal share of what's left
  // (like CSS `flex: auto` on the web), so longer labels like "Today" and
  // "Month" still fit when equal quarters would cut them short. Only if
  // the labels can't all fit do they shrink, in proportion.
  List<double> _denseWidths(BuildContext context, double available) {
    final natural = [
      for (final (_, label) in options)
        () {
          final painter = TextPainter(
            text: TextSpan(text: label, style: _labelStyle(false)),
            textDirection: TextDirection.ltr,
            textScaler: MediaQuery.textScalerOf(context),
            maxLines: 1,
          )..layout();
          final width = painter.width.ceilToDouble() + 6; // + padding 2+2, margin 1+1
          painter.dispose();
          return width;
        }(),
    ];
    final total = natural.fold<double>(0, (a, b) => a + b);
    if (total <= available) {
      final extra = (available - total) / natural.length;
      return [for (final w in natural) w + extra];
    }
    return [for (final w in natural) w * available / total];
  }

  Widget _segment((T, String) option) {
    final (v, label) = option;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onChanged(v),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: EdgeInsets.symmetric(horizontal: dense ? 1 : 2),
        padding: EdgeInsets.symmetric(horizontal: dense ? 2 : 12, vertical: dense ? 3 : 8),
        decoration: BoxDecoration(
          color: v == value ? AppColors.indigo600 : Colors.transparent,
          borderRadius: BorderRadius.circular(dense ? 6 : 10),
        ),
        alignment: Alignment.center,
        child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: _labelStyle(v == value)),
      ),
    );
  }
}

/// Best-selling everyday drinks one tap away, for a table's next round.
/// With [onDecrement] (order screens) a drink in the cart gets a −/qty/+
/// stepper; without it (order detail, which saves every tap) each card stays
/// an Add button, with what's already on the order shown by the price.
class QuickAddDrinks extends StatefulWidget {
  final List<CatalogItem> drinks;
  final double Function(int menuId) qtyOf;
  final ValueChanged<CatalogItem> onAdd;
  final ValueChanged<CatalogItem>? onDecrement;
  final int? busyId;
  const QuickAddDrinks({
    super.key,
    required this.drinks,
    required this.qtyOf,
    required this.onAdd,
    this.onDecrement,
    this.busyId,
  });

  @override
  State<QuickAddDrinks> createState() => _QuickAddDrinksState();
}

class _QuickAddDrinksState extends State<QuickAddDrinks> {
  bool _expanded = true;

  @override
  Widget build(BuildContext context) {
    if (widget.drinks.isEmpty) return const SizedBox.shrink();
    return Container(
      decoration: BoxDecoration(
        color: AppColors.faint,
        border: Border.all(color: AppColors.subtle),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Row(children: [
              Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                    color: AppColors.amber500.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                child: const Icon(Icons.sports_bar_outlined, size: 15, color: AppColors.amber400),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Quick Add Drinks',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white)),
              ),
              AnimatedRotation(
                turns: _expanded ? 0.5 : 0,
                duration: const Duration(milliseconds: 200),
                child: const Icon(Icons.expand_more, size: 18, color: AppColors.slate400),
              ),
            ]),
          ),
        ),
        if (_expanded)
          SizedBox(
            height: 108,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              itemCount: widget.drinks.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) => _card(widget.drinks[i]),
            ),
          ),
      ]),
    );
  }

  Widget _card(CatalogItem d) {
    final qty = widget.qtyOf(d.id);
    final inCart = qty > 0 && widget.onDecrement != null;
    return Container(
      width: 112,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: qty > 0 ? AppColors.indigo500.withValues(alpha: 0.1) : AppColors.faint,
        border: Border.all(color: qty > 0 ? AppColors.indigo500.withValues(alpha: 0.4) : AppColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          height: 28,
          child: Text(d.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white, height: 1.2)),
        ),
        const SizedBox(height: 4),
        Row(children: [
          Text(pesoShort(d.price),
              style: const TextStyle(fontSize: 11, color: AppColors.amber300, fontFeatures: tabular)),
          const Spacer(),
          if (widget.onDecrement == null && qty > 0)
            Text('×${formatQty(qty)}', style: const TextStyle(fontSize: 11, color: AppColors.indigo300)),
        ]),
        const Spacer(),
        if (inCart)
          Container(
            height: 30,
            decoration: BoxDecoration(color: AppColors.indigo600, borderRadius: BorderRadius.circular(8)),
            child: Row(children: [
              _miniButton(Icons.remove, () => widget.onDecrement!(d)),
              Expanded(
                child: Text(formatQty(qty),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, fontFeatures: tabular)),
              ),
              _miniButton(Icons.add, () => widget.onAdd(d)),
            ]),
          )
        else
          PillButton(
            label: widget.busyId == d.id ? 'Adding…' : 'Add',
            icon: widget.busyId == d.id ? null : Icons.add,
            height: 30,
            fontSize: 11,
            onPressed: widget.busyId != null ? null : () => widget.onAdd(d),
          ),
      ]),
    );
  }

  Widget _miniButton(IconData icon, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(width: 30, height: 30, child: Icon(icon, size: 14, color: Colors.white)),
      );
}

/// Asks before something that can't be undone. Resolves true if confirmed.
Future<bool> confirmDialog(
  BuildContext context, {
  required String title,
  required String description,
  String confirmText = 'Confirm',
  IconData confirmIcon = Icons.delete_outline,
  IconData icon = Icons.warning_amber_rounded,
}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.8),
    builder: (context) => Dialog(
      backgroundColor: AppColors.cardAlt,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24), side: const BorderSide(color: Color(0x33FFFFFF))),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.rose500.withValues(alpha: 0.2),
                  border: Border.all(color: AppColors.rose500.withValues(alpha: 0.3)),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: AppColors.rose400),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                  const SizedBox(height: 6),
                  Text(description, style: const TextStyle(fontSize: 13, color: AppColors.slate300, height: 1.45)),
                ]),
              ),
            ]),
            const SizedBox(height: 20),
            const Divider(height: 1),
            const SizedBox(height: 16),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              PillButton(
                  label: 'Cancel',
                  color: AppColors.subtle,
                  textColor: AppColors.slate300,
                  onPressed: () => Navigator.pop(context, false)),
              const SizedBox(width: 10),
              PillButton(
                  label: confirmText,
                  icon: confirmIcon,
                  color: AppColors.rose600,
                  onPressed: () => Navigator.pop(context, true)),
            ]),
          ]),
        ),
      ),
    ),
  );
  return result ?? false;
}

/// "Cancel this order?" as an inline Confirm/No pair, or a Cancel button.
class CancelOrderControl extends StatelessWidget {
  final bool confirming;
  final bool busy;
  final String prompt;
  final String buttonLabel;
  final VoidCallback onAsk;
  final VoidCallback onConfirm;
  final VoidCallback onDismiss;
  final bool expand;
  const CancelOrderControl({
    super.key,
    required this.confirming,
    required this.busy,
    required this.onAsk,
    required this.onConfirm,
    required this.onDismiss,
    this.prompt = 'Cancel this order?',
    this.buttonLabel = 'Cancel Order',
    this.expand = false,
  });

  @override
  Widget build(BuildContext context) {
    if (!confirming) {
      return PillButton(
        label: buttonLabel,
        color: AppColors.rose500.withValues(alpha: 0.12),
        borderColor: AppColors.rose500.withValues(alpha: 0.3),
        textColor: AppColors.rose300,
        height: 38,
        fontSize: 12,
        expand: expand,
        onPressed: onAsk,
      );
    }
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Text(prompt, style: const TextStyle(fontSize: 12, color: AppColors.rose300)),
      const SizedBox(width: 8),
      PillButton(
          label: 'Confirm',
          icon: Icons.block,
          color: AppColors.rose600,
          height: 38,
          fontSize: 12,
          onPressed: busy ? null : onConfirm),
      const SizedBox(width: 6),
      PillButton(
          label: 'No', color: AppColors.subtle, textColor: AppColors.slate400, height: 38, fontSize: 12, onPressed: onDismiss),
    ]);
  }
}

/// The section label above a group of controls ("ORDER TYPE").
class FieldLabel extends StatelessWidget {
  final String text;
  final String? suffix;
  const FieldLabel(this.text, {super.key, this.suffix});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: text),
          if (suffix != null) TextSpan(text: ' · $suffix', style: const TextStyle(color: AppColors.slate500, fontWeight: FontWeight.w400)),
        ]), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.slate300)),
      );
}

/// A rounded faint card, the building block of most rows.
class FaintCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final Color? borderColor;
  const FaintCard({super.key, required this.child, this.padding = const EdgeInsets.all(12), this.color, this.borderColor});

  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: color ?? AppColors.faint,
          border: Border.all(color: borderColor ?? AppColors.subtle),
          borderRadius: BorderRadius.circular(16),
        ),
        child: child,
      );
}

/// A dashed-looking empty placeholder.
class EmptyBox extends StatelessWidget {
  final String text;
  const EmptyBox(this.text, {super.key});

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0x05FFFFFF),
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(text, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: AppColors.slate500)),
      );
}

/// Gently pulses a loading skeleton's opacity, on its own layer so the rest
/// of the screen isn't repainted with it.
class SkeletonPulse extends StatefulWidget {
  final Widget child;
  const SkeletonPulse({super.key, required this.child});

  @override
  State<SkeletonPulse> createState() => _SkeletonPulseState();
}

class _SkeletonPulseState extends State<SkeletonPulse> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
    ..repeat(reverse: true);
  late final _opacity = Tween(begin: 0.45, end: 1.0).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RepaintBoundary(child: FadeTransition(opacity: _opacity, child: widget.child));
}

/// A rounded placeholder bar for loading skeletons.
class SkeletonBar extends StatelessWidget {
  final double? width;
  final double height;
  final Color color;
  const SkeletonBar({super.key, this.width, required this.height, this.color = const Color(0x1AFFFFFF)});

  @override
  Widget build(BuildContext context) => Container(
        width: width,
        height: height,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
      );
}
