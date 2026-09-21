# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Changelog is mandatory

Every time you implement a code change (feature, fix, removal, refactor that changes behavior), you **must** update [CHANGELOG.md](CHANGELOG.md) in the same turn as part of the work — not just when asked.

- Add an entry under the current unreleased version section (bump to a new `## [x.y.z]` heading if the top entry has already shipped/been committed as a release).
- Use the existing style: `### Added` / `### Changed` / `### Removed` subsections, bold the headline of each bullet, and link to the files touched (e.g. `[App.tsx](src/App.tsx)`).
- Explain the *why*/user-facing effect, not just a restatement of the diff.
- Skip this only for changes with no behavioral or user-facing effect (e.g. pure comments, formatting-only edits) — use judgment, but default to logging it.
