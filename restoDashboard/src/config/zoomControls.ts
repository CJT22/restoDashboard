// The floor plan's zoom in / zoom out / reset buttons are dormant: the plan is
// fixed at its default size (the largest 16:9 box that fits the workspace).
// Set VITE_ENABLE_ZOOM_CONTROLS=true (e.g. in a git-ignored .env.local) to
// bring them back — see docs/zoom-controls.md.
//
// Vite inlines import.meta.env at build time, so with the flag unset this is
// a literal `false` and the buttons are dropped from the bundle; the zoom
// level then simply stays at 1x.
export const ZOOM_CONTROLS_ENABLED = import.meta.env.VITE_ENABLE_ZOOM_CONTROLS === 'true';
