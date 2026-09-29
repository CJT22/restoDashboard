/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 'true' turns on the dormant floor-plan layout editor (Edit Zones). See
  // src/config/layoutEditor.ts and docs/layout-editor.md.
  readonly VITE_ENABLE_LAYOUT_EDITOR?: string;
  // 'true' brings back the dormant zoom in / out / reset buttons. See
  // src/config/zoomControls.ts and docs/zoom-controls.md.
  readonly VITE_ENABLE_ZOOM_CONTROLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
