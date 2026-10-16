import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls in development; the server's CORS policy covers direct calls.
    proxy: { '/api': 'http://localhost:3001' },
  },
  preview: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
