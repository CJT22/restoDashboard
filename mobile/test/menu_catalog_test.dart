import 'package:flutter_test/flutter_test.dart';
import 'package:resto_dashboard/api/models.dart';
import 'package:resto_dashboard/state/menu_catalog.dart';

// How restoAdmin's menu is grouped for the order screens (state/menu_catalog.dart,
// same rules as src/services/menuCatalog.ts). Names and categories are Blue Moon's
// live ones.

MenuItem _item(int id, String name, String category, [double price = 100]) =>
    MenuItem(id: id, name: name, price: price, categoryName: category);

void main() {
  final menu = [
    _item(457, 'ROOM 1', 'Room Charge', 1100),
    _item(474, 'ROOM 1 HALF', 'Room Charge', 550),
    _item(473, 'ADDITONAL PAX', 'Room Charge'),
    _item(397, 'Takoyaki', 'Other Foods', 500),
    _item(349, 'Water', 'Other Drinks', 60),
    _item(300, 'Mojito', 'Cocktail', 250),
    _item(301, 'Margarita', 'Cocktail Menu', 300),
    _item(538, 'Egg', 'Additional Food', 30),
    _item(505, 'Broken glass', 'Additional Bar', 300),
    _item(454, 'Billiard', 'Games'),
    _item(999, 'Mystery Item', 'Brand New Category'),
    _item(10, 'SET A (2Pax)', 'Set Menu', 2200),
  ];
  final catalog = buildMenuCatalog(menu, const []);
  String? groupOf(int id) => catalog.items.where((it) => it.id == id).firstOrNull?.groupId;

  test('room charge items stay hidden, but additional pax is offered in Extras', () {
    expect(groupOf(457), isNull);
    expect(groupOf(474), isNull);
    expect(groupOf(473), 'extras');
    expect(catalog.paxItem?.id, 473);
  });

  test("set menus named for a number of pax aren't the pax charge", () {
    expect(groupOf(10), 'mains');
  });

  test('current and old category names land in their groups', () {
    expect(groupOf(397), 'sizzling');
    expect(groupOf(349), 'nonAlcoholic');
    expect(groupOf(300), 'liquor');
    expect(groupOf(301), 'liquor');
    expect(groupOf(538), 'extras');
    expect(groupOf(505), 'extras');
    expect(groupOf(454), 'extras');
  });

  test('a category restoAdmin adds later goes to Extras, not nowhere', () {
    expect(groupOf(999), 'extras');
  });

  test('no pax item when restoAdmin has none', () {
    expect(buildMenuCatalog([_item(1, 'Takoyaki', 'Other Foods')], const []).paxItem, isNull);
  });
}
