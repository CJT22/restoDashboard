# The restoAdmin ↔ restoDashboard order sync

This explains **how and why** restoDashboard can place and manage real orders against Blue Moon
tables, for anyone picking this up later. It builds directly on
[docs/blue-moon-integration.md](blue-moon-integration.md) (the table/room status sync) — read that
first if you haven't; this doc assumes the architecture it describes. For install/run steps, see the
[root README](../README.md).

## Why this exists

restoAdmin's Orders page has a "Create New Order" flow — pick a table, add menu items, submit — that
creates a real order against restoAdmin's `orders`/`order_items` tables, deducts inventory, and flips
the table to Occupied. ("Manual Order" is a separate, auto-settling flow and is intentionally **not**
part of this integration — it stays restoAdmin-only, see "Known limitations".)

Before this, restoDashboard had its own, unrelated concept of "orders": `TableRoom.orders`, a
per-zone list of free-text dish tickets staff could add/remove locally, entirely disconnected from
restoAdmin's actual menu, inventory, or order records. This was replaced by real restoAdmin order
data — restoDashboard can create an actual order, and orders created in either app show up live in
both.

**A first version of this feature also gave the dashboard a per-dish "served" toggle**, reusing a
numeric convention (`order_items.STATUS`: 3=Pending, 2=Preparing, 1=Ready) that a separate mobile
kitchen/waiter client (not in this repo) uses. On review this was the wrong model: it tracked kitchen
prep progress for an app that will never exist, while the thing that actually matters — the *order's*
real lifecycle (Pending → Confirmed → Settled, or Cancelled) — was left entirely to restoAdmin. That
per-dish layer has been **removed**. Table Occupied/Available is now understood purely as a reflection
of the order's lifecycle status, and the dashboard gained direct **Confirm**, **Cancel**, and
**Settle** actions so staff don't have to switch to restoAdmin for routine order handling.

Scope: **Blue Moon only** (inherits `ADMIN_BRANCH_ID` from the table sync setup), and only on zones
**already linked** to a restoAdmin table — a real order needs a real `TABLE_ID`.

## Architecture

No new backend, no new database, no new Socket.IO events — this reuses everything the table sync
already built, and everything restoAdmin's `OrderController`/`BillingController` already did:

```
restoDashboard React (:3500)         restoDashboard server/ (:3510)         restoAdmin (:2000)
        │  same-origin /api                    │  REST (JWT) + Socket.IO            │
        │◄─────────────────────────────────────►│◄───────────────────────────────────►│
        │                                        │  adminClient.ts: menu/order/       │  orders,
        │  SSE (shared connection with          │  billing REST methods              │  order_items,
        │  table sync — see below)              │  socketBridge.ts: listens for       │  billing,
        │◄─────────────────────────────────────►│  order_created / order_updated     │  menu (MySQL)
                                                  └─────────────────────────────────────┘
```

Endpoints reused, all pre-existing and unchanged:

- `POST /orders` — creates an order, validates inventory, rejects duplicate order numbers, and
  returns **409 `ACTIVE_ORDER_EXISTS`** if the table already has a Pending/Confirmed order, with the
  existing order's id/number in the response.
- `POST /orders/:id/items` / `PUT /order_items/:id` / `DELETE /order_items/:id` — add, edit the
  quantity of, or remove a line item on an open order.
- `PATCH /orders/:id/status` — Confirm (`status: 2`) or Cancel (`status: -1`) an order. restoAdmin
  itself already flips the table back to Available the instant an order is Settled or Cancelled — this
  is **not** something this integration added (see "Table status is derived, not pushed" below).
- `GET /billing/:orderId` / `PUT /billing/:orderId` — read the current amount due/paid, and record a
  payment (the same call restoAdmin's own Billing screen's "Process Payment" modal makes). Additive:
  the server adds the given `amount_paid` to whatever's already on file, so the dashboard always reads
  the current balance first rather than assuming the full grand total.
- All of the above already emit `order_created`/`order_updated` (and, via `TableModel.updateStatus`,
  `table_updated`) on the same Socket.IO server/rooms the table sync already uses.

**No restoAdmin schema changes were made for any order/billing endpoint.** The one restoAdmin change
in this whole feature is unrelated to orders: collapsing `restaurant_tables.STATUS` from 4 values to 2
(see below).

### The shared SSE connection

The table sync already opens one `EventSource` (`/api/admin/stream`) per browser tab. Rather than open
a second one for orders, `adminSync.ts` exposes `acquireAdminEventSource`/`releaseAdminEventSource` —
a reference-counted singleton — and `orderSync.ts`'s `subscribeToOrderUpdates` attaches its
`order_created`/`order_updated` listeners to that same connection.

## Table status is derived, not pushed

This is the core model correction. restoAdmin already flips a table's status automatically, in three
separate code paths that predate this integration:

| Trigger | restoAdmin code | New table status |
|---|---|---|
| Order created | `OrderController.create` → `TableModel.updateStatus(id, 2)` | Occupied |
| Order confirmed | `OrderController.updateStatus` (status 2) | unchanged (stays Occupied) |
| Order settled or cancelled | `OrderController.updateStatus`, `OrderController.update`, and `BillingController.updateBilling` (whichever path settles it) | Available |

The original table-status sync (`docs/blue-moon-integration.md`) already relays every one of these
via `table_updated`, regardless of what caused it. **restoDashboard never sets a linked zone's status
directly** — not from a button, not as a side effect of any order action here. `App.tsx`'s
`applyRemoteStatus` is the only thing that ever changes a linked zone's `status`, and it only reacts to
that same `table_updated` channel. The now-pointless "push status to admin" plumbing (`pushStatus`,
the "Resync Linked Tables to Admin" button) was removed along with the manual status picker in
`TableDetailModal` — a linked zone's status badge is read-only.

An unlinked zone (no `adminTableId` yet) still has a locally-editable status in `EditTableModal`, since
it has no real table to reflect. The moment a zone is linked, that picker disappears and the zone
immediately adopts whatever status restoAdmin currently shows for the table it was linked to.

### Table status enum: Available/Occupied only

`restaurant_tables.STATUS` (restoAdmin) and `TableRoom.status` (restoDashboard) both dropped
Reserved(3)/Not Available(0) — Table Settings' filter, badge, and edit-form dropdown now only offer
Available/Occupied (`restoAdmin/src/components/users/Tables.tsx`), and any table still at 0/3 from
before this change was migrated to Available via an idempotent boot-time step
(`ensureTwoStateTableStatus` in `restoAdmin/server/utils/ensureSchema.js`). This was confirmed narrow
before doing it: no reservations feature exists anywhere in restoAdmin, and the order-creation table
picker already only ever showed `STATUS === 1` tables.

## Data model

`TableRoom.activeOrder?: AdminOrderSummary` ([types.ts](../restoDashboard/src/types.ts)) is the real,
restoAdmin-sourced order for a linked zone:

| Field | Source |
|---|---|
| `AdminOrderSummary.id` / `.orderNo` | `orders.IDNo` / `orders.ORDER_NO` |
| `AdminOrderSummary.status` | `orders.STATUS` (3=Pending, 2=Confirmed, 1=Settled, -1=Cancelled) |
| `AdminOrderSummary.grandTotal` | `orders.GRAND_TOTAL` (computed server-side, including room charge) |
| `AdminOrderSummary.items[]` | `order_items` rows for that order — `id`, `menuId`, `name`, `quantity`, `unitPrice`, `lineTotal`; no per-item status field anymore |

A zone has at most one `activeOrder`, matching restoAdmin's one-order-per-table rule. An order is only
"active" (kept in `activeOrder`) while `status` is Pending(3) or Confirmed(2) — Settled/Cancelled
clears it. Manual Order and receipt-scan orders (both create the order already-Settled and set the
table Available directly, never Occupied — see "Known limitations") are naturally excluded by this
same rule; nothing had to be added to filter them out specifically.

Saved local state shape changed (status enum narrowed, item status field dropped), so the
`localStorage` key was bumped again (`restaurant_dashboard_tables_v2` → `_v3`) — same "old saves
simply ignored" precedent as the original `_v1` → `_v2` bump.

## How ordering works

1. "New Order" only appears on a zone already linked to a restoAdmin table with no active order yet.
   An unlinked zone's order section shows a prompt to link it first.
2. Opening it (`TableDetailModal` → `NewOrderModal`) fetches the branch's live menu
   (`GET /api/admin/menu`) — table and floor are pre-filled from the zone being viewed, unlike
   restoAdmin's own New Order modal which has its own Floor/Table pickers (restoDashboard doesn't need
   them: you're already looking at the table).
3. Submitting calls `POST /api/admin/orders`. Three outcomes: success (modal closes, `activeOrder`
   refreshes), **`ACTIVE_ORDER_EXISTS` (409)** — offers "Add Items to Order #X" instead of blocking
   outright, or **insufficient inventory** — restoAdmin's own validation response surfaced directly.
4. Once a table has an active order, `TableDetailModal` shows it the way restoAdmin's own order-detail
   modal does: a status badge, the item list with per-row quantity edit and delete plus an inline
   "add item" row, and — depending on status — **Confirm** (Pending only), **Cancel Order**
   (Pending/Confirmed), and **Settle** (Confirmed only, mirroring the fact that restoAdmin's own
   Billing screen only ever lists Confirmed/Settled orders — settling a still-Pending order works at
   the API level, but isn't offered here, to match restoAdmin's actual workflow).
5. **Settle** opens `SettlePaymentModal`: payment method, an amount pre-filled with the fetched
   remaining balance (partial payments supported, same as restoAdmin's own Billing modal), and an
   optional reference. Submitting calls `PUT /api/admin/orders/:id/settle`.

## Page changes

- **"Live Order Queue" → "Active Orders"**: now lists tables with a Pending/Confirmed order needing
  action, with Confirm/Cancel/Settle available right from each card — no per-dish list. This replaced
  the old kitchen-expediter framing entirely, since there's no more per-dish state to expedite.
- **"All Tables & Rooms"**: unchanged in role (directory/search over all zones), simplified to show
  the order's status badge instead of pending/served dish counts.
- No order-history view exists anywhere — the dashboard reflects current state only, by design.

## How sync works

**restoDashboard → restoAdmin:** order creation, item add/edit/delete, confirm/cancel, and settle are
all direct REST calls (not fire-and-forget) — the UI waits for and reacts to the actual result, since
these have real outcomes (inventory, conflicts, payment balances) the user needs to see.

**restoAdmin → restoDashboard:** restoAdmin emits `order_created`/`order_updated` on every one of
these actions, from *any* path (New Order, Manual Order, receipt-scan, or restoAdmin's own UI) —
`socketBridge.ts` listens for both and republishes them on the shared SSE stream. `App.tsx` applies
them to the matching linked zone (`applyRemoteOrder`) purely inbound, same as `applyRemoteStatus` —
and deliberately never touches `table.status` itself, since the table-status channel (see above)
already owns that.

**Attribution:** orders/payments recorded from restoDashboard are attributed to the same shared,
branch-scoped service account the table sync already authenticates as (see
[blue-moon-integration.md](blue-moon-integration.md#setting-up-the-sync-account)) — no new auth
system, and no admin-role elevation was needed: `PUT /billing/:id` (like every other endpoint used
here) only requires being authenticated, not an admin permission level.

## Known limitations / explicitly out of scope

- **Blue Moon only**, same as the table sync — inherits `ADMIN_BRANCH_ID`.
- **Requires linking first.** A zone with no `adminTableId` can't place orders; there's no
  auto-create-a-table-on-the-fly path.
- **Manual Order and receipt-scan orders are invisible to the dashboard by construction, not by
  filtering them out.** Both create the order already-Settled and set the table Available directly
  (never Occupied) — so they never satisfy the "active order" (Pending/Confirmed) condition in the
  first place. There's no origin flag or special-casing; this is a natural consequence of how those
  two flows already behaved before this integration existed.
- **No retry queue** — a failed order-related call surfaces an error in the UI but there's no
  automatic retry or offline queueing, same tradeoff as the table sync.
- **Settling from a still-Pending order isn't exposed in the UI** even though the underlying
  `PUT /billing/:id` call would technically accept it — the Settle button only appears once an order
  is Confirmed, to match restoAdmin's own workflow (its Billing screen only lists Confirmed/Settled
  orders).

## Where the code lives

| Concern | Files |
|---|---|
| Order/billing endpoints (restoAdmin, unchanged — reference only) | [orderController.js](../restoAdmin/server/controllers/orderController.js), [billingController.js](../restoAdmin/server/controllers/billingController.js) |
| Table status enum trim (restoAdmin) | [Tables.tsx](../restoAdmin/src/components/users/Tables.tsx), [ensureSchema.js](../restoAdmin/server/utils/ensureSchema.js) |
| Sync backend (restoDashboard) | [server/adminClient.ts](../restoDashboard/server/adminClient.ts), [server/socketBridge.ts](../restoDashboard/server/socketBridge.ts), [server/index.ts](../restoDashboard/server/index.ts) |
| Frontend order sync (restoDashboard) | [src/services/orderSync.ts](../restoDashboard/src/services/orderSync.ts), [src/services/adminSync.ts](../restoDashboard/src/services/adminSync.ts) |
| Order UI (restoDashboard) | [NewOrderModal.tsx](../restoDashboard/src/components/NewOrderModal.tsx), [SettlePaymentModal.tsx](../restoDashboard/src/components/SettlePaymentModal.tsx), [TableDetailModal.tsx](../restoDashboard/src/components/TableDetailModal.tsx), [OrderQueueView.tsx](../restoDashboard/src/components/OrderQueueView.tsx) |
| Types | [types.ts](../restoDashboard/src/types.ts) |

See [CHANGELOG.md](../CHANGELOG.md) `[1.6.0]` for the full list of changes that built this, with the
reasoning behind each.
