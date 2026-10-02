# How restoDashboard connects to restoAdmin (Blue Moon)

This explains **how and why** restoDashboard's floor-plan zones are tied to restoAdmin's tables
and orders for the Blue Moon branch, and how to point it at a different restoAdmin server. For
install/run steps, see the [README](../README.md). For the ordering side specifically, see
[order-sync-integration.md](order-sync-integration.md).

## The two projects

- **restoAdmin** is the restaurant back office (tables, menu, orders, billing, inventory). It's its
  own repo, maintained upstream; locally it's cloned next to this one, at `../restoAdmin`.
- **restoDashboard** (this repo) is the front-of-house floor-plan board. It reads restoAdmin's
  tables and orders and sends orders to it.

**restoDashboard works against restoAdmin exactly as it ships — it needs no restoAdmin changes.**
All the adapting happens on this side. Keep it that way: if a feature seems to need a restoAdmin
change, raise it with whoever maintains restoAdmin rather than patching your local clone, since
that clone gets replaced by every upstream pull.

> History: before v2.0.0 both apps lived in one repo (`restoMerge`), and restoAdmin carried a few
> dashboard-specific patches (a `DASHBOARD_ZONE_ID` column and link endpoint, extra fields on order
> events, a two-state table status). Those were dropped when restoAdmin went back to its own repo;
> see CHANGELOG `[2.0.0]`. An existing local database may still have the
> `DASHBOARD_ZONE_ID`/`DASHBOARD_LINKED_AT` columns from back then — nothing uses them, and they're
> harmless.

## Architecture

The browser never holds restoAdmin credentials. restoDashboard has a small backend of its own that
holds them and relays everything the browser needs:

```
┌─────────────────┐        ┌──────────────────────┐        ┌───────────────────────┐
│  restoDashboard  │  same  │   restoDashboard      │  REST  │       restoAdmin       │
│   React (:3500)  │ origin │   server/ (:3510)     │  +     │   Node API (:2000)     │
│                  │◄──────►│                       │◄──────►│   + Socket.IO          │
│  (browser, no    │  /api  │  adminClient.ts:      │  JWT   │                        │
│   admin creds)   │        │   holds creds, calls   │        │  restaurant_tables,    │
│                  │        │   restoAdmin's REST    │        │  orders, billing,      │
│                  │  SSE   │  socketBridge.ts:      │ socket │  menu (MySQL)          │
│                  │◄──────►│   joins restoAdmin's   │◄──────►│                        │
└─────────────────┘        │   Socket.IO rooms as a │        │  socketService.js      │
                            │   plain client         │        │  emits table_updated,  │
                            └──────────────────────┘        │  order_created/updated │
                                                             └───────────────────────┘
```

- The browser only talks to restoDashboard's own backend (`server/`), same-origin, via the Vite dev
  proxy ([vite.config.ts](../vite.config.ts)).
- [`server/adminClient.ts`](../server/adminClient.ts) logs into restoAdmin with `POST /api/login`
  (JWT), refreshes the token, and wraps every restoAdmin REST call the dashboard makes.
- [`server/socketBridge.ts`](../server/socketBridge.ts) connects to restoAdmin's Socket.IO server as
  an ordinary client (like restoAdmin's own kitchen/cashier/waiter apps), joins the Blue Moon
  branch's rooms, and forwards `table_updated` / `order_created` / `order_updated` to the browser
  over Server-Sent Events (`GET /api/admin/stream`).
- The backend is stateless. Nothing about the dashboard is stored in restoAdmin.

### What restoDashboard uses from restoAdmin

All stock restoAdmin endpoints and events:

| Purpose | restoAdmin |
|---|---|
| Sign in / refresh | `POST /api/login`, `POST /api/refresh` |
| Tables (status, name, room charge) | `GET /restaurant_tables?branch_id=` |
| Menu | `GET /menus?branch_id=` |
| Orders | `GET /orders/data?branch_id=`, `GET /orders/:id`, `GET /orders/:id/items`, `POST /orders`, `PUT /orders/:id`, `PATCH /orders/:id/status`, `POST /orders/:id/items`, `PUT`/`DELETE /order_items/:id` |
| Billing / sales | `GET /billing/:orderId`, `PUT /billing/:orderId`, `GET /billing/data` |
| Live updates | Socket.IO: `join_kitchen` / `join_cashier` / `join_waiter` rooms; `table_updated`, `order_created`, `order_updated` events |

## How linking works

Each zone in [floorLayout.json](../src/data/floorLayout.json) has an `adminTableId` — restoAdmin's
`restaurant_tables.IDNo`. **That field is the link, and the only record of it.** restoAdmin doesn't
know which zone shows which of its tables.

Changing links is a developer task done in the dormant layout editor, which saves into
`floorLayout.json` — see [layout-editor.md](layout-editor.md). On every load the dashboard compares
`floorLayout.json` with restoAdmin's table list and logs a console warning if they've drifted
(renamed or deleted tables, tables with no zone, two zones on one table).

Because the link is a database id, `floorLayout.json` is tied to one restoAdmin database's ids. The
current ids match restoAdmin's `restaurants.sql` dump (Blue Moon, branch 3), which is a production
snapshot. If the dashboard is ever pointed at a database whose ids differ, the startup check will say
so.

### Status mapping

| restoAdmin `STATUS` | restoDashboard `TableStatus` | Set by |
|---|---|---|
| `1` | `available` | restoAdmin, automatically, when an order is settled/cancelled |
| `2` | `occupied` | restoAdmin, automatically, when an order is created |
| `3` | `reserved` | restoAdmin's Table Settings only |
| `0` | `unavailable` (shown as "Not Available") | restoAdmin's Table Settings only |

The dashboard never sets a table's status. Reserved and Not Available are display-only on the
dashboard. The mapping lives in [`src/services/adminSync.ts`](../src/services/adminSync.ts).

## How sync works

**restoAdmin → restoDashboard:** restoAdmin emits `table_updated` on every table change, including
the automatic flips from its order pipeline, and `order_created`/`order_updated` on order changes from
any path (its own UI, mobile apps, or this dashboard). `socketBridge.ts` relays them; `App.tsx`
applies them to the matching zone. Order events are enriched with room-timer fields first — see
[order-sync-integration.md](order-sync-integration.md#room-timer-fields).

There's also a full reconciliation (tables + active orders) on load, from the sidebar's refresh
button, and automatically when the live connection comes back after an outage, since events missed
during an outage are never replayed.

**restoDashboard → restoAdmin:** only order actions (create, edit items, confirm, cancel, settle),
as direct REST calls. See [order-sync-integration.md](order-sync-integration.md).

## Setting up the sync account

restoAdmin has no API keys, so the dashboard's backend signs in as an ordinary restoAdmin user:

1. In restoAdmin, go to **Employees / User Management** and create a new user.
2. Give it **non-admin** permissions, scoped to the **Blue Moon** branch.
3. Put its username/password in `.env` as `ADMIN_USERNAME`/`ADMIN_PASSWORD` (copy `.env.example`),
   along with `ADMIN_API_BASE_URL` and `ADMIN_BRANCH_ID=3`.

**Nobody else may sign in with this account.** restoAdmin allows one active session per account:
each sign-in ends the previous one. If a person signs in with it, the dashboard loses its session,
signs back in on its next request, and logs that person out, back and forth.

The account is only used server-to-server; it's never exposed to a browser. Orders and payments made
from the dashboard are recorded in restoAdmin under this account.

## Connecting to a hosted restoAdmin (production)

Pointing the dashboard at a hosted restoAdmin instead of a local one is a `.env` change on the
machine running the dashboard's backend:

| `.env` key | Set to |
|---|---|
| `ADMIN_API_BASE_URL` | The hosted restoAdmin **Node API**'s URL (not its web frontend's). For the live server it's `https://moonctgroup.com/data-api` (see below). REST calls go to this URL plus the endpoint path; Socket.IO uses only its origin (scheme + host). |
| `ADMIN_SOCKET_PATH` | Only if Socket.IO itself is served under a prefix (e.g. `/resto/socket.io`). Leave unset for the live server and for local. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | A sync account that exists **on that server's database** (see above). |
| `ADMIN_BRANCH_ID` | Blue Moon's branch id on that database (3 on the current one). |

Then restart the backend (`npm run dev:server`). No CORS change is needed on restoAdmin, because
only the dashboard's backend talks to it, never the browser.

### The live server: moonctgroup.com

restoAdmin's live instance runs at `https://moonctgroup.com` behind nginx, which forwards to
restoAdmin's Vite server. That server's proxy (restoAdmin's `vite.config.ts`) decides where requests go:

- `/data-api/*` → the Node API, with `/data-api` stripped. This is the only prefix that reaches
  every endpoint the dashboard uses (`/api/login`, `/restaurant_tables`, `/orders/...`,
  `/billing/...`, ...). Bare paths like `/orders` return restoAdmin's web app instead.
- `/socket.io` → the Node API's Socket.IO, at the default path.
- Plain `http://moonctgroup.com` serves nginx's default page, so use `https`.

So the live `.env` is `ADMIN_API_BASE_URL="https://moonctgroup.com/data-api"` with
`ADMIN_SOCKET_PATH` unset. The sync account must exist in the **live** database. An account
created on a local restoAdmin isn't there, and the login fails with "User not found or inactive".

Before switching:

- **Everything becomes real.** Orders created from the dashboard are real orders: they deduct
  inventory and count in sales. Don't test against production.
- **Check the startup link check** (browser console) on the first load: it confirms the
  `adminTableId`s in `floorLayout.json` exist on that server.
- **The dashboard itself isn't deployable yet.** It only runs as a Vite dev server plus the backend.
  Hosting it somewhere (building `dist/` and serving it with the backend) is separate work, to be
  done once a host is chosen.

## Optional restoAdmin improvements

None of these are needed. They'd make the dashboard lighter, and are for restoAdmin's maintainers to
decide on:

- **Include `service_charge`, `room_charge` and `encoded_dt` in `order_created`/`order_updated`
  events.** The dashboard currently looks up the first two for every order event. It already uses
  them from the event when present, so this needs no dashboard change.
- **Let `GET /orders/data` filter by status and table** (e.g. `status=2,3&table_id=`). The dashboard
  currently pulls the branch's latest orders (capped at 2000) just to find the few open ones, on every
  load and resync.

## Known limitations

- **Blue Moon only.** `ADMIN_BRANCH_ID` is a single value.
- **No retry queue.** A failed order action shows an error; nothing is retried automatically.
- **restoAdmin's Socket.IO room joins are unauthenticated** — a pre-existing restoAdmin trait, not
  something this integration adds or relies on beyond joining the branch's rooms.

## Where the code lives

| Concern | Files |
|---|---|
| Sync backend | [server/index.ts](../server/index.ts), [server/adminClient.ts](../server/adminClient.ts), [server/socketBridge.ts](../server/socketBridge.ts) |
| Frontend sync | [src/services/adminSync.ts](../src/services/adminSync.ts), [src/services/orderSync.ts](../src/services/orderSync.ts), [App.tsx](../src/App.tsx) |
| Zone ↔ table links | [floorLayout.json](../src/data/floorLayout.json), [EditTableModal.tsx](../src/layoutEditor/EditTableModal.tsx) (dormant editor) |
| Connection settings | [.env.example](../.env.example) |
