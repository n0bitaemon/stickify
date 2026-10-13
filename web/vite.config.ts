import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy so the frontend and API share an origin in dev → the httpOnly cookie works, no CORS needed.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
