import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/echo/',
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdf';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
