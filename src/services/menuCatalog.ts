// The branch menu as the order screens browse it: restoAdmin's menu, grouped
// into a few staff-facing sections and ranked by how well each item sells.
//
// Groups are built from restoAdmin's own category names (not item-name
// matching like the staff app's), so every item lands in exactly one group.
// A category not listed here falls into Extras rather than disappearing.

import { AdminMenuItem, getMenu, getMenuPopularity } from './orderSync';

export interface MenuGroup {
  id: string;
  label: string;
  // restoAdmin CATEGORY_NAMEs, lower-cased, in the order their sub-chips show.
  categories: string[];
}

export const MENU_GROUPS: MenuGroup[] = [
  { id: 'sizzling', label: 'Sizzling & Pulutan', categories: ['filipino food', 'platter', 'fries', 'shrimp'] },
  { id: 'chicken', label: 'Chicken & Wings', categories: ['chicken'] },
  {
    id: 'mains',
    label: 'Mains & Rice',
    categories: ['rice', 'pizza', 'pasta', 'noodle and soup', 'steak', 'salad', 'set menu'],
  },
  { id: 'beers', label: 'Beers & Soju', categories: ['local beer', 'imported beer', 'soju', 'cocktail soju'] },
  {
    id: 'liquor',
    label: 'Cocktails & Liquor',
    categories: ['cocktail menu', 'liquor per shot', 'whiskey', 'tequila', 'wine and champagne'],
  },
  { id: 'nonAlcoholic', label: 'Non-Alcoholic', categories: ['soda in can', 'fruit shakes', 'ade', 'coffee', 'frappe'] },
  { id: 'desserts', label: 'Desserts', categories: ['dessert'] },
  // Catch-all: also gets any category restoAdmin adds later.
  { id: 'extras', label: 'Extras', categories: ['others', 'additional', 'games'] },
];

const FALLBACK_GROUP_ID = 'extras';

// Never offered on the order screens. restoAdmin's "Room Charge" items
// (ROOM 1, ROOM 2, …) would bill a room a second time on top of the
// dashboard's own room-charge stepper.
const HIDDEN_CATEGORIES = ['room charge'];

// What Quick Add Drinks offers: everyday drinks a table reorders by the round,
// not bottles or cocktails. Water and iced tea sit in restoAdmin's "Others".
const QUICK_DRINK_CATEGORIES = ['local beer', 'imported beer', 'soju', 'cocktail soju', 'soda in can', 'fruit shakes', 'ade'];
const QUICK_DRINK_NAME = /\b(water|iced tea)\b/i;
const QUICK_DRINK_COUNT = 12;

export const TOP_REVENUE_PREVIEW_COUNT = 12;
const TOP_REVENUE_COUNT = 48;

export interface CatalogItem extends AdminMenuItem {
  groupId: string;
  salesQty: number;
  revenue: number;
}

export interface CatalogGroup extends MenuGroup {
  // Sub-chips: the group's categories that actually have items, in display
  // order (configured ones first, then any unlisted ones alphabetically).
  presentCategories: string[];
  items: CatalogItem[];
}

export interface MenuCatalog {
  items: CatalogItem[];
  groups: CatalogGroup[]; // only groups with items
  topRevenue: CatalogItem[]; // by revenue; empty when restoAdmin has no sales data
  quickDrinks: CatalogItem[];
  byId: Map<number, CatalogItem>;
}

const normalize = (s: string) => s.trim().toLowerCase();

// Categories and search list items A–Z: a fixed spot that staff can find by
// scanning, rather than one that drifts as sales change. Popularity has its
// own place in Top Revenue.
const byName = (a: CatalogItem, b: CatalogItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

// Quick Add Drinks only shows a handful, so sales pick which ones.
const bySales = (a: CatalogItem, b: CatalogItem) =>
  b.salesQty - a.salesQty || b.revenue - a.revenue || byName(a, b);

export function buildMenuCatalog(
  menu: AdminMenuItem[],
  popularity: { menuId: number; qty: number; revenue: number }[]
): MenuCatalog {
  const stats = new Map(popularity.map((p) => [p.menuId, p]));
  const groupOfCategory = new Map<string, string>();
  for (const g of MENU_GROUPS) for (const c of g.categories) groupOfCategory.set(c, g.id);

  const items: CatalogItem[] = menu
    .filter((m) => !HIDDEN_CATEGORIES.includes(normalize(m.categoryName)))
    .map((m) => ({
      ...m,
      groupId: groupOfCategory.get(normalize(m.categoryName)) ?? FALLBACK_GROUP_ID,
      salesQty: stats.get(m.id)?.qty ?? 0,
      revenue: stats.get(m.id)?.revenue ?? 0,
    }))
    .sort(byName);

  const groups: CatalogGroup[] = MENU_GROUPS.map((g) => {
    const groupItems = items.filter((it) => it.groupId === g.id);
    const present = new Set(groupItems.map((it) => it.categoryName));
    const configured = g.categories
      .map((c) => [...present].find((p) => normalize(p) === c))
      .filter((c): c is string => c != null);
    const unlisted = [...present].filter((p) => !configured.includes(p)).sort((a, b) => a.localeCompare(b));
    return { ...g, presentCategories: [...configured, ...unlisted], items: groupItems };
  }).filter((g) => g.items.length > 0);

  const topRevenue = items
    .filter((it) => it.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.salesQty - a.salesQty)
    .slice(0, TOP_REVENUE_COUNT);

  const quickDrinks = items
    .filter((it) => QUICK_DRINK_CATEGORIES.includes(normalize(it.categoryName)) || QUICK_DRINK_NAME.test(it.name))
    .sort(bySales)
    .slice(0, QUICK_DRINK_COUNT);

  return { items, groups, topRevenue, quickDrinks, byId: new Map(items.map((it) => [it.id, it])) };
}

// Shared by the order screens and the order detail's Quick Add Drinks, so
// opening one after another doesn't refetch. Short-lived so menu edits and
// availability changes in restoAdmin show up within a couple of minutes.
const CACHE_MS = 2 * 60 * 1000;
let cached: { at: number; promise: Promise<MenuCatalog> } | null = null;

export function loadMenuCatalog(): Promise<MenuCatalog> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = Promise.all([
    getMenu(),
    // Rankings are a nicety: without them the screens still work, unranked.
    getMenuPopularity().catch((err) => {
      console.warn('[menuCatalog] top revenue items unavailable', err);
      return [];
    }),
  ]).then(([menu, popularity]) => buildMenuCatalog(menu, popularity));
  cached = { at: Date.now(), promise };
  // Don't cache a failure — the next screen should retry.
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}
