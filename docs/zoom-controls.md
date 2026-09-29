# Zoom controls (dormant)

The floor plan used to have **zoom in**, **zoom out** and **reset zoom** buttons in its top-right
bar. They were turned off on request: the default view (the floor plan filling the workspace as
the largest 16:9 box that fits) is the fixed view for every screen. The top-right bar now holds only
**Info Panels** and **Fullscreen**.

The zoom code is still in the repo, in
[`FloorPlanMap.tsx`](../restoDashboard/src/components/FloorPlanMap.tsx), behind one build-time
setting in [`src/config/zoomControls.ts`](../restoDashboard/src/config/zoomControls.ts):

```ts
export const ZOOM_CONTROLS_ENABLED = import.meta.env.VITE_ENABLE_ZOOM_CONTROLS === 'true';
```

- **Off (the default):** the three buttons are left out of the build, and the zoom level stays at
  1×.
- **On:** the three buttons come back at the left of the top-right bar, working as before (0.7× to
  1.6× in 0.15 steps, keeping the view centred, with scrollbars when zoomed in). Nothing else in the
  code needs to change.

This setting is separate from the layout editor's `VITE_ENABLE_LAYOUT_EDITOR`
([layout-editor.md](layout-editor.md)); either can be on without the other.

## Turning it on

- **For one run** (Git Bash / macOS / Linux):
  ```bash
  cd restoDashboard
  VITE_ENABLE_ZOOM_CONTROLS=true npm run dev:all
  ```
  In PowerShell: `$env:VITE_ENABLE_ZOOM_CONTROLS='true'; npm run dev:all`
- **On your machine until you remove it:** add this line to `restoDashboard/.env.local`
  (git-ignored):
  ```
  VITE_ENABLE_ZOOM_CONTROLS=true
  ```
- **For everyone (bringing zoom back for good):** set `VITE_ENABLE_ZOOM_CONTROLS=true` in the
  environment of the production build, or change the line in `zoomControls.ts` to
  `export const ZOOM_CONTROLS_ENABLED = true;`.

Vite only reads this at startup, so **restart the dev server** (or rebuild) after changing it.

Or hand this to Claude Code or another developer: *"Turn the restoDashboard zoom controls back on
for everyone — see docs/zoom-controls.md."*
