import { serve } from '@hono/node-server';
import { createApp } from './app';
const useCodex = process.env.PEARL_DEMO_AI !== 'off';
const app = createApp({ useCodex });
const port = Number(process.env.PEARL_DEMO_API_PORT || 8788);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, info => {
  console.log(`Pearl demo API: http://127.0.0.1:${info.port} · chat via ${useCodex ? 'Codex CLI (set PEARL_DEMO_AI=off for the built-in parser)' : 'built-in parser'} · availability and booking via the public SevenRooms widget`);
});
