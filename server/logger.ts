import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.TAVOLA_LOG_LEVEL as Level) || 'info';
export function setLogLevel(level: Level) { threshold = level; }

/** One JSON line per event. Never logs diner contact details or page contents. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (order[level] < order[threshold]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'error' || level === 'warn') console.error(line); else console.log(line);
}

/** Request id + timing for every API call. The id is echoed in the `x-request-id` header. */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const id = c.req.header('x-request-id') || randomUUID().slice(0, 8);
  const started = performance.now();
  c.set('requestId', id);
  await next();
  c.header('x-request-id', id);
  log('info', 'http', { id, method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms: Math.round(performance.now() - started) });
};
