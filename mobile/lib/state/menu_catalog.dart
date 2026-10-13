import '../api/api_client.dart';
import '../api/models.dart';
import '../util/format.dart';

// The branch menu as the order screens browse it: restoAdmin's menu grouped
// into staff-facing sections and ranked by sales. Same groups and rules as
// the web dashboard's src/services/menuCatalog.ts.

class MenuGroup {
  final String id;
  final String label;
  // restoAdmin CATEGORY_NAMEs, lower-cased, in the order their chips show.
  final List<String> categories;
  const MenuGroup(this.id, this.label, this.categories);
}

const menuGroups = [
  MenuGroup('sizzling', 'Sizzling & Pulutan', ['filipino food', 'platter', 'fries', 'shrimp']),
  MenuGroup('chicken', 'Chicken & Wings', ['chicken']),
  MenuGroup('mains', 'Mains & Rice', ['rice', 'pizza', 'pasta', 'noodle and soup', 'steak', 'salad', 'set menu']),
  MenuGroup('beers', 'Beers & Soju', ['local beer', 'imported beer', 'soju', 'cocktail soju']),
  MenuGroup('liquor', 'Cocktails & Liquor', ['cocktail menu', 'liquor per shot', 'whiskey', 'tequila', 'wine and champagne']),
  MenuGroup('nonAlcoholic', 'Non-Alcoholic', ['soda in can', 'fruit shakes', 'ade', 'coffee', 'frappe']),
  MenuGroup('desserts', 'Desserts', ['dessert']),
  // Catch-all: also gets any category restoAdmin adds later.
  MenuGroup('extras', 'Extras', ['others', 'additional', 'games']),
];

const _fallbackGroupId = 'extras';

// restoAdmin's "Room Charge" items would bill a room twice on top of the
// room-charge stepper.
const _hiddenCategories = ['room charge'];

const _quickDrinkCategories = ['local beer', 'imported beer', 'soju', 'cocktail soju', 'soda in can', 'fruit shakes', 'ade'];
final _quickDrinkName = RegExp(r'\b(water|iced tea)\b', caseSensitive: false);
const _quickDrinkCount = 12;

const topRevenuePreviewCount = 12;
const _topRevenueCount = 48;

class CatalogItem {
  final MenuItem item;
  final String groupId;
  final double salesQty;
  final double revenue;
  const CatalogItem(this.item, this.groupId, this.salesQty, this.revenue);

  int get id => item.id;
  String get name => item.name;
  double get price => item.price;
  String get categoryName => item.categoryName;
}

class CatalogGroup {
  final MenuGroup group;
  // The group's categories that have items: configured ones first, then any
  // unlisted ones A–Z.
  final List<String> presentCategories;
  final List<CatalogItem> items;
  const CatalogGroup(this.group, this.presentCategories, this.items);
}

class MenuCatalog {
  final List<CatalogItem> items;
  final List<CatalogGroup> groups;
  final List<CatalogItem> topRevenue;
  final List<CatalogItem> quickDrinks;
  const MenuCatalog(this.items, this.groups, this.topRevenue, this.quickDrinks);
}

String _norm(String s) => s.trim().toLowerCase();

MenuCatalog buildMenuCatalog(List<MenuItem> menu, List<MenuPopularity> popularity) {
  final stats = {for (final p in popularity) p.menuId: p};
  final groupOfCategory = <String, String>{
    for (final g in menuGroups)
      for (final c in g.categories) c: g.id,
  };

  int byName(CatalogItem a, CatalogItem b) => naturalCompare(a.name, b.name);

  final items = menu
      .where((m) => !_hiddenCategories.contains(_norm(m.categoryName)))
      .map((m) => CatalogItem(
            m,
            groupOfCategory[_norm(m.categoryName)] ?? _fallbackGroupId,
            stats[m.id]?.qty ?? 0,
            stats[m.id]?.revenue ?? 0,
          ))
      .toList()
    ..sort(byName);

  final groups = <CatalogGroup>[];
  for (final g in menuGroups) {
    final groupItems = items.where((it) => it.groupId == g.id).toList();
    if (groupItems.isEmpty) continue;
    final present = groupItems.map((it) => it.categoryName).toSet();
    final configured = <String>[];
    for (final c in g.categories) {
      for (final p in present) {
        if (_norm(p) == c) configured.add(p);
      }
    }
    final unlisted = present.where((p) => !configured.contains(p)).toList()..sort();
    groups.add(CatalogGroup(g, [...configured, ...unlisted], groupItems));
  }

  final topRevenue = items.where((it) => it.revenue > 0).toList()
    ..sort((a, b) {
      final c = b.revenue.compareTo(a.revenue);
      return c != 0 ? c : b.salesQty.compareTo(a.salesQty);
    });

  final quickDrinks = items
      .where((it) => _quickDrinkCategories.contains(_norm(it.categoryName)) || _quickDrinkName.hasMatch(it.name))
      .toList()
    ..sort((a, b) {
      var c = b.salesQty.compareTo(a.salesQty);
      if (c != 0) return c;
      c = b.revenue.compareTo(a.revenue);
      return c != 0 ? c : byName(a, b);
    });

  return MenuCatalog(
    items,
    groups,
    topRevenue.take(_topRevenueCount).toList(),
    quickDrinks.take(_quickDrinkCount).toList(),
  );
}

// Shared by the order screens and Quick Add Drinks, so opening one after
// another doesn't refetch. Short-lived so menu edits show up within minutes.
const _cacheFor = Duration(minutes: 2);
DateTime? _cachedAt;
Future<MenuCatalog>? _cached;

Future<MenuCatalog> loadMenuCatalog(ApiClient api) {
  final cached = _cached;
  if (cached != null && _cachedAt != null && DateTime.now().difference(_cachedAt!) < _cacheFor) return cached;
  final future = Future.wait([
    api.menu(),
    // Rankings are a nicety: without them the screens still work, unranked.
    api.menuPopularity().catchError((_) => <MenuPopularity>[]),
  ]).then((r) => buildMenuCatalog(r[0] as List<MenuItem>, r[1] as List<MenuPopularity>));
  _cached = future;
  _cachedAt = DateTime.now();
  // Don't cache a failure: the next screen should retry.
  future.catchError((Object _) {
    if (identical(_cached, future)) _cached = null;
    return const MenuCatalog([], [], [], []);
  });
  return future;
}
