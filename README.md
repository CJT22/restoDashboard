# 3Core Restaurant Platform

This repository contains two apps, developed and deployed independently but integrated for the
Blue Moon branch:

- **[restoAdmin/](restoAdmin/)** — the restaurant admin/back-office web app (React + Node/Express +
  MySQL, plus a Python analytics service). Branch, table, menu, order, billing, and employee
  management.
- **[restoDashboard/](restoDashboard/)** — a floor-plan/zone status dashboard (React) for front-of-house
  staff to see and update table/room status on an interactive floor map.

For Blue Moon, a restoDashboard zone can be optionally linked to a restoAdmin table so status stays
in sync between the two apps in real time. See **[docs/blue-moon-integration.md](docs/blue-moon-integration.md)**
for how that works and why it's built the way it is — this README only covers getting both apps
running locally.

Changes to either app are tracked together in **[CHANGELOG.md](CHANGELOG.md)**; see
**[CLAUDE.md](CLAUDE.md)** for the contribution/changelog convention.

## Prerequisites

- **Node.js 18+** and npm (both apps)
- **MySQL** (restoAdmin only) — local dev typically uses [XAMPP](https://www.apachefriends.org/); the
  default config expects it on `localhost:3306`
- **Python 3.10+** and pip (restoAdmin's `pyserver` only — this is an optional analytics service; the
  rest of restoAdmin works without it)

> **Database note:** this repo does not include a full schema dump. Many tables self-create on
> server boot (see `server/models/*.js` and `server/utils/ensureSchema.js` in restoAdmin), but core
> tables (`user_info`, `restaurant_tables`, `orders`, menu tables, etc.) are expected to already
> exist. If you're setting up fresh rather than restoring an existing `restaurants` database dump,
> get one from the team first.

## Setup: restoAdmin

```bash
cd restoAdmin
npm install
cd server && npm install && cd ..
cp .env.example .env   # adjust DB_HOST/DB_USER/DB_PASSWORD/DB_NAME etc. for your MySQL setup
```

Optional — only needed for the analytics/reporting service (`pyserver`):

```bash
cd pyserver
python -m venv .venv
# Windows:
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/Scripts/activate
pip install -r requirements.txt
cd ..
```

Run everything (Vite frontend on `:3000`, Node API on `:2000`, and PyServer on `:2100` if the venv
above is set up):

```bash
npm run dev:all
```

Or run just the frontend + Node API without PyServer:

```bash
npm run dev        # frontend, :3000
npm run dev:server # Node API, :2000
```

Open `http://localhost:3000` and log in (see [restoAdmin/README.md](restoAdmin/README.md) for local
dev credentials).

## Setup: restoDashboard

```bash
cd restoDashboard
npm install
cp .env.example .env
```

`restoDashboard/.env` needs restoAdmin's Node API reachable (`ADMIN_API_BASE_URL`, defaults to
`http://localhost:2000`) and credentials for a dedicated restoAdmin user account — see
**[docs/blue-moon-integration.md](docs/blue-moon-integration.md#setting-up-the-sync-account)** for
how to create that account. The dashboard still runs and is fully usable without it configured; only
the Blue Moon linking/sync feature needs it.

Run everything (Vite frontend on `:3500`, the sync backend on `:3510`):

```bash
npm run dev:all
```

Open `http://localhost:3500`.

## Running both together

For the Blue Moon integration to actually sync, both apps need to be running:

1. Start restoAdmin first (`npm run dev:all` in `restoAdmin/`).
2. Create the dedicated sync user account in restoAdmin (Employees/User Management), scoped to the
   Blue Moon branch — see [docs/blue-moon-integration.md](docs/blue-moon-integration.md#setting-up-the-sync-account).
3. Put that account's credentials in `restoDashboard/.env`.
4. Start restoDashboard (`npm run dev:all` in `restoDashboard/`).
5. In restoDashboard, edit a zone and link it to a Blue Moon table. Status changes on either side
   should now show up on the other without a manual refresh.

## More docs

- [CHANGELOG.md](CHANGELOG.md) — history of notable changes to either app
- [CLAUDE.md](CLAUDE.md) — changelog/contribution convention for AI-assisted changes
- [docs/blue-moon-integration.md](docs/blue-moon-integration.md) — how and why the two apps are linked
- [restoAdmin/README.md](restoAdmin/README.md), [restoAdmin/pyserver/README.md](restoAdmin/pyserver/README.md)
- [restoDashboard/README.md](restoDashboard/README.md)

## Troubleshooting

- **Port already in use:** restoAdmin uses `3000`/`2000`/`2100`, restoDashboard uses `3500`/`3510`.
  Free the port or adjust it in the relevant `vite.config.ts` / `.env` / `package.json` script.
- **restoDashboard's link picker is empty or errors:** confirm restoAdmin's Node API is running and
  reachable at `ADMIN_API_BASE_URL`, and that the sync account credentials in
  `restoDashboard/.env` are correct.
- **Status changes aren't syncing live:** both apps rely on restoAdmin's Socket.IO server (started
  alongside its Node API). If it's not running, changes still save but won't push live — a page
  refresh will still pick up the latest state on both sides.
