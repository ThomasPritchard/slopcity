import { defineConfig } from 'vite';

export default defineConfig({
  // Rebuild cached dependencies so the pinned SDK compatibility patch is always used.
  optimizeDeps: { force: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/game': { target: 'http://127.0.0.1:2567', ws: true, rewrite: path => path.replace(/^\/game/, '') },
      '/voice': { target: 'http://127.0.0.1:17880', ws: true, rewrite: path => path.replace(/^\/voice/, '') },
    },
  },
  build: { target: 'es2022' },
});
