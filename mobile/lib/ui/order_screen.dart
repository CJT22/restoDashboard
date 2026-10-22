import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../state/menu_catalog.dart';
import '../state/offline_queue.dart';
import '../theme.dart';
import '../util/format.dart';
import 'common.dart';

/// Loads the grouped, ranked menu once per screen.
mixin MenuCatalogLoader<T extends StatefulWidget> on State<T> {
  MenuCatalog? catalog;
  String? catalogError;

  void loadCatalog(ApiClient api) {
    loadMenuCatalog(api).then((c) {
      if (mounted) setState(() => catalog = c);
    }).catchError((Object e) {
      if (mounted) setState(() => catalogError = e.toString());
    });
  }
}

class CartLine {
  final int menuId;
  final String name;
  final double unitPrice;
  int qty;
  CartLine(this.menuId, this.name, this.unitPrice, this.qty);
}

/// Items staged on an order screen before they're sent to restoAdmin. One
/// line per menu item; tapping an item again bumps its quantity.
class OrderCart extends ChangeNotifier {
  final List<CartLine> lines = [];

  void add(CatalogItem item) {
    for (final l in lines) {
      if (l.menuId == item.id) {
        l.qty++;
        notifyListeners();
        return;
      }
    }
    lines.add(CartLine(item.id, item.name, item.price, 1));
    notifyListeners();
  }

  /// Down to zero removes the line (the tile/drink steppers).
  void decrement(int menuId) {
    for (final l in lines) {
      if (l.menuId == menuId) {
        if (l.qty > 1) {
          l.qty--;
        } else {
          lines.remove(l);
        }
        notifyListeners();
        return;
      }
    }
  }

  /// The cart list's own stepper stops at 1; removing is its trash button's job.
  void setQty(int menuId, int qty) {
    if (qty < 1) return;
    for (final l in lines) {
      if (l.menuId == menuId) l.qty = qty;
    }
    notifyListeners();
  }

  void remove(int menuId) {
    lines.removeWhere((l) => l.menuId == menuId);
    notifyListeners();
  }

  double qtyOf(int menuId) {
    for (final l in lines) {
      if (l.menuId == menuId) return l.qty.toDouble();
    }
    return 0;
  }

  double get subtotal => lines.fold(0, (s, l) => s + l.unitPrice * l.qty);
  int get unitCount => lines.fold(0, (s, l) => s + l.qty);
  bool get isEmpty => lines.isEmpty;

  List<Map<String, num>> payload() =>
      [for (final l in lines) {'menuId': l.menuId, 'qty': l.qty, 'unitPrice': l.unitPrice}];

  /// The lines as DashboardState's order changes take them (they're kept
  /// with names, in case they're saved for later).
  List<QueuedItem> get items =>
      [for (final l in lines) QueuedItem(menuId: l.menuId, name: l.name, unitPrice: l.unitPrice, qty: l.qty)];
}

class CartLineList extends StatelessWidget {
  final OrderCart cart;
  final String emptyText;
  // Leaves out a line that has its own stepper elsewhere on the screen (New
  // Order's Additional Pax), so it isn't listed twice.
  final int? hideMenuId;
  const CartLineList({super.key, required this.cart, required this.emptyText, this.hideMenuId});

  @override
  Widget build(BuildContext context) {
    final lines = cart.lines.where((l) => l.menuId != hideMenuId).toList();
    if (lines.isEmpty) return EmptyBox(emptyText);
    return Column(children: [
      for (final l in lines)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: FaintCard(
            padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
            child: Row(children: [
              Expanded(
                child: Text('${l.qty}x ${l.name}',
                    overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: Colors.white)),
              ),
              QtyStepper(
                amount: peso(l.unitPrice * l.qty),
                onDecrement: l.qty <= 1 ? null : () => cart.setQty(l.menuId, l.qty - 1),
                onIncrement: () => cart.setQty(l.menuId, l.qty + 1),
                onRemove: () => cart.remove(l.menuId),
              ),
            ]),
          ),
        ),
    ]);
  }
}

const _groupIcons = {
  'sizzling': Icons.soup_kitchen_outlined,
  'chicken': Icons.set_meal_outlined,
  'mains': Icons.local_pizza_outlined,
  'beers': Icons.sports_bar_outlined,
  'liquor': Icons.local_bar_outlined,
  'nonAlcoholic': Icons.local_drink_outlined,
  'desserts': Icons.icecream_outlined,
  'extras': Icons.inventory_2_outlined,
};

/// Full-screen item picker shared by New Order and Add Items
/// (src/components/OrderScreen.tsx): categories on the left, the menu in the
/// middle (Top Revenue first, then every group), the caller's cart on the right.
class OrderScreen extends StatefulWidget {
  final String title;
  final String subtitle;
  final MenuCatalog? catalog;
  final String? catalogError;
  final OrderCart cart;
  // True while there are staged items, so closing asks before discarding them.
  final bool dirty;
  final Widget aside;

  const OrderScreen({
    super.key,
    required this.title,
    required this.subtitle,
    required this.catalog,
    required this.catalogError,
    required this.cart,
    required this.dirty,
    required this.aside,
  });

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  String _selection = 'all'; // all | top | a group id
  String? _subCategory;
  final _search = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<bool> _confirmDiscard() => confirmDialog(
        context,
        title: 'Discard these items?',
        description: "The items you've picked haven't been sent to restoAdmin yet. Closing now throws them away.",
        confirmText: 'Discard',
      );

  Future<void> _requestClose() async {
    if (!widget.dirty || await _confirmDiscard()) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  void _select(String next) {
    setState(() {
      _selection = next;
      _subCategory = null;
      _search.clear();
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  @override
  Widget build(BuildContext context) {
    final catalog = widget.catalog;
    final hasTop = (catalog?.topRevenue.isNotEmpty ?? false);
    final query = _search.text.trim().toLowerCase();

    return PopScope(
      canPop: !widget.dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (_search.text.isNotEmpty) {
          setState(_search.clear);
          return;
        }
        _requestClose();
      },
      child: Scaffold(
        backgroundColor: AppColors.orderBg,
        body: SafeArea(
          child: Column(children: [
            // Header
            Container(
              height: 64,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: const BoxDecoration(
                color: AppColors.panel,
                border: Border(bottom: BorderSide(color: AppColors.border)),
              ),
              child: Row(children: [
                SquareIconButton(icon: Icons.close, onPressed: _requestClose, iconSize: 20),
                const SizedBox(width: 16),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                      color: AppColors.indigo500.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.assignment_outlined, size: 20, color: AppColors.indigo400),
                ),
                const SizedBox(width: 12),
                Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                  Text(widget.subtitle, style: const TextStyle(fontSize: 12, color: AppColors.slate400)),
                ]),
                const Spacer(),
                SizedBox(
                  width: 480,
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    style: const TextStyle(fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'Search the menu…',
                      prefixIcon: const Icon(Icons.search, size: 18, color: AppColors.slate500),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.close, size: 16, color: AppColors.slate400),
                              onPressed: () => setState(_search.clear),
                            ),
                    ),
                  ),
                ),
              ]),
            ),
            Expanded(
              child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                // Category rail
                Container(
                  width: 200,
                  decoration: const BoxDecoration(
                    color: AppColors.rail,
                    border: Border(right: BorderSide(color: AppColors.border)),
                  ),
                  child: ListView(padding: const EdgeInsets.all(8), children: [
                    _railButton('All', Icons.grid_view_rounded, catalog?.items.length, _selection == 'all' && query.isEmpty,
                        () => _select('all')),
                    if (hasTop)
                      _railButton('Top Revenue', Icons.local_fire_department_outlined, null,
                          _selection == 'top' && query.isEmpty, () => _select('top'),
                          accent: true),
                    for (final g in catalog?.groups ?? <CatalogGroup>[])
                      _railButton(g.group.label, _groupIcons[g.group.id] ?? Icons.inventory_2_outlined, g.items.length,
                          _selection == g.group.id && query.isEmpty, () => _select(g.group.id)),
                    if (catalog == null && widget.catalogError == null) _railSkeleton(),
                  ]),
                ),
                // Menu
                Expanded(
                  child: ListenableBuilder(
                    listenable: widget.cart,
                    builder: (context, _) => ListView(
                      controller: _scroll,
                      padding: const EdgeInsets.all(16),
                      children: _main(catalog, query, hasTop),
                    ),
                  ),
                ),
                // Cart
                Container(
                  width: 360,
                  decoration: const BoxDecoration(
                    color: AppColors.panel,
                    border: Border(left: BorderSide(color: AppColors.border)),
                  ),
                  child: widget.aside,
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  List<Widget> _main(MenuCatalog? catalog, String query, bool hasTop) {
    if (widget.catalogError != null) {
      return [Text(widget.catalogError!, style: const TextStyle(fontSize: 13, color: AppColors.rose400))];
    }
    if (catalog == null) return [_menuSkeleton()];

    if (query.isNotEmpty) {
      final results = catalog.items
          .where((it) => it.name.toLowerCase().contains(query) || it.categoryName.toLowerCase().contains(query))
          .toList();
      return [
        _section('${results.length} result${results.length == 1 ? '' : 's'} for “${_search.text.trim()}”'),
        if (results.isEmpty)
          const Text('No menu items match. Try part of the name, e.g. “sisig”.',
              style: TextStyle(fontSize: 12, color: AppColors.slate500))
        else
          _grid(results),
      ];
    }

    if (_selection == 'top') {
      return [_section('Top Revenue Items', icon: Icons.local_fire_department_outlined), _grid(catalog.topRevenue, ranked: true)];
    }

    for (final g in catalog.groups) {
      if (g.group.id != _selection) continue;
      final items = _subCategory == null ? g.items : g.items.where((it) => it.categoryName == _subCategory).toList();
      return [
        _section(g.group.label, count: g.items.length),
        if (g.presentCategories.length > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final c in <String?>[null, ...g.presentCategories])
                ChoiceChip(
                  label: Text(c ?? 'All'),
                  selected: _subCategory == c,
                  onSelected: (_) => setState(() => _subCategory = c),
                  selectedColor: AppColors.indigo600,
                  backgroundColor: AppColors.subtle,
                  side: const BorderSide(color: AppColors.border),
                  showCheckmark: false,
                  shape: const StadiumBorder(),
                  labelStyle: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: _subCategory == c ? Colors.white : AppColors.slate300),
                ),
            ]),
          ),
        _grid(items),
      ];
    }

    // All: Top Revenue preview, then every group in rail order.
    return [
      if (hasTop) ...[
        _section(
          'Top Revenue Items',
          icon: Icons.local_fire_department_outlined,
          action: catalog.topRevenue.length > topRevenuePreviewCount
              ? TextButton(
                  onPressed: () => _select('top'),
                  child: Text('View all (${catalog.topRevenue.length})',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.indigo300)),
                )
              : null,
        ),
        _grid(catalog.topRevenue.take(topRevenuePreviewCount).toList(), ranked: true),
        const SizedBox(height: 24),
      ],
      for (final g in catalog.groups) ...[
        _section(g.group.label, count: g.items.length),
        _grid(g.items),
        const SizedBox(height: 24),
      ],
    ];
  }

  // While the menu loads: placeholder sections shaped like the real ones
  // (a header over a grid of name/price/+ tiles), so nothing jumps when it
  // arrives.
  Widget _menuSkeleton() => Semantics(
        label: 'Loading menu',
        child: SkeletonPulse(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (final (headerWidth, tiles) in const [(150.0, 12), (110.0, 18)]) ...[
              SizedBox(height: 32, child: Align(alignment: Alignment.centerLeft, child: SkeletonBar(width: headerWidth, height: 12))),
              const SizedBox(height: 10),
              _skeletonGrid(tiles),
              const SizedBox(height: 24),
            ],
          ]),
        ),
      );

  static const _skeletonNameWidths = [0.72, 0.5, 0.62, 0.42, 0.8, 0.55];

  Widget _skeletonGrid(int count) {
    return LayoutBuilder(builder: (context, box) {
      const gap = 8.0;
      final cols = ((box.maxWidth + gap) / (200 + gap)).floor().clamp(1, 8);
      final tileW = (box.maxWidth - gap * (cols - 1)) / cols;
      return Wrap(spacing: gap, runSpacing: gap, children: [
        for (var i = 0; i < count; i++)
          Container(
            width: tileW,
            height: 64,
            padding: const EdgeInsets.fromLTRB(12, 0, 8, 0),
            decoration: BoxDecoration(
              color: AppColors.faint,
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(children: [
              Expanded(
                child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  FractionallySizedBox(
                    widthFactor: _skeletonNameWidths[i % _skeletonNameWidths.length],
                    child: const SkeletonBar(height: 12),
                  ),
                  const SizedBox(height: 8),
                  SkeletonBar(width: 44, height: 10, color: AppColors.amber300.withValues(alpha: 0.15)),
                ]),
              ),
              const SizedBox(width: 8),
              Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(color: AppColors.border, shape: BoxShape.circle),
              ),
            ]),
          ),
      ]);
    });
  }

  Widget _railSkeleton() => SkeletonPulse(
        child: Column(children: [
          for (final w in const [92.0, 118.0, 104.0, 86.0, 112.0, 98.0, 76.0, 64.0])
            Container(
              height: 46,
              margin: const EdgeInsets.only(bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(children: [
                const SkeletonBar(width: 17, height: 17),
                const SizedBox(width: 10),
                SkeletonBar(width: w, height: 11),
              ]),
            ),
        ]),
      );

  Widget _section(String title, {int? count, IconData? icon, Widget? action}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: SizedBox(
          height: 32,
          child: Row(children: [
            if (icon != null) ...[Icon(icon, size: 16, color: AppColors.amber400), const SizedBox(width: 8)],
            Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
            if (count != null) ...[
              const SizedBox(width: 8),
              Text('$count', style: const TextStyle(fontSize: 12, color: AppColors.slate500, fontFeatures: tabular)),
            ],
            const Spacer(),
            ?action,
          ]),
        ),
      );

  Widget _grid(List<CatalogItem> items, {bool ranked = false}) {
    return LayoutBuilder(builder: (context, box) {
      const gap = 8.0;
      final cols = ((box.maxWidth + gap) / (200 + gap)).floor().clamp(1, 8);
      final tileW = (box.maxWidth - gap * (cols - 1)) / cols;
      return Wrap(spacing: gap, runSpacing: gap, children: [
        for (var i = 0; i < items.length; i++)
          SizedBox(width: tileW, child: _tile(items[i], ranked ? i + 1 : null)),
      ]);
    });
  }

  // Name + price, no image, so many items fit on screen. Tapping the name
  // adds one; once it's in the cart a −/qty/+ stepper appears.
  Widget _tile(CatalogItem item, int? rank) {
    final qty = widget.cart.qtyOf(item.id);
    final inCart = qty > 0;
    return Container(
      constraints: const BoxConstraints(minHeight: 64),
      decoration: BoxDecoration(
        color: inCart ? AppColors.indigo500.withValues(alpha: 0.1) : AppColors.faint,
        border: Border.all(color: inCart ? AppColors.indigo500.withValues(alpha: 0.5) : AppColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(children: [
        Expanded(
          child: InkWell(
            borderRadius: const BorderRadius.horizontal(left: Radius.circular(12)),
            onTap: () => widget.cart.add(item),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(
                  TextSpan(children: [
                    if (rank != null)
                      TextSpan(text: '#$rank ', style: const TextStyle(color: AppColors.amber400, fontFeatures: tabular)),
                    TextSpan(text: item.name),
                  ]),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.white, height: 1.3),
                ),
                const SizedBox(height: 2),
                Text(pesoShort(item.price),
                    style: const TextStyle(fontSize: 12, color: AppColors.amber300, fontFeatures: tabular)),
              ]),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: inCart
              ? Container(
                  decoration: BoxDecoration(color: AppColors.indigo600, borderRadius: BorderRadius.circular(8)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    _miniButton(Icons.remove, () => widget.cart.decrement(item.id)),
                    SizedBox(
                      width: 20,
                      child: Text(formatQty(qty),
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, fontFeatures: tabular)),
                    ),
                    _miniButton(Icons.add, () => widget.cart.add(item)),
                  ]),
                )
              : Material(
                  color: AppColors.border,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => widget.cart.add(item),
                    child: const SizedBox(width: 34, height: 34, child: Icon(Icons.add, size: 18, color: Colors.white)),
                  ),
                ),
        ),
      ]),
    );
  }

  Widget _miniButton(IconData icon, VoidCallback onTap) => InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: SizedBox(width: 34, height: 34, child: Icon(icon, size: 15, color: Colors.white)),
      );

  Widget _railButton(String label, IconData icon, int? count, bool active, VoidCallback onTap, {bool accent = false}) {
    final bg = active ? (accent ? AppColors.amber500.withValues(alpha: 0.2) : AppColors.indigo600) : Colors.transparent;
    final fg = active ? (accent ? AppColors.amber200 : Colors.white) : AppColors.slate300;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: active && accent ? AppColors.amber500.withValues(alpha: 0.4) : Colors.transparent),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 46),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              Icon(icon, size: 17, color: accent && !active ? AppColors.amber400 : fg),
              const SizedBox(width: 10),
              Expanded(child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: fg))),
              if (count != null)
                Text('$count',
                    style: TextStyle(
                        fontSize: 11, color: active ? const Color(0xFFE0E7FF) : AppColors.slate500, fontFeatures: tabular)),
            ]),
          ),
        ),
      ),
    );
  }
}
