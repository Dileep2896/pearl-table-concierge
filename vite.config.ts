import { defineConfig } from 'vite';
const apiPort = process.env.TAVOLA_DEMO_API_PORT || '8788';
const webPort = Number(process.env.TAVOLA_DEMO_WEB_PORT || 5180);
export default defineConfig({
  root: '.',
  server: { port: webPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } } },
  build: { outDir: 'dist' },
});
