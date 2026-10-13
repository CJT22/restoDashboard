# Blue Moon Dashboard: Android tablet app

A Flutter version of the restoDashboard web frontend, for landscape Android tablets. It has the same
screens and actions as the web dashboard and talks to the same dashboard server
([server/](../server/)). It never talks to restoAdmin directly.

## How it connects

The app needs one address: the dashboard's **web address**. Each build carries its own (see
[Builds](#builds)), so staff never type it; the sign-in page shows it read-only.

| Where | Address |
| --- | --- |
| Local dev (`npm run dev:all`) | `http://<this PC's LAN IP>:3500` |
| Server (PM2) | `http://<server>:2520` |

That address passes `/api/*` through to the Node server (`:3510`) and serves the floor plan images
(`/floorplans/*.webp`). The app uses:

- `/api/auth/*` to sign in. The server's `rd_session` cookie is stored on the device and sent with
  every call.
- `/api/layout` for the floor plan (served from `src/data/floorLayout.json`, so tablets always match the
  web version).
- `/api/admin/*` for tables, orders, menu and sales, and `/api/admin/stream` for live updates.

The sign-in rules are the web dashboard's: a restoAdmin account with role 3 in the Blue Moon branch.
Signing in on the tablet signs that account out everywhere else, including a browser.

## Builds

There are three builds (Flutter flavors), each with its own address in `config/<flavor>.json`. They
install side by side as separate apps:

| Flavor | App name | Package | Address (`config/…json`) |
| --- | --- | --- | --- |
| `prod` | Blue Moon | `com.bluemoon.resto_dashboard` | `prod.json`: empty until production is set up |
| `dev` | Blue Moon Dev | `….dev` | `dev.json`: `http://45.32.119.62:2520` |
| `local` | Blue Moon Local | `….local` | `local.json`: `http://192.168.110.26:3500` |

A build with an address shows it on the sign-in page and has no address field. A build without one
(`prod`, until its address is filled in) asks for it on the sign-in page, as before. Non-prod builds
show a **DEV BUILD** / **LOCAL BUILD** tag there.

**Technician override:** hold the Blue Moon logo on the sign-in page for 3 seconds to point that tablet at
another address without a new build (**Use built-in** undoes it).

### Releasing to production

1. **Set the address.** Put the production dashboard's web address in `config/prod.json`, e.g.
   `"DASHBOARD_URL": "http://<server>:2520"` (the Vite frontend's port under PM2, not the API's).
   Open it in a browser first: the sign-in page should load, and `/floorplans/first_floor.webp`
   should show the 1st floor image.
2. **Set up release signing (once).** Release builds are still signed with the debug key
   (`android/app/build.gradle.kts`). Create a release keystore, keep it and its passwords somewhere
   safe outside the repo, and point the `release` build type at it. Every future update must be
   signed with that same key: Android refuses to install an update signed with a different one, so
   a lost key means uninstalling the app on every tablet.
3. **Bump the version** in `pubspec.yaml` (`version: x.y.z+N`; raise `N` every release), or Android
   won't install the APK over an older one.
4. **Build:** `flutter build apk --release --flavor prod --dart-define-from-file=config/prod.json`.
   The APK is `build/app/outputs/flutter-apk/app-prod-release.apk`.
5. **Install** on each tablet (`adb install -r <apk>`, or copy the file and open it with "install
   unknown apps" allowed). It opens in fullscreen on its sign-in page, which shows the server address
   and has no address field.

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
