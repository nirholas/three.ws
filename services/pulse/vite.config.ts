import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  test: { root: '.', include: ['tests/**/*.test.ts'] },
  server: { port: 5173, proxy: { '/api': `http://localhost:${process.env.PORT ?? 8787}` } },
});
