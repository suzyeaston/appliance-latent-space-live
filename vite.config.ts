import { defineConfig } from 'vite';

// Everything ships from the local bundle. No CDN fonts, samples or scripts, so the
// instrument keeps working on a train with no signal.
export default defineConfig({
  base: './', // portable under GitHub Pages or a WordPress-hosted subdirectory
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
