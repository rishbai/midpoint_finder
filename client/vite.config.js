import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
    // Lets an HTTPS tunnel (ngrok/Cloudflare quick tunnel) reach this dev
    // server — Vite blocks requests whose Host header it doesn't recognize
    // by default. Fine for temporarily sharing a dev build with friends;
    // don't ship this to a real deployment.
    allowedHosts: true,
  },
});
