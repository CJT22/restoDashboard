# Blue Moon Dashboard: Android tablet app

A Flutter version of the restoDashboard web frontend, for landscape Android tablets. It has the same
screens and actions as the web dashboard and talks to the same dashboard server
([server/](../server/)). It never talks to restoAdmin directly.

## How it connects

The app needs one address: the dashboard's **web address**. Each build carries its own (see
[Builds](#builds)), and it can't be changed on the tablet: a different address means a different
build.

| Where | Address |
| --- | --- |
| Local dev (`npm run dev:all`) | `http://<this PC's LAN IP>:3500` |
| Server (PM2) | `http://<server>:2520` |

That address passes `/api/*` through to the Node server (`:3510`) and serves the floor plan images
(`/floorplans/*.webp`). The app uses:

- `/api/auth/*` to sign in. The sign-in page has one **Quick Login** button; the server signs in
  with its shared dashboard account (`bm_dash`, see `DASHBOARD_USERNAME` in `.env.example`). The
  server's `rd_session` cookie is stored on the device and sent with every call.
- `/api/layout` for the floor plan (served from `src/data/floorLayout.json`, so tablets always match the
  web version).
- `/api/admin/*` for tables, orders, menu and sales, and `/api/admin/stream` for live updates.

Every device uses that one account, and restoAdmin allows one session per account, so signing in on
a tablet signs out whichever device (tablet or browser) was signed in before.

## Builds

There are three builds (Flutter flavors), each with its own address in `config/<flavor>.json`. They
install side by side as separate apps:

| Flavor | App name | Package | Address (`config/…json`) |
| --- | --- | --- | --- |
| `prod` | Blue Moon (Prod) | `com.bluemoon.resto_dashboard` | `prod.json`: **empty, no production address yet** |
| `dev` | Blue Moon | `….dev` | `dev.json`: `http://45.32.119.62:2520` |
| `local` | Blue Moon (Local) | `….local` | `local.json`: `http://192.168.110.26:3500` |

Dev is the everyday app, so it has the plain name. The sign-in page shows no address and has no way
to change it. `prod` and `local` show a **PROD BUILD** / **LOCAL BUILD** tag there. A build without
an address (`prod`, until its address is filled in) can't sign in: its sign-in page says so and its
Quick Login button is disabled.

### Release signing

Every release build is signed with the Blue Moon release key, and every update must be: Android
only installs an update signed with the same key as the installed app. The key lives outside the
repo:

- `C:/Users/Chester/keystores/blue-moon-dashboard-release.jks`, the keystore;
- `android/key.properties` (gitignored), which names the keystore and holds its passwords.

A release build without `key.properties` stops with an error instead of signing with another key.
**Back up both files together**, in at least two places (a password manager's file attachment and
an offline USB drive, say), never in git. To build on another PC, copy both there and fix
`storeFile` in `key.properties`. A lost key means no tablet can update again: each would need the
app uninstalled and a newly signed one installed by hand.

### Publishing an update (in-app updates)

Tablets update themselves: the sign-in page's **Check for updates** button (top right) and a check
each time the app starts ask the dashboard server for a newer release of their flavor. If there is
one, staff tap **Yes, update**, the APK downloads, and Android asks to install it. The first time,
Android also asks to allow installs from Blue Moon. Once signed in, the app doesn't check.

1. **Bump the version** in `pubspec.yaml` (`version: x.y.z+N`). The build number `N` must go up
   every release: tablets only install a higher one.
2. **Publish** from the repo root:
   `npm run release:app -- dev --notes "What changed, for staff"`. This builds the flavor's release
   APK and uploads it to that flavor's server (the address in `config/<flavor>.json`). It stops
   early if `N` isn't above the published release.

Publishing needs `APP_RELEASE_TOKEN` in the `.env` of both this PC and that server (the same value;
see `.env.example`), and the server running a dashboard version with `/api/app`. The server keeps
releases in `releases/<flavor>/` (gitignored). A new tablet can get the latest app without a cable
by opening `<address>/api/app/download/<flavor>` in its browser and installing the download.

### Releasing to production

1. **Set the address.** Put the production dashboard's web address in `config/prod.json`, e.g.
   `"DASHBOARD_URL": "http://<server>:2520"` (the Vite frontend's port under PM2, not the API's).
   Open it in a browser first: the sign-in page should load, and `/floorplans/first_floor.webp`
   should show the 1st floor image.
2. **Set `APP_RELEASE_TOKEN`** in the production server's `.env`.
3. **Bump the version and publish:** `npm run release:app -- prod --notes "…"`.
4. **First install** on each tablet: open `<address>/api/app/download/prod` in the tablet's browser
   (or `adb install` the APK from `build/app/outputs/flutter-apk/`). From then on, tablets update
   in-app. It always runs fullscreen (a swipe from an edge shows Android's bars, which hide again on
   their own) and opens on its sign-in page, with the Quick Login button.

The app uses plain `http` (`android:usesCleartextTraffic="true"`), so an `http://` address works. An
`https://` one does too, if the server has a valid certificate.

## Run

Needs Flutter (3.44+) and JDK 21 for Gradle (`flutter config --jdk-dir <jdk-21>`). Gradle 8.14 can't
run on newer JDKs such as Android Studio's bundled 25.

```sh
cd mobile
flutter run -d <device-id> --flavor local --dart-define-from-file=config/local.json
# an installable APK:
flutter build apk --flavor dev --dart-define-from-file=config/dev.json
```

Always pass the flavor's matching config file. Judge smoothness on a `--profile` or `--release` build:
debug builds are much slower. `--dart-define=PERF_OVERLAY=true` shows Flutter's frame-time graphs.

## Layout

- `lib/api/`: HTTP client (session cookie, every endpoint), live stream (server-sent events) and
  data models.
- `lib/state/`: `DashboardState` (zones, live sync and resync, the same rules as `src/App.tsx`) and
  the menu catalog (`src/services/menuCatalog.ts`).
- `lib/ui/`: one file per screen, named after its React counterpart (`floor_plan.dart` ↔
  `FloorPlanMap.tsx`, `table_detail.dart` ↔ `TableDetailModal.tsx`, …).
- `lib/util/`: formatting and room timers (`src/utils/roomTimer.ts`).

When a web dashboard rule changes (room timers, menu groups, receipt rows…), change its Dart
counterpart too.
