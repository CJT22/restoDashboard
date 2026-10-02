# restoDashboard

A floor-plan status board for Blue Moon's front-of-house staff. It shows every table and room on an
interactive map of both floors, with live status, active orders and room timers, and lets staff
place and settle orders without switching to the back office.

It runs on top of **restoAdmin** (the restaurant back office), which is a separate project:
restoDashboard reads restoAdmin's tables and orders and sends orders to it, and needs **no changes
to restoAdmin** to do so. See [docs/blue-moon-integration.md](docs/blue-moon-integration.md) for how
the two connect.

## Prerequisites

- **Node.js 18+** and npm.
- A running **restoAdmin** Node API to connect to — locally, a clone of restoAdmin next to this
  folder:

  ```
  Projects/
  ├── restoAdmin/       ← restoAdmin's own repo; set up and run per its README (API on :2000)
  └── restoDashboard/   ← this repo
  ```

  The dashboard only talks to restoAdmin over HTTP, so restoAdmin can live anywhere (or on another
  server); the folder layout above is just the local convention.

## Setup

```bash
npm install
cp .env.example .env
```

In `.env`, set:

- `ADMIN_API_BASE_URL` — restoAdmin's Node API (default `http://localhost:2000`).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — a dedicated restoAdmin account used only by the dashboard.
  See [Setting up the sync account](docs/blue-moon-integration.md#setting-up-the-sync-account).
- `ADMIN_BRANCH_ID` — Blue Moon's branch id (`3`).

## Running

1. Start restoAdmin first (in `../restoAdmin`, per its README — `npm run dev:all` there).
2. Start the dashboard:

   ```bash
   npm run dev:all
   ```

   This runs the Vite frontend on `:3500` and the dashboard's backend on `:3510`.
3. Open `http://localhost:3500`. The sidebar's connection badge shows **Live** once the backend is
   connected to restoAdmin.

The dashboard still opens without restoAdmin running; zones just show no live status or orders until
it's reachable, and it catches up automatically when it is.

| Command | What it does |
| --- | --- |
| `npm run dev:all` | Frontend (`:3500`) and backend (`:3510`) together |
| `npm run dev` / `npm run dev:server` | Just the frontend / just the backend |
| `npm run build` | Production build of the frontend into `dist/` |
| `npm run lint` | Type-check (`tsc --noEmit`) |

## Connecting to a hosted restoAdmin

Pointing the dashboard at a hosted (e.g. production) restoAdmin instead of a local one is an `.env`
change — mainly `ADMIN_API_BASE_URL`, plus a sync account that exists on that server. Read
[Connecting to a hosted restoAdmin](docs/blue-moon-integration.md#connecting-to-a-hosted-restoadmin-production)
first: against production, every order the dashboard creates is real.

## Project layout

```text
├── server/                  # The dashboard's backend: holds the restoAdmin credentials
│   ├── index.ts             #   /api/admin/* routes + SSE stream for the browser
│   ├── adminClient.ts       #   restoAdmin REST client
│   └── socketBridge.ts      #   restoAdmin Socket.IO → SSE relay
├── src/
│   ├── App.tsx              # Layout, live sync wiring, reconciliation
│   ├── components/          # Floor plan, sidebar, table/order modals, directory, order queue
│   ├── services/            # adminSync.ts (tables, shared SSE stream), orderSync.ts, salesSync.ts
│   ├── data/floorLayout.json# The fixed zones + info panels, and each zone's restoAdmin table link
│   ├── layoutEditor/        # Dormant zone editor — see docs/layout-editor.md
│   └── config/              # Build-time feature flags (layout editor, zoom controls)
├── public/floorplans/       # Floor plan images
└── docs/                    # How things work and why
```

## More docs

- [docs/blue-moon-integration.md](docs/blue-moon-integration.md) — how the dashboard connects to
  restoAdmin, the sync account, and switching servers
- [docs/order-sync-integration.md](docs/order-sync-integration.md) — placing and managing orders
- [docs/layout-editor.md](docs/layout-editor.md) — changing the floor layout and zone links
- [docs/zoom-controls.md](docs/zoom-controls.md) — the (off by default) zoom buttons
- [CHANGELOG.md](CHANGELOG.md) — history of notable changes

## Troubleshooting

- **Port already in use:** the dashboard uses `3500` (frontend) and `3510` (backend; `PORT` in
  `.env`, and the proxy target in [vite.config.ts](vite.config.ts)). restoAdmin uses `3000`, `2000`
  and `2100`.
- **Badge says "restoAdmin offline", or nothing loads:** check restoAdmin's Node API is running and
  reachable at `ADMIN_API_BASE_URL`, and that the sync account's credentials in `.env` are right
  (the backend's terminal logs the exact error).
- **The dashboard keeps getting signed out / someone else does:** someone is signing in with the
  sync account elsewhere. restoAdmin allows one session per account; give the dashboard its own.
- **Browser console shows a `[layout] … out of step` warning:** `floorLayout.json` and restoAdmin's
  tables have drifted (table renamed, deleted or added). See
  [docs/layout-editor.md](docs/layout-editor.md#the-startup-link-check).
