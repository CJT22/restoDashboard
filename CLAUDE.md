# CLAUDE.md

Guidance for Claude Code when working in this repository.

This repo is **restoDashboard** — the Blue Moon floor-plan/zone status dashboard. It has two clients
of one small Node/Express backend in [server/](server/): the **React web app** ([src/](src/)) and the
**Flutter Android tablet app** ([mobile/](mobile/), see [mobile/README.md](mobile/README.md)). It
connects to **restoAdmin**, the restaurant back office, which is a **separate repo** cloned next to
this one at `C:/Users/Chester/Desktop/Projects/restoAdmin` (see
[docs/blue-moon-integration.md](docs/blue-moon-integration.md)).

## One feature, two clients

The web app and the tablet app are the same dashboard and must stay in step. **Every change to
either one also goes to the other, in the same turn**, even when the prompt names only one ("the
app", "the web version", a screenshot of one). The user shouldn't have to ask for the other side.

- Each Dart file mirrors a React one and is named after it: `floor_plan.dart` ↔ `FloorPlanMap.tsx`,
  `sidebar.dart` ↔ `Sidebar.tsx`, `directory_view.dart` ↔ `TableDirectoryView.tsx`,
  `order_queue_view.dart` ↔ `OrderQueueView.tsx`, `info_panel.dart` ↔ `InfoPanelView.tsx`,
  `table_detail.dart` ↔ `TableDetailModal.tsx`, `order_screen.dart` / `new_order_screen.dart` /
  `add_items_screen.dart` ↔ `OrderScreen.tsx` / `NewOrderScreen.tsx` / `AddItemsScreen.tsx`,
  `settle_dialog.dart` ↔ `SettlePaymentModal.tsx`, `login_page.dart` ↔ `LoginPage.tsx`,
  `shell.dart` ↔ `App.tsx`, `theme.dart` ↔ `utils/statusColors.ts`, `util/room_timer.dart` ↔
  `utils/roomTimer.ts`. Rules (room timers, receipt rows, menu groups, filters) must give the same
  results in both.
- Match the look, not the code: same layout, labels, colours and behaviour, written idiomatically
  for each (Tailwind classes on web, widgets in Flutter). Colours that are blended in Dart
  (`Color.alphaBlend`) are written as the resulting hex in Tailwind so both look identical.
- Only skip the other side for something that can't apply there, and say so in your reply:
  - App only: Android system bars and insets (`fullscreen.dart`'s inset handling, immersive mode),
    the build flavors and their addresses, and GPU performance work specific to Flutter/Impeller.
  - Web only: hover cards (no hover on touch), the dormant layout editor and zoom flags, and
    browser limits (e.g. the web can't start in fullscreen, since browsers only allow it from a
    click, so web fullscreen is off by default).
- Verify both: `npx tsc --noEmit -p .` (and `npx vite build` for bigger changes) for web, and
  `flutter analyze` and `flutter test` in `mobile/` for the app.
- One changelog bullet covers both sides of a change, linking the files touched in each.
- Dart style: this code uses the compact pre-3.7 layout (`Row(children: [` on one line, 120
  columns). Don't run `dart format`, which rewrites whole files in the newer "tall" style; match the
  surrounding code by hand.

## Tablet app builds (APKs)

The app has three Flutter flavors, each a separate, side-by-side app with its dashboard address
built in, so staff never type it. Full setup and the production release checklist are in
[mobile/README.md](mobile/README.md#builds).

| Flavor | App name | Package | Address, in `mobile/config/<flavor>.json` |
| --- | --- | --- | --- |
| `prod` | Blue Moon | `com.bluemoon.resto_dashboard` | empty until production is live |
| `dev` | Blue Moon Dev | `….dev` | `http://45.32.119.62:2520` |
| `local` | Blue Moon Local | `….local` | `http://192.168.110.26:3500` |

- Always pass the flavor's own config: `--flavor dev --dart-define-from-file=config/dev.json`. A
  mismatched or missing file builds an app pointing at the wrong server, or at none.
- The address is the dashboard's **web address** (the Vite frontend, `:2520` under PM2), not the
  API port: it proxies `/api` and serves `/floorplans/*.webp`.
- A build with an empty address (prod today) falls back to asking for it on the sign-in page.
  Holding the Blue Moon logo there for 3 seconds lets a technician override any build's address on one
  tablet.
- Release builds are still signed with the debug key ([build.gradle.kts](mobile/android/app/build.gradle.kts)).
  Before shipping prod to real tablets, a release keystore must be set up; flag this if asked to
  build a prod release, since an APK signed with a different key can't update an installed one.
- To test on the tablet with an existing sign-in, run the `prod` flavor: it keeps the original
  package, so the stored session carries over. Judge smoothness only on `--profile`/`--release`
  builds (debug is much slower); `--dart-define=PERF_OVERLAY=true` shows frame-time graphs.

## restoAdmin is read-only

- **Never modify restoAdmin.** It's maintained upstream and the local clone is replaced by every pull.
  Read its code to understand its API, but make every change needed for the connection here, on
  the dashboard side.
- If something genuinely can't work without a restoAdmin change, stop and tell the user — they'll
  raise it with restoAdmin's maintainers. Don't patch the clone as a workaround.
- The dashboard talks to restoAdmin only through its HTTP API and Socket.IO events, configured by
  `.env` (`ADMIN_API_BASE_URL`, etc.). Never import restoAdmin files or hard-code its path in code.

## Changelog is mandatory

Every time you implement a code change (feature, fix, removal, refactor that changes behavior), you
**must** update [CHANGELOG.md](CHANGELOG.md) in the same turn as part of the work — not just when
asked.

- Add an entry under the current unreleased version section (bump to a new `## [x.y.z]` heading if
  the top entry has already shipped/been committed as a release).
- **Check git before every changelog edit, not just once per session.** The user commits between
  turns without saying so, so a section you wrote earlier may already be released. Run
  `git diff HEAD -- CHANGELOG.md` and `git show HEAD:CHANGELOG.md | grep -m1 '^## \['`. If the top
  `## [x.y.z]` heading is already in `HEAD`, that version is released: add a new heading above it
  rather than editing it. Use a patch bump (`x.y.z+1`) for small fixes and UI follow-ups, and a minor
  bump (`x.y+1.0`) for new features.
- Use the existing style: `### Added` / `### Changed` / `### Removed` subsections, bold the headline
  of each bullet, and link to the files touched relative to the repo root (e.g.
  `[App.tsx](src/App.tsx)`, `[adminClient.ts](server/adminClient.ts)`).
- No app prefix on bullets anymore. (Entries up to `[1.21.0]` carry `[restoAdmin]`/`[restoDashboard]`
  prefixes and file links from when both apps shared this repo; leave that history as it is.)
- Explain the *why*/user-facing effect, not just a restatement of the diff.
- Skip this only for changes with no behavioral or user-facing effect (e.g. pure comments,
  formatting-only edits) — use judgment, but default to logging it.
