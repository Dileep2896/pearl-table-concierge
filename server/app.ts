import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod/v4';
import { venues, venueBySlug } from './venues';
import { chatTurn, chatInputSchema } from './chat';
import { bookingRequestSchema } from './booking-browser';
import { ProfileStore, isComplete } from './profile';
import { AvailabilityService, summarize, type SearchIntent } from './availability';
import { BookingJobs } from './jobs';
import type { BookingLedger } from './ledger';
import type { CodexRunner } from './codex';
import { ApiError } from './errors';
import { log, requestLogger } from './logger';

export type { BookingJob, JobState } from './jobs';
export type { VenueAvailability } from './availability';
export { closestSlot, summarize } from './availability';

export type AppServices = {
  useCodex: boolean;
  codex?: CodexRunner;
  availability: AvailabilityService;
  jobs: BookingJobs;
  profiles: ProfileStore;
  ledger?: BookingLedger;
  now?: () => Date;
  /** Extra fields for /api/health, e.g. the browser pool's status. */
  health?: () => Record<string, unknown>;
};

/** HTTP only: parse, delegate, shape the response. Business rules live in the services. */
export function createApp(services: AppServices) {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use('*', requestLogger);
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }, 413) }));
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: error.code, message: error.message, details: error.details }, error.status);
    log('error', 'unhandled', { id: c.get('requestId'), path: new URL(c.req.url).pathname, message: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'INTERNAL', message: 'Something went wrong on the server. Check the API log.' }, 500);
  });
  app.notFound(c => c.json({ error: 'NOT_FOUND', message: `No route for ${c.req.method} ${new URL(c.req.url).pathname}.` }, 404));

  app.get('/api/health', c => c.json({ ok: true, codex: services.useCodex, venues: venues.length, jobs: services.jobs.status(), ...services.health?.() }));
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
    const turn = await chatTurn(input.data, { useCodex: services.useCodex, now: services.now?.(), run: services.codex });
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
  /** The restaurant's page at the moment Pearl stopped. Served separately so job polling stays small. */
  app.get('/api/book/:id/evidence.png', c => {
    const image = services.jobs.evidence(c.req.param('id'));
    if (!image) throw new ApiError(404, 'NO_EVIDENCE', 'No screenshot for this booking.');
    return c.body(new Uint8Array(image), 200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=600' });
  });
  app.get('/api/bookings', async c => c.json({ bookings: services.ledger ? await services.ledger.list() : [] }));
  /** Recent jobs with their outcomes and submit diagnostics, newest first. Contact details are stripped. */
  app.get('/api/jobs', c => c.json({ jobs: services.jobs.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(({ request, ...job }) => ({ ...job, request: { venue: request.venue.slug, date: request.date, time: request.time, partySize: request.partySize } })) }));
  return app;
}
