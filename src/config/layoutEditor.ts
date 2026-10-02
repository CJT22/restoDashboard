// The floor-plan layout editor (Edit Zones: move/resize/draw/delete zones and
// info panels, link zones to restoAdmin tables) is dormant: the restaurant's
// layout is fixed in src/data/floorLayout.json. Set VITE_ENABLE_LAYOUT_EDITOR
// =true (e.g. in a git-ignored .env.local) to bring it back for a
// re-layout — see docs/layout-editor.md.
//
// Vite inlines import.meta.env at build time, so with the flag unset this is
// a literal `false` and every `if (LAYOUT_EDITOR_ENABLED)` branch — including
// the lazy import of src/layoutEditor/ — is dropped from the bundle entirely.
export const LAYOUT_EDITOR_ENABLED = import.meta.env.VITE_ENABLE_LAYOUT_EDITOR === 'true';
