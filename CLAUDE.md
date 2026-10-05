# CLAUDE.md

Guidance for Claude Code when working in this repository.

This repo is **restoDashboard** — the Blue Moon floor-plan/zone status dashboard (React frontend +
a small Node/Express backend in [server/](server/)). It connects to **restoAdmin**, the restaurant
back office, which is a **separate repo** cloned next to this one at
`C:/Users/Chester/Desktop/Projects/restoAdmin` (see [docs/blue-moon-integration.md](docs/blue-moon-integration.md)).

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
