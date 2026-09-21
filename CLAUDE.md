# CLAUDE.md

Guidance for Claude Code when working in this repository.

This repo contains two separate apps:
- [restoAdmin/](restoAdmin/) — the restaurant admin/back-office web app (React + Node/Express + MySQL, plus a Python analytics service).
- [restoDashboard/](restoDashboard/) — the floor-plan/zone status dashboard (React, client-side only).

They previously tracked changes independently; this file and [CHANGELOG.md](CHANGELOG.md) now live at the repo root so changes to **either or both** apps are recorded in one shared history — useful for work that spans both, like syncing data between them.

## Changelog is mandatory

Every time you implement a code change (feature, fix, removal, refactor that changes behavior) in either app, you **must** update [CHANGELOG.md](CHANGELOG.md) in the same turn as part of the work — not just when asked.

- Add an entry under the current unreleased version section (bump to a new `## [x.y.z]` heading if the top entry has already shipped/been committed as a release).
- **Prefix every bullet with which app it touches**: `**[restoAdmin]**` or `**[restoDashboard]**` at the start of the bullet, before the bold headline. For a change spanning both, use `**[restoAdmin + restoDashboard]**`.
- Use the existing style: `### Added` / `### Changed` / `### Removed` subsections, bold the headline of each bullet, and link to the files touched relative to the repo root (e.g. `[App.tsx](restoDashboard/src/App.tsx)`, `[tableModel.js](restoAdmin/server/models/tableModel.js)`).
- Explain the *why*/user-facing effect, not just a restatement of the diff.
- Skip this only for changes with no behavioral or user-facing effect (e.g. pure comments, formatting-only edits) — use judgment, but default to logging it.
