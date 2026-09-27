import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { rateLimit } from './rate-limit';
import { z } from 'zod/v4';
import { venues, venueBySlug } from './venues';
import { chatTurn, chatInputSchema } from './chat';
import { bookingRequestSchema } from './booking-browser';
import { ProfileStore, isComplete } from './profile';
import { AvailabilityService, summarize, type SearchIntent } from './availability';
import { BookingJobs } from './jobs';
import type { BookingLedger } from './ledger';
import type { ModelRunner } from './ai';
import { ApiError } from './errors';
import { randomUUID } from 'node:crypto';
import { log, requestLogger } from './logger';
import { searchPageUrl as sevenRoomsUrl, dateSchema, timeSchema } from './sevenrooms';

export type { BookingJob, JobState } from './jobs';
export type { VenueAvailability } from './availability';
export { closestSlot, summarize } from './availability';

export type AppServices = {
  useCodex: boolean;
  bookingMode?: 'auto' | 'handoff';
  /** The chat model backend (Anthropic API or Codex CLI). Absent = parser only. */
  model?: ModelRunner;
  /** Which backend `model` is, so a turn it answers is labelled correctly. */
  modelSource?: 'anthropic' | 'codex';
  availability: AvailabilityService;
  jobs: BookingJobs;
  profiles: ProfileStore;
  ledger?: BookingLedger;
  now?: () => Date;
  /** Extra fields for /api/health, e.g. the browser pool's status. */
  health?: () => Record<string, unknown>;
  /** In production, serve the built web from this directory (relative to cwd) and fall back to its index.html. */
  webDir?: string;
  /** The built index.html, served for any non-API GET so the single-page app loads on every path. */
  indexHtml?: string;
  /** Per-IP request cap per minute on /api/* (0 disables). */
  rateLimitPerMinute?: number;
};

/** HTTP only: parse, delegate, shape the response. Business rules live in the services. */
export function createApp(services: AppServices) {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use('*', requestLogger);
  // 128 KB comfortably covers the largest schema-valid chat payload (60 messages × 2000 chars ≈ 120 KB).
  app.use('/api/*', bodyLimit({ maxSize: 128 * 1024, onError: c => c.json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }, 413) }));
  if (services.rateLimitPerMinute && services.rateLimitPerMinute > 0) app.use('/api/*', rateLimit({ perMinute: services.rateLimitPerMinute }));
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: error.code, message: error.message, details: error.details }, error.status);
    log('error', 'unhandled', { id: c.get('requestId'), path: new URL(c.req.url).pathname, message: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'INTERNAL', message: 'Something went wrong on the server. Check the API log.' }, 500);
  });
  app.notFound(c => {
    const path = new URL(c.req.url).pathname;
    // In production, any non-API GET that matched no file falls back to the single-page app's index.html.
    if (services.webDir && services.indexHtml && c.req.method === 'GET' && !path.startsWith('/api')) return c.html(services.indexHtml);
    return c.json({ error: 'NOT_FOUND', message: `No route for ${c.req.method} ${path}.` }, 404);
  });

  app.get('/api/health', c => c.json({ ok: true, chat: services.modelSource ?? 'parser', bookingMode: services.bookingMode ?? 'auto', venues: venues.length, jobs: services.jobs.status(), ...services.health?.() }));
  app.get('/api/venues', c => c.json({ venues }));

  app.get('/api/profile', async c => { const profile = await services.profiles.read(); return c.json({ profile, complete: isComplete(profile) }); });
  app.put('/api/profile', async c => {
    const body = await c.req.json().catch(() => { throw new ApiError(400, 'BAD_REQUEST', 'Send a JSON body.'); });
    try { const profile = await services.profiles.write(body); return c.json({ profile, complete: isComplete(profile) }); }
    catch { throw new ApiError(400, 'BAD_REQUEST', 'Profile fields must be short text.'); }
  });

  app.post('/api/chat', async c => {
    const input = chatInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new ApiError(400, 'BAD_REQUEST', 'Send messages and intent.');
    const turn = await chatTurn(input.data, { useCodex: services.useCodex, now: services.now?.(), run: services.model, modelSource: services.modelSource });
    if (!turn.ready || turn.intent.unsupportedLocation) return c.json({ ...turn, ready: false, results: null });
    const intent = turn.intent as SearchIntent;
    const results = await services.availability.search(intent);
    // If the asked-for area has nothing to book, suggest bookable places elsewhere in the same city.
    const nearby = results.some(r => r.slots.some(s => s.type === 'book')) ? [] : await services.availability.searchNearby(intent);
    return c.json({ ...turn, reply: summarize(results, intent, nearby), results, nearby: nearby.length ? nearby : null });
  });

  app.post('/api/book', async c => {
    const parsed = bookingRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Check the booking details and contact fields.', z.treeifyError(parsed.error));
    const venue = venueBySlug(parsed.data.venue);
    if (!venue) throw new ApiError(404, 'UNKNOWN_VENUE', 'That restaurant is not in the demo list.');
    return c.json({ job: await services.jobs.start(parsed.data, venue) }, 202);
  });
  app.post('/api/book/:id/confirm', async c => c.json({ job: await services.jobs.confirm(c.req.param('id')) }, 202));
  app.delete('/api/book/:id', async c => c.json({ job: await services.jobs.cancel(c.req.param('id')) }));
  app.get('/api/book/:id', c => c.json({ job: services.jobs.get(c.req.param('id')) }));
  app.get('/api/bookings', async c => c.json({ bookings: services.ledger ? await services.ledger.list() : [] }));
  /** Record a booking the diner completed themselves on SevenRooms (handoff mode or a manual finish). */
  app.post('/api/bookings', async c => {
    const parsed = z.object({ venue: z.string(), date: dateSchema, time: timeSchema, partySize: z.number().int().min(1).max(8), reference: z.string().max(40).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Send a valid venue, ISO date (YYYY-MM-DD), 24-hour time (HH:MM) and party size.');
    const venue = venueBySlug(parsed.data.venue);
    if (!venue) throw new ApiError(404, 'UNKNOWN_VENUE', 'That restaurant is not in the list.');
    if (!services.ledger) return c.json({ ok: true });
    const entry = { id: randomUUID(), confirmedAt: (services.now?.() ?? new Date()).toISOString(), venue: venue.slug, venueName: venue.name, city: venue.city, date: parsed.data.date, time: parsed.data.time, partySize: parsed.data.partySize, reference: parsed.data.reference, pageUrl: sevenRoomsUrl(venue.slug, parsed.data.date, parsed.data.partySize, parsed.data.time) };
    await services.ledger.append(entry);
    return c.json({ booking: entry }, 201);
  });
  /** Recent jobs with their outcomes and submit diagnostics, newest first. Diner PII is stripped: this endpoint is unauthenticated. */
  app.get('/api/jobs', c => c.json({ jobs: services.jobs.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(({ request, ...job }) => {
    // Drop the filled contact values and the raw checkout page text / request bodies so no diner's name, email or phone leaks here.
    const prepared = job.prepared ? { ...job.prepared, values: undefined } : undefined;
    const d = job.result?.diagnostics;
    const result = job.result ? { ...job.result, diagnostics: d ? { ...d, pageText: '', requests: d.requests.map(({ body, ...r }) => r) } : undefined } : undefined;
    return { ...job, prepared, result, request: { venue: request.venue.slug, date: request.date, time: request.time, partySize: request.partySize } };
  }) }));
  // Registered last, so it only handles what the API routes above did not: the built web (assets, index.html).
  if (services.webDir) app.use('/*', serveStatic({ root: services.webDir }));
  return app;
}
