import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // mobile/ (the Flutter app) is skipped: its build output churns and is
      // locked mid-build on Windows, which crashed the watcher (EBUSY).
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/mobile/**'] },
      host: true,
      // Proxy to this project's own backend (server/index.ts), which holds
      // the restoAdmin credentials and proxies/bridges everything the
      // browser needs -- the browser never talks to restoAdmin directly.
      proxy: {
        '/api': {
          // API_PORT is set by PM2 on the server (ecosystem.config.cjs);
          // local dev falls back to the backend's default port.
          target: `http://localhost:${process.env.API_PORT || 3510}`,
          changeOrigin: true,
        },
      },
    },
  };
});
