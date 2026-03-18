import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // Vite dev server settings required by Tauri
  server: {
    port: 3000,
    host: '127.0.0.1',
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1', port: 3000 },
  },
  // Produce smaller builds optimised for the Tauri shell
  build: {
    target: ['es2021', 'chrome105', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        splashscreen: path.resolve(__dirname, 'splashscreen.html'),
      },
    },
  },
});
