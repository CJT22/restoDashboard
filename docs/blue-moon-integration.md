# The restoAdmin ↔ restoDashboard integration (Blue Moon)

This explains **how and why** restoDashboard's floor-plan zones can be linked to restoAdmin's Table
Settings for the Blue Moon branch, for anyone picking this up later. For install/run steps, see the
[root README](../README.md).

## Why this exists

restoDashboard is a floor-plan status board for front-of-house staff — a visual map of
tables/rooms with Available/Occupied/etc. status, guest info, and live order tracking. restoAdmin's
Table Settings is the system of record for actual restaurant tables (per branch, with capacity, room
charge, and status), and its order pipeline automatically flips a table's status as orders are
created/settled.

Before this integration, the two had no relationship: restoDashboard's data lived only in the
browser's `localStorage`, and a status change in one app had no effect on the other. This links them
**per zone, opt-in**, so a host/waiter working from either app sees the same status for a given
table, without restoDashboard staff needing to touch restoAdmin (or vice versa).

Scope: **Blue Moon only** (`BRANCH_ID = 3`), and **only status syncs** — guest name, party size,
notes, and dish orders stay restoDashboard-local, since restoAdmin's `restaurant_tables` has no
equivalent fields for those.

## Architecture

restoDashboard was (and still is, for everything except this feature) a purely client-side app with
no backend of its own. Rather than have the browser hold restoAdmin credentials directly — which
would expose them to anyone with devtools open on whatever device runs the dashboard — restoDashboard
gained a small backend of its own that holds those credentials and proxies/bridges everything the
browser needs.

```
┌─────────────────┐        ┌──────────────────────┐        ┌───────────────────────┐
│  restoDashboard  │  same  │   restoDashboard      │  REST  │       restoAdmin       │
│   React (:3500)  │ origin │   server/ (:3510)     │  +     │   Node API (:2000)     │
│                  │◄──────►│                       │◄──────►│   + Socket.IO          │
│  (browser, no    │  /api  │  adminClient.ts:      │  JWT   │                        │
│   admin creds)   │        │   holds creds, calls   │        │  restaurant_tables     │
│                  │        │   restoAdmin's REST    │        │  (MySQL)               │
│                  │  SSE   │  socketBridge.ts:      │ socket │                        │
│                  │◄──────►│   joins restoAdmin's   │◄──────►│  socketService.js      │
└─────────────────┘        │   Socket.IO rooms as a │        │  emits table_updated    │
                            │   plain client         │        │  on every mutation      │
                            └──────────────────────┘        └───────────────────────┘
```

- The browser only ever talks to restoDashboard's own backend (`server/`), same-origin, via a Vite
  dev proxy in development ([vite.config.ts](../restoDashboard/vite.config.ts)).
- `server/adminClient.ts` logs into restoAdmin via `POST /api/login` (JWT), caches/refreshes the
  token, and exposes `getBlueMoonTables`, `setTableStatus`, `setDashboardLink`.
- `server/socketBridge.ts` connects to restoAdmin's existing Socket.IO server as an ordinary client
  (the same way restoAdmin's kitchen/cashier/waiter apps do), joins the Blue Moon branch's rooms, and
  forwards `table_updated` events into this backend's own Server-Sent Events stream
  (`GET /api/admin/stream`) for the browser.
- restoAdmin's own Table Settings page (`Tables.tsx`) *also* opened its own Socket.IO client
  connection so it updates live too — this was a separate, smaller follow-up fix, not part of the
  original credential-proxying design above, but it uses the same `table_updated` event.
- There is **no separate database** for the link itself — restoAdmin's `restaurant_tables` table is
  the single source of truth (see below), so restoDashboard's backend stays stateless.

## Data model

restoAdmin's `restaurant_tables` gained two nullable columns (self-migrating, see
[ensureSchema.js](../restoAdmin/server/utils/ensureSchema.js)):

| Column | Purpose |
|---|---|
| `DASHBOARD_ZONE_ID` | The restoDashboard `TableRoom.id` this row is linked to, or `NULL` |
| `DASHBOARD_LINKED_AT` | When the link was set, or `NULL` |

restoDashboard's `TableRoom` ([types.ts](../restoDashboard/src/types.ts)) gained matching fields:

| Field | Purpose |
|---|---|
| `adminTableId` | The restoAdmin `restaurant_tables.IDNo` this zone is linked to |
| `adminTableName` | Cached display name (`TABLE_NUMBER`) of that admin table, for UI display without an extra lookup |

### Status mapping

restoAdmin's `STATUS` is a 0–3 int enum; restoDashboard's `TableStatus` was extended from 2 states to
the same 4, so a linked zone never loses information:

| restoAdmin `STATUS` | restoDashboard `TableStatus` |
|---|---|
| `0` | `not_available` |
| `1` | `available` |
| `2` | `occupied` |
| `3` | `reserved` |

The mapping lives in one place: [`src/services/adminSync.ts`](../restoDashboard/src/services/adminSync.ts).

## How linking works

1. In restoDashboard, editing an existing zone (`EditTableModal`) shows a "Link to Blue Moon Table"
   picker, populated from `GET /api/admin/tables` (only currently-unlinked admin tables, plus the
   zone's own current link).
2. Saving calls `POST /api/admin/link { zoneId, adminTableId }` on restoDashboard's backend, which:
   - Looks up all Blue Moon tables, clears `DASHBOARD_ZONE_ID` on any *other* table already linked to
     that `zoneId` (keeps the mapping 1:1), then
   - Sets `DASHBOARD_ZONE_ID`/`DASHBOARD_LINKED_AT` on the newly chosen table via
     `PATCH /restaurant_table/:id/dashboard-link` on restoAdmin.
3. restoAdmin's Table Settings shows a read-only "Linked" badge for any table with a
   `DASHBOARD_ZONE_ID` set — no new interactive functionality there by design, just visibility.
4. Deleting a linked zone (or bulk-deleting all zones on a floor) in restoDashboard best-effort clears
   the link on restoAdmin's side too, so it doesn't keep pointing at a zone that no longer exists.

## How sync works

**restoDashboard → restoAdmin:** when a linked zone's status changes (`TableDetailModal`'s status
buttons, or "Clear Table"), `App.tsx`'s `handleUpdateTable` fires `PATCH /api/admin/tables/:id/status`
on restoDashboard's backend, which proxies to restoAdmin's `PATCH /restaurant_table/:id/status`. This
is fire-and-forget — restoDashboard's local state already reflects the change either way, so a failed
push doesn't block the UI, just logs a warning.

**restoAdmin → restoDashboard:** restoAdmin already emits a `table_updated` Socket.IO event on every
table mutation, including ones the order pipeline makes automatically (order created → Occupied,
settled → Available). restoDashboard's `socketBridge.ts` is always listening for these (joined as a
client, see Architecture above) and forwards them over SSE; `App.tsx` applies the new status directly
to the matching linked zone (`applyRemoteStatus`) without pushing it back — that guard is what stops
the two apps from ping-ponging the same change back and forth. There's also a one-time reconciliation
fetch on restoDashboard's load, to catch drift from while it was closed.

**Within restoAdmin itself:** `Tables.tsx` also listens for the same `table_updated` event directly
(its own Socket.IO client, joined to whichever branch(es) are currently visible in the table) and
patches the affected row in place. This makes Table Settings live for *any* status change, not just
ones coming from restoDashboard — it was a natural follow-on once the event was already being emitted
for everything.

## Setting up the sync account

restoAdmin has no API-key/service-account system — just user-credential JWT login — so
restoDashboard's backend authenticates as an ordinary restoAdmin user. Existing branch-scoping already
handles this correctly (a non-admin user's `/restaurant_tables` calls are automatically scoped to
their own branch), so no new backend auth code was needed:

1. In restoAdmin, go to **Employees / User Management** and create a new user.
2. Give it **non-admin** permissions, scoped to the **Blue Moon** branch.
3. Put its username/password into `restoDashboard/.env` as `ADMIN_USERNAME`/`ADMIN_PASSWORD` (copy
   from `restoDashboard/.env.example`), along with `ADMIN_API_BASE_URL` and `ADMIN_BRANCH_ID=3`.

This account is only ever used server-to-server, by restoDashboard's backend — it's never exposed to
any browser.

## Known limitations / explicitly out of scope

- **Blue Moon only.** `ADMIN_BRANCH_ID` is a single value; restoDashboard has no concept of multiple
  branches yet.
- **Status only.** Guest name/party size/notes/dish orders don't sync — restoAdmin has no equivalent
  fields on `restaurant_tables` for them.
- **No retry queue.** A failed push (either direction) just logs a warning; the next successful
  write or the load-time reconciliation is what re-syncs things, not an automatic retry.
- **restoAdmin's dev-mode CORS and Socket.IO room joins are unauthenticated** — pre-existing gaps in
  restoAdmin, not introduced or worsened by this integration (restoDashboard's backend talks to
  restoAdmin server-to-server, so browser CORS doesn't apply to it either way).

## Where the code lives

| Concern | Files |
|---|---|
| Schema + link endpoint (restoAdmin) | [ensureSchema.js](../restoAdmin/server/utils/ensureSchema.js), [tableModel.js](../restoAdmin/server/models/tableModel.js), [tableController.js](../restoAdmin/server/controllers/tableController.js), [tableRoutes.js](../restoAdmin/server/routes/tableRoutes.js) |
| "Linked" badge + live updates (restoAdmin) | [Tables.tsx](../restoAdmin/src/components/users/Tables.tsx) |
| Sync backend (restoDashboard) | [server/index.ts](../restoDashboard/server/index.ts), [server/adminClient.ts](../restoDashboard/server/adminClient.ts), [server/socketBridge.ts](../restoDashboard/server/socketBridge.ts) |
| Frontend sync + linking UI (restoDashboard) | [src/services/adminSync.ts](../restoDashboard/src/services/adminSync.ts), [EditTableModal.tsx](../restoDashboard/src/components/EditTableModal.tsx), [TableDetailModal.tsx](../restoDashboard/src/components/TableDetailModal.tsx), [App.tsx](../restoDashboard/src/App.tsx) |

See [CHANGELOG.md](../CHANGELOG.md) `[1.5.0]` for the full list of changes that built this, with the
reasoning behind each.
