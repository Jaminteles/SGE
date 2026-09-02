import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A API fica em outro processo (NestJS, porta 3000). Em desenvolvimento o proxy
// evita CORS e mantém a mesma origem do app; em produção `VITE_API_URL` aponta
// para o gateway.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
