import { defineConfig } from 'vite';

// Dev on :3000; /api/* proxies to Phoenix on :4000.
// Disk layout: `static/`, `templates/`, `index.html` at root.
// Partials are inlined directly into index.html (HTML-inject plugin was
// dropped — parse5 truncated complex Alpine expressions mid-attribute).
//
// publicDir: 'static' — copy the entire static/ tree to dist/ verbatim.
// Needed because some assets (wallet logos, tutorial screenshots) are
// referenced at runtime via Alpine :src="..." rather than via HTML
// <link>/<script>/<img> tags that Vite would bundle. Without this,
// runtime-resolved /static/* paths 404 in production.
export default defineConfig({
  publicDir: 'static',
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
