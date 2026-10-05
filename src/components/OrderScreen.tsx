import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Search,
  LayoutGrid,
  Flame,
  Soup,
  Drumstick,
  Pizza,
  Beer,
  Martini,
  CupSoda,
  IceCreamCone,
  Package,
  Minus,
  Plus,
  ClipboardList,
  AlertTriangle,
} from 'lucide-react';
import { AdminMenuItem } from '../services/orderSync';
import { CatalogItem, MenuCatalog, TOP_REVENUE_PREVIEW_COUNT, loadMenuCatalog } from '../services/menuCatalog';
import { ConfirmModal } from './ConfirmModal';
import { QtyStepper } from './QtyStepper';

// The grouped, ranked menu (see services/menuCatalog.ts), or the reason it
// couldn't load.
export function useMenuCatalog() {
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMenuCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Could not load the menu from restoAdmin');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { catalog, error };
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export type CartLine = { menuId: number; name: string; unitPrice: number; qty: number };

// Items staged on an order screen before they're sent to restoAdmin. One line
// per menu item; tapping an item again bumps its quantity.
export function useOrderCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  const add = (item: AdminMenuItem) =>
    setLines((prev) =>
      prev.some((l) => l.menuId === item.id)
        ? prev.map((l) => (l.menuId === item.id ? { ...l, qty: l.qty + 1 } : l))
        : [...prev, { menuId: item.id, name: item.name, unitPrice: item.price, qty: 1 }]
    );

  // Down to zero removes the line (the tile/drink steppers); the cart list's
  // own stepper stops at 1 and leaves removing to its trash button.
  const decrement = (menuId: number) =>
    setLines((prev) =>
      prev.flatMap((l) => (l.menuId !== menuId ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []))
    );

  const setQty = (menuId: number, qty: number) => {
    if (qty < 1) return;
    setLines((prev) => prev.map((l) => (l.menuId === menuId ? { ...l, qty } : l)));
  };

  const remove = (menuId: number) => setLines((prev) => prev.filter((l) => l.menuId !== menuId));

  const qtyOf = (menuId: number) => lines.find((l) => l.menuId === menuId)?.qty ?? 0;
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const unitCount = lines.reduce((sum, l) => sum + l.qty, 0);

  return { lines, add, decrement, setQty, remove, qtyOf, subtotal, unitCount };
}

export type OrderCart = ReturnType<typeof useOrderCart>;

export const CartLineList: React.FC<{ cart: OrderCart; emptyText: string }> = ({ cart, emptyText }) =>
  cart.lines.length === 0 ? (
    <div className="p-5 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center text-slate-500 text-xs">
      {emptyText}
    </div>
  ) : (
    <div className="space-y-2">
      {cart.lines.map((l) => (
        <div key={l.menuId} className="p-2.5 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2">
          <div className="text-sm text-white min-w-0 truncate" title={l.name}>
            {l.qty}x {l.name}
          </div>
          <QtyStepper
            amount={`₱${(l.unitPrice * l.qty).toFixed(2)}`}
            onDecrement={() => cart.setQty(l.menuId, l.qty - 1)}
            onIncrement={() => cart.setQty(l.menuId, l.qty + 1)}
            decrementDisabled={l.qty <= 1}
            onRemove={() => cart.remove(l.menuId)}
          />
        </div>
      ))}
    </div>
  );

// restoAdmin's "not enough stock" answer to a create/add.
export const InsufficientAlert: React.FC<{ items: any[] }> = ({ items }) => (
  <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex gap-2">
    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
    <div>
      <div className="font-semibold mb-1">Insufficient inventory</div>
      {items.map((i, idx) => (
        <div key={idx}>
          {i.ingredientName ?? i.name}: need {i.required}, have {i.available} {i.unit}
        </div>
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sizzling: Soup,
  chicken: Drumstick,
  mains: Pizza,
  beers: Beer,
  liquor: Martini,
  nonAlcoholic: CupSoda,
  desserts: IceCreamCone,
  extras: Package,
};

type Selection = 'all' | 'top' | string; // string = a MenuGroup id

interface OrderScreenProps {
  title: string;
  subtitle: string;
  catalog: MenuCatalog | null;
  catalogError: string | null;
  qtyOf: (menuId: number) => number;
  onAdd: (item: CatalogItem) => void;
  onDecrement: (item: CatalogItem) => void;
  // True while there are staged items, so closing asks before throwing them away.
  dirty: boolean;
  onClose: () => void;
  // The right-hand panel: cart, totals and the screen's action button.
  aside: React.ReactNode;
}

// Full-screen item picker shared by New Order and Add Items: categories on
// the left, the menu in the middle (Top Revenue first, then every group as
// compact name + price tiles), and the caller's cart on the right.
export const OrderScreen: React.FC<OrderScreenProps> = ({
  title,
  subtitle,
  catalog,
  catalogError,
  qtyOf,
  onAdd,
  onDecrement,
  dirty,
  onClose,
  aside,
}) => {
  const [selection, setSelection] = useState<Selection>('all');
  const [subCategory, setSubCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [confirmingClose, setConfirmingClose] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const requestClose = () => (dirty ? setConfirmingClose(true) : onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || confirmingClose) return;
      if (search) setSearch('');
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const select = (next: Selection) => {
    setSelection(next);
    setSubCategory(null);
    setSearch('');
    mainRef.current?.scrollTo({ top: 0 });
  };

  const query = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!catalog || !query) return [];
    return catalog.items.filter(
      (it) => it.name.toLowerCase().includes(query) || it.categoryName.toLowerCase().includes(query)
    );
  }, [catalog, query]);

  const selectedGroup = catalog?.groups.find((g) => g.id === selection) ?? null;
  const hasTop = (catalog?.topRevenue.length ?? 0) > 0;

  const tileProps = { qtyOf, onAdd, onDecrement };

  const renderMain = () => {
    if (catalogError) return <p className="text-sm text-rose-400 p-2">{catalogError}</p>;
    if (!catalog) return <p className="text-sm text-slate-500 p-2">Loading menu…</p>;

    if (query) {
      return (
        <Section title={`${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for “${search.trim()}”`}>
          {searchResults.length === 0 ? (
            <p className="text-xs text-slate-500">No menu items match. Try part of the name, e.g. “sisig”.</p>
          ) : (
            <TileGrid items={searchResults} {...tileProps} />
          )}
        </Section>
      );
    }

    if (selection === 'top') {
      return (
        <Section title="Top Revenue Items" icon={<Flame className="w-4 h-4 text-amber-400" />}>
          <TileGrid items={catalog.topRevenue} ranked {...tileProps} />
        </Section>
      );
    }

    if (selectedGroup) {
      const items = subCategory
        ? selectedGroup.items.filter((it) => it.categoryName === subCategory)
        : selectedGroup.items;
      return (
        <Section title={selectedGroup.label} count={selectedGroup.items.length}>
          {selectedGroup.presentCategories.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {[null, ...selectedGroup.presentCategories].map((c) => (
                <button
                  key={c ?? '__all'}
                  type="button"
                  onClick={() => setSubCategory(c)}
                  className={`px-3 h-8 rounded-full text-xs font-semibold border transition-colors ${
                    subCategory === c
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {c ?? 'All'}
                </button>
              ))}
            </div>
          )}
          <TileGrid items={items} {...tileProps} />
        </Section>
      );
    }

    // "All": Top Revenue preview, then every group in rail order.
    return (
      <div className="space-y-6">
        {hasTop && (
          <Section
            title="Top Revenue Items"
            icon={<Flame className="w-4 h-4 text-amber-400" />}
            action={
              catalog.topRevenue.length > TOP_REVENUE_PREVIEW_COUNT && (
                <button type="button" onClick={() => select('top')} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">
                  View all ({catalog.topRevenue.length})
                </button>
              )
            }
          >
            <TileGrid items={catalog.topRevenue.slice(0, TOP_REVENUE_PREVIEW_COUNT)} ranked {...tileProps} />
          </Section>
        )}
        {catalog.groups.map((g) => (
          <Section key={g.id} title={g.label} count={g.items.length}>
            <TileGrid items={g.items} {...tileProps} />
          </Section>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#0b0d1c] text-slate-100 flex flex-col animate-in fade-in duration-150">
      {/* Header */}
      <div className="h-16 shrink-0 px-4 border-b border-white/10 bg-[#141628] flex items-center gap-4">
        <button
          type="button"
          onClick={requestClose}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-white text-base leading-tight">{title}</h3>
            <p className="text-xs text-slate-400 truncate">{subtitle}</p>
          </div>
        </div>
        <div className="relative flex-1 max-w-xl ml-auto">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Category rail */}
        <nav className="w-44 lg:w-52 shrink-0 border-r border-white/10 bg-[#10122a] overflow-y-auto custom-scrollbar p-2 space-y-1">
          <RailButton
            label="All"
            icon={LayoutGrid}
            count={catalog?.items.length}
            active={selection === 'all' && !query}
            onClick={() => select('all')}
          />
          {hasTop && (
            <RailButton
              label="Top Revenue"
              icon={Flame}
              active={selection === 'top' && !query}
              onClick={() => select('top')}
              accent
            />
          )}
          {catalog?.groups.map((g) => (
            <RailButton
              key={g.id}
              label={g.label}
              icon={GROUP_ICONS[g.id] ?? Package}
              count={g.items.length}
              active={selection === g.id && !query}
              onClick={() => select(g.id)}
            />
          ))}
        </nav>

        {/* Menu */}
        <div ref={mainRef} className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4">
          {renderMain()}
        </div>

        {/* Cart */}
        <aside className="w-[340px] xl:w-[380px] shrink-0 border-l border-white/10 bg-[#141628] flex flex-col min-h-0">
          {aside}
        </aside>
      </div>

      <ConfirmModal
        isOpen={confirmingClose}
        onClose={() => setConfirmingClose(false)}
        onConfirm={() => {
          setConfirmingClose(false);
          onClose();
        }}
        title="Discard these items?"
        description="The items you've picked haven't been sent to restoAdmin yet. Closing now throws them away."
        confirmText="Discard"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const RailButton: React.FC<{
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  active: boolean;
  accent?: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, count, active, accent, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full min-h-11 px-3 py-2 rounded-xl flex items-center gap-2.5 text-left text-sm transition-colors ${
      active
        ? accent
          ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
          : 'bg-indigo-600 text-white'
        : 'text-slate-300 hover:bg-white/5 border border-transparent'
    }`}
  >
    <Icon className={`w-4 h-4 shrink-0 ${accent && !active ? 'text-amber-400' : ''}`} />
    <span className="flex-1 min-w-0 leading-tight font-semibold">{label}</span>
    {count != null && <span className={`text-[11px] tabular-nums ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{count}</span>}
  </button>
);

const Section: React.FC<{
  title: string;
  count?: number;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, count, icon, action, children }) => (
  <section>
    <div className="flex items-center gap-2 mb-2.5">
      {icon}
      <h4 className="text-sm font-bold text-white">{title}</h4>
      {count != null && <span className="text-xs text-slate-500 tabular-nums">{count}</span>}
      <div className="ml-auto">{action}</div>
    </div>
    {children}
  </section>
);

const TileGrid: React.FC<{
  items: CatalogItem[];
  ranked?: boolean;
  qtyOf: (menuId: number) => number;
  onAdd: (item: CatalogItem) => void;
  onDecrement: (item: CatalogItem) => void;
}> = ({ items, ranked, qtyOf, onAdd, onDecrement }) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
    {items.map((it, i) => (
      <MenuTile key={it.id} item={it} rank={ranked ? i + 1 : undefined} qty={qtyOf(it.id)} onAdd={onAdd} onDecrement={onDecrement} />
    ))}
  </div>
);

// Name + price, no image, so many more items fit on screen than the staff
// app's photo cards. Tapping anywhere on the name adds one; once it's in the
// cart a −/qty/+ stepper appears.
const MenuTile: React.FC<{
  item: CatalogItem;
  rank?: number;
  qty: number;
  onAdd: (item: CatalogItem) => void;
  onDecrement: (item: CatalogItem) => void;
}> = ({ item, rank, qty, onAdd, onDecrement }) => (
  <div
    className={`min-h-[60px] rounded-xl border flex items-stretch transition-colors ${
      qty > 0 ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
    }`}
  >
    <button
      type="button"
      onClick={() => onAdd(item)}
      className="flex-1 min-w-0 text-left pl-3 pr-1 py-2 flex flex-col justify-center gap-0.5"
      title={item.name}
    >
      <span className="text-[13px] font-semibold text-white leading-snug line-clamp-2">
        {rank != null && <span className="text-amber-400 mr-1 tabular-nums">#{rank}</span>}
        {item.name}
      </span>
      <span className="text-xs font-mono text-amber-300 tabular-nums">₱{item.price.toLocaleString()}</span>
    </button>
    <div className="flex items-center pr-2 shrink-0">
      {qty > 0 ? (
        <div className="flex items-center gap-0.5 rounded-lg bg-indigo-600 text-white">
          <button
            type="button"
            onClick={() => onDecrement(item)}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center"
            aria-label={`Remove one ${item.name}`}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-5 text-center text-xs font-bold tabular-nums">{qty}</span>
          <button
            type="button"
            onClick={() => onAdd(item)}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center"
            aria-label={`Add one ${item.name}`}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAdd(item)}
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-indigo-600 flex items-center justify-center text-white"
          aria-label={`Add ${item.name}`}
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>
);
