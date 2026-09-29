/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 'true' turns on the dormant floor-plan layout editor (Edit Zones). See
  // src/config/layoutEditor.ts and docs/layout-editor.md.
  readonly VITE_ENABLE_LAYOUT_EDITOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
