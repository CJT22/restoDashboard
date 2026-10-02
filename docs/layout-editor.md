# The restoDashboard layout editor (Edit Zones), and how to bring it back

restoDashboard's floor plan used to have an **Edit Zones** mode. Staff could move, resize, draw and
delete table/room zones and info panels, and link zones to restoAdmin tables. It is now **turned
off**. The layout is fixed in code, and the editor stays in the repo, dormant, for the next time the
restaurant is rearranged.

This doc covers why it's off, where the fixed layout lives, and how to turn the editor back on, make
changes and lock them in again.

**Short version, for asking Claude Code or another developer:**

> Re-enable the restoDashboard layout editor per docs/layout-editor.md. I need to _(e.g. add a
> ROOM 14 on the 2nd floor linked to restoAdmin's "ROOM 14", and move the Total Sales panel)_.

## Why it's off

The restaurant (Blue Moon) has a fixed setup. With Edit Zones one click away, staff could drag a
zone or delete a panel by accident. Each device also kept its own copy of the layout in
`localStorage`, so two screens could show different layouts. A senior developer advised removing the
feature for staff. The layout was locked in on 2026-09-29 (CHANGELOG `[1.15.0]`), with all 36 zones
linked 1:1 to restoAdmin's 36 Blue Moon tables.

## Where the fixed layout lives

[`src/data/floorLayout.json`](../src/data/floorLayout.json) is the
**single source of truth**, and every device loads it as-is. It has two lists:

- **`zones`** — one entry per table or room:
  - `id`: the zone id. Only the dashboard uses it (restoAdmin doesn't know about zones), but keep it
    stable for an existing zone anyway.
  - `name`, `code`, `type`, `floor`, `capacity`.
  - `adminTableId`: restoAdmin's `restaurant_tables.IDNo`. This is what makes orders and status
    sync, and it's the **only** record of the link: restoAdmin itself stores nothing about zones.
  - `adminTableName`: restoAdmin's `TABLE_NUMBER` at the time of linking. The startup check uses it
    to notice renames.
  - `x`, `y`, `width`, `height`: percentages of the 16:9 floor plan image.
- **`panels`** — one entry per info panel:
  - `id`, `floor`.
  - `widgets`: which widgets to show, in order: `roomTimers`, `activeOrders`, `totalSales`,
    `occupancy`.
  - `layout`: `auto`, `stack` or `row`.
  - Geometry: the same `x`, `y`, `width`, `height` as zones.
  - `widgetFloors` (optional): the floor each widget **starts** on, when it isn't the panel's own
    floor. Example: `{ "roomTimers": "all" }`.

Live data (status, the active order, room charges) is never stored in the layout. It comes from
restoAdmin at runtime.

Staff can still flip a widget's 1F / 2F / All toggle and the Total Sales period. Those choices last
until the page reloads, then go back to what `floorLayout.json` says. That keeps every device showing
the same view.

Small tweaks can be made by hand-editing `floorLayout.json`, without the editor. Examples: a widget's
starting floor, a widget's order, a zone's capacity or display name.

## How the on/off switch works

[`src/config/layoutEditor.ts`](../src/config/layoutEditor.ts) reads
one build-time setting:

```ts
export const LAYOUT_EDITOR_ENABLED = import.meta.env.VITE_ENABLE_LAYOUT_EDITOR === 'true';
```

- **Off (the default):** `npm run dev`, `npm run dev:all` and `npm run build` all leave the editor
  off. Vite inlines the value at build time, so the editor code
  ([`src/layoutEditor/`](../src/layoutEditor/)) is **left out of the production
  bundle entirely**. It isn't hidden, it's absent, so the dormant code costs nothing in size or speed.
  With the editor off, `npm run build` produces no `LayoutEditor-*.js` file.
- **On:** the only change is an **Edit Zones** button in the floor plan's top bar, next to the Info
  Panels and Fullscreen buttons. The editor is its own chunk (~27 kB), downloaded only when someone clicks that button.

Nothing else in the code needs to change to turn it on or off.

## Re-laying out the floor, step by step

### 1. Turn the editor on (on your machine only)

Pick one:

- **For one run:** start the dev server with the setting on (Git Bash / macOS / Linux):
  ```bash
  VITE_ENABLE_LAYOUT_EDITOR=true npm run dev:all
  ```
  In PowerShell: `$env:VITE_ENABLE_LAYOUT_EDITOR='true'; npm run dev:all`
- **Until you remove it:** create `.env.local` containing:
  ```
  VITE_ENABLE_LAYOUT_EDITOR=true
  ```
  `.env*` files are git-ignored, so this never reaches other machines or the repo.

Vite only reads this at startup, so **restart the dev server** after changing it.

### 2. Edit

Open the floor plan and click **Edit Zones**. The editor can:

- **Move** a zone or panel: drag it.
- **Resize** one: drag a corner or edge handle (they show on hover).
- **Edit a zone:** click it (or its ✎ button). You can change its name, code and capacity, and
  **link it to a Blue Moon table**.
- **Edit a panel:** click it to pick its widgets, their order, and the layout.
- **Draw** something new: choose **Draw: Zone** or **Draw: Info panel** in the editor bar, then
  press on empty floor plan and drag.
- **Delete** one zone (🗑 on hover), or every zone on the current floor (**Delete All Zones**).
- **Discard Changes:** puts everything back to `floorLayout.json`.

Linking only changes the draft. Nothing is written to restoAdmin, so **Discard Changes** undoes
links too. (The editor still *reads* restoAdmin's table list for the link picker, from whichever
restoAdmin `.env` points at — the table ids must come from the same database the dashboard will run
against.)

### 3. Your work is saved as a draft in this browser

Every change is saved automatically to this browser's `localStorage` under
`restaurant_dashboard_layout_draft`. The draft is already in `floorLayout.json`'s exact format.
Reloading keeps your work. Once the layout matches `floorLayout.json` again, the draft is removed
automatically. The draft is only used while the editor is on.

### 4. Copy the draft into the code

In the same browser, open DevTools → Console and run:

```js
copy(localStorage.getItem('restaurant_dashboard_layout_draft'))
```

This copies the draft to your clipboard. Replace the **entire** contents of
`src/data/floorLayout.json` with it. If the clipboard ends up holding `null`, there's no draft, meaning the layout has no changes.

Then hand-edit anything the editor can't set. At the moment that is only `widgetFloors`. Panels keep
their existing `widgetFloors`; a new panel's widgets start on the panel's own floor.

### 5. Turn the editor off and check

1. Remove `VITE_ENABLE_LAYOUT_EDITOR` (delete `.env.local` or the line in it), then restart the dev
   server.
2. Reload the dashboard and check both floors.
3. Open DevTools → Console and look for a `[layout]` warning (see the next section). No warning means
   every zone and restoAdmin table lines up.
4. Add a CHANGELOG entry and commit `floorLayout.json`.

## The startup link check

On every load, restoDashboard compares `floorLayout.json` against restoAdmin's Blue Moon tables
(`warnOnLayoutLinkDrift` in
[`adminSync.ts`](../src/services/adminSync.ts)). If anything is out of step, it logs a
single `[layout] Floor plan and restoAdmin tables are out of step` warning to the **browser console**.
Staff never see it. It flags:

| Warning | Usual cause | Fix |
| --- | --- | --- |
| zone isn't linked to any restoAdmin table | a new zone was saved without a link | link it in the editor |
| linked to table #N, which no longer exists | table deleted in restoAdmin | re-link the zone, or delete it |
| table #N was renamed from "A" to "B" | renamed in restoAdmin's Table Settings | update that zone's `adminTableName` (and `name` if wanted) in `floorLayout.json` |
| table #N is linked to both zone X and zone Y | two zones in `floorLayout.json` share one `adminTableId` | re-link one of them in the editor |
| table #N has no zone on the floor plan | table added in restoAdmin | draw a zone for it and link it |

A renamed table keeps working in the meantime. Orders and status still sync by `adminTableId`, and
the zone's "Synced to" label picks up the new name on the next load. The warning just keeps
`floorLayout.json` honest.

## Where the code is

| What | Where |
| --- | --- |
| The on/off setting | [`src/config/layoutEditor.ts`](../src/config/layoutEditor.ts), typed in [`src/vite-env.d.ts`](../src/vite-env.d.ts) |
| Fixed layout + helpers | [`src/data/floorLayout.json`](../src/data/floorLayout.json), [`src/data/floorLayout.ts`](../src/data/floorLayout.ts) |
| The editor overlay (move/resize/draw/delete, editor bar) | [`src/layoutEditor/LayoutEditor.tsx`](../src/layoutEditor/LayoutEditor.tsx) |
| Zone edit + restoAdmin link modal | [`src/layoutEditor/EditTableModal.tsx`](../src/layoutEditor/EditTableModal.tsx) |
| Info panel widget/layout modal | [`src/layoutEditor/InfoPanelModal.tsx`](../src/layoutEditor/InfoPanelModal.tsx) |
| Where it plugs in | [`App.tsx`](../src/App.tsx) (lazy `LayoutEditor`, draft save/load), [`FloorPlanMap.tsx`](../src/components/FloorPlanMap.tsx) (Edit Zones button, `editor` slot in the canvas) |
| restoAdmin table list for the picker (backend) | `GET /api/admin/tables` in [`server/index.ts`](../server/index.ts); see [blue-moon-integration.md](blue-moon-integration.md#how-linking-works) |

How it fits together: `FloorPlanMap` is read-only and always draws the zones and panels. When editing,
`App` passes the lazily-loaded `LayoutEditor` into FloorPlanMap's `editor` slot. The editor is a
transparent layer over the canvas that catches every mouse event and writes geometry straight into
App's `tables` / `infoPanels` state. So the map redraws live while you drag, and the editor never
needs its own copy of how zones look.

## Making the editor available to staff again

If the restaurant later wants staff to edit the layout on the live dashboard, turning the flag on for
a production build (`VITE_ENABLE_LAYOUT_EDITOR=true npm run build`) is **not enough**. Drafts are
per-browser, so each device would have its own layout again, which is the problem this change fixed.
That would need the layout stored server-side (e.g. a restoDashboard backend endpoint in place of
`floorLayout.json`), which is a separate piece of work.
