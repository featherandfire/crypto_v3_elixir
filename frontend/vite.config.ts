import { defineConfig } from 'vite';

// Dev on :3000; /api/* proxies to Phoenix on :4000.
// Disk layout: `static/`, `templates/`, `index.html` at root.
// Partials are inlined directly into index.html (HTML-inject plugin was
// dropped — parse5 truncated complex Alpine expressions mid-attribute).
export default defineConfig({
  publicDir: false,
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
