import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

/**
 * A tiny in-memory fixed-window rate limiter, keyed by client IP. Enough to blunt abuse of the public API on one
 * server; it is not shared across instances, so a horizontally-scaled deploy would move this to a shared store.
 */
export function rateLimit(options: { perMinute: number; now?: () => number }): MiddlewareHandler {
  const windowMs = 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = () => options.now?.() ?? Date.now();
  return async (c, next) => {
    if (options.perMinute <= 0) return next();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';
    const t = now();
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= t) { entry = { count: 0, resetAt: t + windowMs }; hits.set(ip, entry); }
    entry.count += 1;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k); // opportunistic sweep
    if (entry.count > options.perMinute) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      c.header('Retry-After', String(retry));
      throw new ApiError(429, 'RATE_LIMITED', `Too many requests. Try again in ${retry}s.`);
    }
    return next();
  };
}
