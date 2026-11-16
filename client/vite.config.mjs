import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const backend = process.env.PORTAL_BACKEND_URL || 'http://localhost:3000';

export default defineConfig({
  root: clientRoot,
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/google': backend,
      '/login': backend,
      '/logout': backend,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
