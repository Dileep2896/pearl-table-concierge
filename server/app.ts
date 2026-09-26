import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { venues, venuesFor, venueBySlug, type Venue } from './venues';
import { fetchAvailability, minutesOf, type Slot } from './sevenrooms';
import { chatTurn, chatInputSchema, describeIntent, type Intent } from './chat';
import { bookingRequestSchema, SevenRoomsBooker, type BookingStep } from './booking-browser';
import { ProfileStore, isComplete } from './profile';

/** `pick` is Pearl's choice when the diner named one time: the bookable slot closest to it. */
export type VenueAvailability = { venue: Venue; slots: Slot[]; pick?: Slot; error?: string };
export type JobState = 'PREPARING' | 'READY' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type BookingJob = {
  id: string; state: JobState; createdAt: string;
  steps: { step: BookingStep; note?: string; at: string }[];
  request: { venue: Venue; date: string; time: string; partySize: number; contact: { firstName: string; lastName: string; email: string; phone: string } };
  /** Present once the form is filled: what Pearl typed and what the restaurant's policy says. */
  prepared?: { policy?: string; values?: Record<string, string>; holdExpiresAt: string };
  /** `screenshot` (a data URL) is attached only when Pearl stopped, as evidence of what the restaurant's page said. */
  result?: { status: string; code: string; message: string; reference?: string; policy?: string; pageUrl?: string; screenshot?: string };
};

export type AppOptions = {
  useCodex: boolean;
  availability?: typeof fetchAvailability;
  booker?: () => SevenRoomsBooker;
  now?: () => Date;
  profiles?: ProfileStore;
  /** How long prepare() may take before the job is failed. */
  prepareTimeoutMs?: number;
  /** Margin before the widget's 5-minute hold lapses at which Pearl gives up the hold itself. */
  holdMarginMs?: number;
  minHoldMs?: number;
};

export async function searchAvailability(intent: Required<Pick<Intent, 'date' | 'timeFrom' | 'timeTo' | 'partySize'>> & Intent, lookup = fetchAvailability): Promise<VenueAvailability[]> {
  const candidates = venuesFor(intent.neighborhood);
  const results: VenueAvailability[] = await Promise.all(candidates.map(async venue => {
    try {
      const slots = await lookup({ venue: venue.slug, date: intent.date, partySize: intent.partySize, timeFrom: intent.timeFrom, timeTo: intent.timeTo });
      return { venue, slots, pick: intent.exactTime ? closestSlot(slots, intent.exactTime) : undefined };
    } catch (error) { return { venue, slots: [], error: error instanceof Error ? error.message : 'lookup failed' }; }
  }));
  // Restaurants with instantly bookable times first, then request-only, then nothing.
  const rank = (entry: VenueAvailability) => entry.slots.some(s => s.type === 'book') ? 0 : entry.slots.length ? 1 : 2;
  return results.sort((a, b) => rank(a) - rank(b) || a.venue.name.localeCompare(b.venue.name));
}

/** Closest bookable slot to the named time; a tie goes to the later one, since arriving early is easier than late. */
export function closestSlot(slots: Slot[], time: string): Slot | undefined {
  const target = minutesOf(time);
  return slots.filter(s => s.type === 'book').sort((a, b) => Math.abs(minutesOf(a.time) - target) - Math.abs(minutesOf(b.time) - target) || minutesOf(b.time) - minutesOf(a.time))[0];
}

export function summarize(results: VenueAvailability[], intent: Intent) {
  if (intent.exactTime) {
    const picks = results.filter(r => r.pick);
    const exact = picks.filter(r => r.pick!.time === intent.exactTime).length;
    if (!picks.length) return `No open tables ${describeIntent(intent)}. Try a different time or date.`;
    return `${picks.length} ${picks.length === 1 ? 'restaurant has' : 'restaurants have'} a table ${describeIntent(intent)}${exact < picks.length ? `, ${exact} at exactly ${intent.exactTime.replace(/^(\d\d):(\d\d)$/, (_, h, m) => `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? 'PM' : 'AM'}`)}` : ''}. Pick a restaurant and I will book the closest time for you.`;
  }
  const bookable = results.flatMap(r => r.slots.filter(s => s.type === 'book'));
  const withTables = results.filter(r => r.slots.some(s => s.type === 'book')).length;
  const requestOnly = results.filter(r => r.slots.length && !r.slots.some(s => s.type === 'book')).length;
  if (!bookable.length && !requestOnly) return `No open tables ${describeIntent(intent)}. Try a different time window or date.`;
  const parts = [`Found ${bookable.length} open ${bookable.length === 1 ? 'time' : 'times'} at ${withTables} ${withTables === 1 ? 'restaurant' : 'restaurants'} ${describeIntent(intent)}.`];
  if (requestOnly) parts.push(`${requestOnly} more ${requestOnly === 1 ? 'takes' : 'take'} requests only.`);
  parts.push('Tap a time and I will book it after you confirm.');
  return parts.join(' ');
}

export function createApp(options: AppOptions) {
  const app = new Hono();
  const profiles = options.profiles ?? new ProfileStore();

  app.get('/api/profile', async c => { const profile = await profiles.read(); return c.json({ profile, complete: isComplete(profile) }); });
  app.put('/api/profile', async c => {
    try { const profile = await profiles.write(await c.req.json()); return c.json({ profile, complete: isComplete(profile) }); }
    catch { return c.json({ error: 'BAD_REQUEST', message: 'Profile fields must be short text.' }, 400); }
  });

  app.get('/api/health', c => c.json({ ok: true, codex: options.useCodex, venues: venues.length }));
  app.get('/api/venues', c => c.json({ venues }));

  app.post('/api/chat', async c => {
    const input = chatInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'BAD_REQUEST', message: 'Send messages and intent.' }, 400);
    const turn = await chatTurn(input.data, { useCodex: options.useCodex, now: options.now?.() });
    if (!turn.ready || turn.intent.unsupportedLocation) return c.json({ ...turn, ready: false, results: null });
    const intent = turn.intent as Required<Pick<Intent, 'date' | 'timeFrom' | 'timeTo' | 'partySize'>> & Intent;
    const results = await searchAvailability(intent, options.availability);
    return c.json({ ...turn, reply: summarize(results, intent), results });
  });

  const jobs = new Map<string, BookingJob>();
  const bookers = new Map<string, SevenRoomsBooker>();
  const now = () => (options.now?.() ?? new Date());
  const finish = async (job: BookingJob, state: JobState, result?: BookingJob['result']) => {
    if (['CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(job.state)) return;
    job.state = state; if (result) job.result = result;
    const booker = bookers.get(job.id); bookers.delete(job.id); await booker?.close();
    console.log(JSON.stringify({ event: 'demo_booking_finished', id: job.id, venue: job.request.venue.slug, state, code: result?.code, reference: result?.reference }));
  };

  // Phase 1: open the page, hold the table, fill the form, then wait for the diner.
  app.post('/api/book', async c => {
    const parsed = bookingRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'BAD_REQUEST', message: 'Check the booking details and contact fields.', issues: z.treeifyError(parsed.error) }, 400);
    const venue = venueBySlug(parsed.data.venue);
    if (!venue) return c.json({ error: 'UNKNOWN_VENUE', message: 'That restaurant is not in the demo list.' }, 404);
    // One live browser at a time: a new pick replaces a pending one and releases its hold.
    for (const job of jobs.values()) if (['PREPARING', 'READY'].includes(job.state)) await finish(job, 'CANCELLED', { status: 'CANCELLED', code: 'REPLACED', message: 'Replaced by a newer pick.' });
    if ([...jobs.values()].some(job => job.state === 'SUBMITTING')) return c.json({ error: 'BUSY', message: 'A booking is being submitted right now. Wait for it to finish.' }, 429);
    const id = randomUUID();
    const job: BookingJob = { id, state: 'PREPARING', steps: [], request: { venue, date: parsed.data.date, time: parsed.data.time, partySize: parsed.data.partySize, contact: parsed.data.contact }, createdAt: now().toISOString() };
    jobs.set(id, job);
    const booker = options.booker?.() ?? new SevenRoomsBooker({ onStep: (step, note) => { job.steps.push({ step, note, at: now().toISOString() }); } });
    bookers.set(id, booker);
    const deadline = setTimeout(() => { void finish(job, 'FAILED', { status: 'FAILED', code: 'TIMEOUT', message: 'The booking browser did not finish preparing within 2 minutes. Nothing was submitted.' }); }, options.prepareTimeoutMs ?? 120_000);
    void booker.prepare({ ...parsed.data, timezone: venue.timezone }).then(prepared => {
      clearTimeout(deadline);
      if (job.state !== 'PREPARING') return;
      if (prepared.status !== 'READY') { void finish(job, 'FAILED', { status: 'FAILED', code: prepared.code, message: prepared.message, policy: prepared.policy, pageUrl: prepared.pageUrl, screenshot: prepared.screenshot ? `data:image/png;base64,${prepared.screenshot.toString('base64')}` : undefined }); return; }
      const holdMs = Math.max(options.minHoldMs ?? 30_000, (prepared.holdSeconds ?? 300) * 1000 - (options.holdMarginMs ?? 20_000));
      job.prepared = { policy: prepared.policy, values: prepared.values, holdExpiresAt: new Date(now().getTime() + holdMs).toISOString() };
      job.state = 'READY';
      const expiry = setTimeout(() => { void finish(job, 'EXPIRED', { status: 'EXPIRED', code: 'HOLD_EXPIRED', message: 'The restaurant’s 5-minute hold lapsed before you confirmed. Pick the time again.' }); }, holdMs); expiry.unref?.();
    }).catch(error => { clearTimeout(deadline); void finish(job, 'FAILED', { status: 'FAILED', code: 'UNEXPECTED', message: error instanceof Error ? error.message : 'Preparation failed.' }); });
    return c.json({ job }, 202);
  });

  // Phase 2: the diner's explicit confirmation is the only thing that presses Submit.
  app.post('/api/book/:id/confirm', async c => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'NOT_FOUND' }, 404);
    if (job.state !== 'READY') return c.json({ error: 'NOT_READY', message: job.state === 'EXPIRED' ? 'The hold expired. Pick the time again.' : `This booking is ${job.state.toLowerCase()}.` }, 409);
    const booker = bookers.get(job.id);
    if (!booker) return c.json({ error: 'NOT_READY', message: 'The browser session is gone. Pick the time again.' }, 409);
    job.state = 'SUBMITTING';
    void booker.confirm().then(result => {
      job.state = 'SUBMITTING'; // finish() only moves out of non-terminal states
      void finish(job, result.status === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED', { status: result.status, code: result.code, message: result.message, reference: result.reference, policy: result.policy, pageUrl: result.pageUrl, screenshot: result.status !== 'CONFIRMED' && result.screenshot ? `data:image/png;base64,${result.screenshot.toString('base64')}` : undefined });
    }).catch(error => { void finish(job, 'FAILED', { status: 'FAILED', code: 'UNEXPECTED', message: error instanceof Error ? error.message : 'Confirmation failed.' }); });
    return c.json({ job }, 202);
  });

  app.delete('/api/book/:id', async c => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'NOT_FOUND' }, 404);
    if (job.state === 'SUBMITTING') return c.json({ error: 'BUSY', message: 'Submit was already pressed; wait for the result.' }, 409);
    await finish(job, 'CANCELLED', { status: 'CANCELLED', code: 'CANCELLED', message: 'Cancelled before submitting. The hold was released.' });
    return c.json({ job });
  });

  app.get('/api/book/:id', c => { const job = jobs.get(c.req.param('id')); return job ? c.json({ job }) : c.json({ error: 'NOT_FOUND' }, 404); });
  return app;
}
