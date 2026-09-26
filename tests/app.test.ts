import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { BookingJobs, type JobsOptions } from '../server/jobs';
import { AvailabilityService, closestSlot, pickFor, summarize } from '../server/availability';
import { ProfileStore } from '../server/profile';
import { BookingLedger } from '../server/ledger';
import type { SevenRoomsBooker, PrepareResult, BookingResult } from '../server/booking-browser';
import type { Slot } from '../server/sevenrooms';

/** A booker double that reports steps and resolves when the test says so. */
function fakeBooker(script: { prepare?: PrepareResult; confirm?: BookingResult; delayMs?: number; onStep?: (step: 'SUBMITTING', note?: string) => void; humanCheck?: boolean }) {
  const calls: string[] = [];
  const booker = {
    calls, ready: false,
    async prepare() { calls.push('prepare'); await new Promise(r => setTimeout(r, script.delayMs ?? 5)); booker.ready = true; return script.prepare ?? { status: 'READY', code: 'READY', message: 'ok', policy: 'Please cancel 2 hours ahead.', values: { firstName: 'Test' }, holdSeconds: 300 }; },
    async confirm() {
      calls.push('confirm');
      if (script.humanCheck) { script.onStep?.('SUBMITTING', 'human verification needed'); await new Promise(r => setTimeout(r, 30)); script.onStep?.('SUBMITTING', 'verification passed, submitting'); }
      booker.ready = false; return script.confirm ?? { status: 'CONFIRMED', code: 'CONFIRMED', message: 'done', reference: 'REF123' };
    },
    async close() { calls.push('close'); booker.ready = false; },
  };
  return booker as unknown as SevenRoomsBooker & { calls: string[] };
}
async function harness(booker: JobsOptions['booker'], jobsOptions: Partial<JobsOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pearl-app-'));
  const ledger = new BookingLedger(join(dir, 'bookings.json'));
  const jobs = new BookingJobs({ booker, ledger, ...jobsOptions });
  const app = createApp({ useCodex: false, availability: new AvailabilityService(), jobs, ledger, profiles: new ProfileStore(join(dir, 'profile.json')) });
  return { app, jobs, ledger, cleanup: async () => { await jobs.close(); await rm(dir, { recursive: true, force: true }); } };
}
const body = JSON.stringify({ venue: 'miriamwestvillage', date: '2026-10-02', time: '19:00', partySize: 2, contact: { firstName: 'Test', lastName: 'Diner', email: 'diner@example.org', phone: '2125550100' } });
const post = (app: ReturnType<typeof createApp>, path: string, payload?: string) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const jobOf = async (app: ReturnType<typeof createApp>, id: string) => (await (await app.request(`/api/book/${id}`)).json() as { job: { state: string; prepared?: { policy: string; holdExpiresAt: string }; result?: { code: string; reference?: string; hasEvidence?: boolean } } }).job;

describe('booking API', () => {
  it('prepares, waits for confirmation, submits exactly once, and records the booking', async () => {
    const booker = fakeBooker({});
    const h = await harness(() => booker);
    try {
      const started = await post(h.app, '/api/book', body); expect(started.status).toBe(202);
      expect(started.headers.get('x-request-id')).toBeTruthy();
      const { job } = await started.json() as { job: { id: string; state: string } };
      expect(job.state).toBe('PREPARING');
      await wait(30);
      let current = await jobOf(h.app, job.id);
      expect(current.state).toBe('READY'); expect(current.prepared?.policy).toMatch(/2 hours/); expect(Date.parse(current.prepared!.holdExpiresAt)).toBeGreaterThan(Date.now());
      expect(booker.calls).toEqual(['prepare']);
      expect((await post(h.app, `/api/book/${job.id}/confirm`)).status).toBe(202);
      await wait(30);
      current = await jobOf(h.app, job.id);
      expect(current.state).toBe('CONFIRMED'); expect(current.result?.reference).toBe('REF123'); expect(current.result?.hasEvidence).toBe(false);
      expect(booker.calls).toEqual(['prepare', 'confirm', 'close']);
      expect((await post(h.app, `/api/book/${job.id}/confirm`)).status).toBe(409);
      const bookings = (await (await h.app.request('/api/bookings')).json() as { bookings: { reference: string; venueName: string }[] }).bookings;
      expect(bookings).toHaveLength(1); expect(bookings[0]).toMatchObject({ reference: 'REF123', venueName: 'Miriam West Village' });
      expect((await h.app.request(`/api/book/${job.id}/evidence.png`)).status).toBe(404);
    } finally { await h.cleanup(); }
  });
  it('cancel releases the hold and a new pick replaces a pending one', async () => {
    const first = fakeBooker({}); const second = fakeBooker({}); let n = 0;
    const h = await harness(() => (n++ === 0 ? first : second));
    try {
      const { job: a } = await (await post(h.app, '/api/book', body)).json() as { job: { id: string } };
      await wait(30);
      const { job: b } = await (await post(h.app, '/api/book', body)).json() as { job: { id: string } };
      expect((await jobOf(h.app, a.id)).state).toBe('CANCELLED');
      expect(first.calls).toEqual(['prepare', 'close']);
      await wait(30);
      expect((await h.app.request(`/api/book/${b.id}`, { method: 'DELETE' })).status).toBe(200);
      expect(second.calls).toEqual(['prepare', 'close']);
      expect((await post(h.app, `/api/book/${b.id}/confirm`)).status).toBe(409);
    } finally { await h.cleanup(); }
  });
  it('fails the job with a page screenshot when the widget rejects it, and never confirms', async () => {
    const booker = fakeBooker({ prepare: { status: 'FAILED', code: 'NO_CHECKOUT', message: 'no checkout', screenshot: Buffer.from('png-bytes') } });
    const h = await harness(() => booker);
    try {
      const { job } = await (await post(h.app, '/api/book', body)).json() as { job: { id: string } };
      await wait(30);
      const current = await jobOf(h.app, job.id);
      expect(current.state).toBe('FAILED'); expect(current.result?.code).toBe('NO_CHECKOUT'); expect(current.result?.hasEvidence).toBe(true);
      const image = await h.app.request(`/api/book/${job.id}/evidence.png`);
      expect(image.status).toBe(200); expect(image.headers.get('content-type')).toBe('image/png'); expect(Buffer.from(await image.arrayBuffer()).toString()).toBe('png-bytes');
      expect((await post(h.app, `/api/book/${job.id}/confirm`)).status).toBe(409);
      expect((await (await h.app.request('/api/bookings')).json() as { bookings: unknown[] }).bookings).toEqual([]);
    } finally { await h.cleanup(); }
  });
  it('does not keep a screenshot for a fee stop — the quoted policy is the evidence', async () => {
    const booker = fakeBooker({ prepare: { status: 'FAILED', code: 'CANCELLATION_FEE', message: 'fee: $50 per person on the card on file', policy: '$50 per person will be charged to the card on file', screenshot: Buffer.from('masked-form') } });
    const h = await harness(() => booker);
    try {
      const { job } = await (await post(h.app, '/api/book', body)).json() as { job: { id: string } };
      await wait(30);
      const current = await jobOf(h.app, job.id);
      expect(current.state).toBe('FAILED'); expect(current.result?.code).toBe('CANCELLATION_FEE'); expect(current.result?.hasEvidence).toBe(false);
      expect((await h.app.request(`/api/book/${job.id}/evidence.png`)).status).toBe(404);
    } finally { await h.cleanup(); }
  });
  it('expires a hold that is not confirmed in time, and sweeps finished jobs after retention', async () => {
    const booker = fakeBooker({ prepare: { status: 'READY', code: 'READY', message: 'ok', holdSeconds: 1 } });
    const h = await harness(() => booker, { holdMarginMs: 0, minHoldMs: 0, retentionMs: 50 });
    try {
      const { job } = await (await post(h.app, '/api/book', body)).json() as { job: { id: string } };
      await wait(30);
      expect((await jobOf(h.app, job.id)).state).toBe('READY');
      await wait(1_200);
      expect(await jobOf(h.app, job.id)).toMatchObject({ state: 'EXPIRED', result: { code: 'HOLD_EXPIRED' } });
      expect(booker.calls).toEqual(['prepare', 'close']);
      await wait(60); h.jobs.sweep();
      expect((await h.app.request(`/api/book/${job.id}`)).status).toBe(404);
    } finally { await h.cleanup(); }
  });
  it('exposes the human-verification window while the checkbox is waiting', async () => {
    const script: Parameters<typeof fakeBooker>[0] = { humanCheck: true };
    const h = await harness(onStep => { script.onStep = onStep as typeof script.onStep; return fakeBooker(script); }, { humanSolveMs: 90_000 });
    try {
      const { job } = await (await post(h.app, '/api/book', body)).json() as { job: { id: string } };
      await wait(30);
      await post(h.app, `/api/book/${job.id}/confirm`);
      await wait(10);
      const waiting = (await (await h.app.request(`/api/book/${job.id}`)).json() as { job: { state: string; verification?: { expiresAt: string; passedAt?: string } } }).job;
      expect(waiting.state).toBe('SUBMITTING'); expect(waiting.verification?.passedAt).toBeUndefined(); expect(Date.parse(waiting.verification!.expiresAt) - Date.now()).toBeGreaterThan(80_000);
      await wait(50);
      const done = (await (await h.app.request(`/api/book/${job.id}`)).json() as { job: { state: string; verification?: { passedAt?: string } } }).job;
      expect(done.state).toBe('CONFIRMED'); expect(done.verification?.passedAt).toBeTruthy();
    } finally { await h.cleanup(); }
  });
  it('answers bad input, unknown routes and oversized bodies with JSON errors', async () => {
    const h = await harness(() => fakeBooker({}));
    try {
      expect((await post(h.app, '/api/book', '{"nope":1}')).status).toBe(400);
      const missing = await h.app.request('/api/nothing'); expect(missing.status).toBe(404); expect((await missing.json() as { error: string }).error).toBe('NOT_FOUND');
      expect((await post(h.app, '/api/chat', JSON.stringify({ messages: [{ role: 'user', text: 'x'.repeat(70_000) }], intent: {} }))).status).toBe(413);
      const health = await (await h.app.request('/api/health')).json() as { ok: boolean; jobs: { total: number } };
      expect(health.ok).toBe(true); expect(health.jobs.total).toBe(0);
    } finally { await h.cleanup(); }
  });
});

describe('exact-time picks', () => {
  const slot = (time: string, type: 'book' | 'request' = 'book'): Slot => ({ venue: 'v', time, label: time, timeIso: `2026-10-02 ${time}:00`, area: '', type, accessId: 'a', shiftId: 's', shiftName: '' });
  it('recommends the slot nearest the window midpoint when no exact time is named', () => {
    const slots = [slot('19:00'), slot('19:30'), slot('20:00'), slot('20:30'), slot('21:00')];
    expect(pickFor(slots, { timeFrom: '19:00', timeTo: '21:00' })?.time).toBe('20:00');
    expect(pickFor(slots, { exactTime: '19:00', timeFrom: '18:30', timeTo: '20:30' })?.time).toBe('19:00');
    expect(pickFor([slot('19:00', 'request')], { timeFrom: '19:00', timeTo: '21:00' })).toBeUndefined();
  });
  it('chooses the closest bookable slot, later on a tie, ignoring request-only', () => {
    expect(closestSlot([slot('18:30'), slot('19:00', 'request'), slot('19:15'), slot('19:30')], '19:00')?.time).toBe('19:15');
    expect(closestSlot([slot('18:45'), slot('19:15')], '19:00')?.time).toBe('19:15');
    expect(closestSlot([slot('19:00')], '19:00')?.time).toBe('19:00');
    expect(closestSlot([slot('19:00', 'request')], '19:00')).toBeUndefined();
  });
  it('is honest when only request-only tables exist', () => {
    const venue = { slug: 'benusf', name: 'Benu', city: 'San Francisco', neighborhood: 'SoMa', timezone: 'America/Los_Angeles', address: '', cuisine: '' };
    const reqOnly = [{ venue, slots: [slot('19:00', 'request'), slot('19:30', 'request')] }];
    const windowText = summarize(reqOnly, { date: '2026-10-03', partySize: 2, neighborhood: 'SoMa', timeFrom: '19:00', timeTo: '21:00' });
    expect(windowText).toMatch(/No tables I can book instantly/); expect(windowText).toMatch(/requests only/); expect(windowText).not.toMatch(/Found 0/); expect(windowText).not.toMatch(/Tap a time/);
    const exactText = summarize(reqOnly, { date: '2026-10-03', partySize: 2, neighborhood: 'SoMa', exactTime: '20:00', timeFrom: '19:30', timeTo: '21:30' });
    expect(exactText).toMatch(/No table I can book instantly/); expect(exactText).not.toMatch(/Pick a restaurant/);
    expect(summarize([{ venue, slots: [] }], { date: '2026-10-03', partySize: 2, neighborhood: 'SoMa', timeFrom: '19:00', timeTo: '21:00' })).toMatch(/No open tables/);
  });
  it('names nearby restaurants in the same city when the area is dry', () => {
    const somaVenue = { slug: 'benusf', name: 'Benu', city: 'San Francisco', neighborhood: 'SoMa', timezone: 'America/Los_Angeles', address: '', cuisine: '' };
    const nearbyVenue = { slug: 'bourbonsteaksanfrancisco', name: 'Bourbon Steak', city: 'San Francisco', neighborhood: 'Union Square', timezone: 'America/Los_Angeles', address: '', cuisine: '' };
    const text = summarize([{ venue: somaVenue, slots: [slot('19:00', 'request')] }], { date: '2026-10-03', partySize: 2, neighborhood: 'SoMa', timeFrom: '19:00', timeTo: '21:00' }, [{ venue: nearbyVenue, slots: [slot('20:00')] }]);
    expect(text).toMatch(/Nearby in San Francisco/); expect(text).toMatch(/Bourbon Steak \(Union Square, 20:00\)/); expect(text).toMatch(/tap one below/);
  });
  it('summarises picks per restaurant', () => {
    const venue = { slug: 'x', name: 'X', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '', cuisine: '' };
    const text = summarize([{ venue, slots: [slot('19:15')], pick: slot('19:15') }, { venue: { ...venue, slug: 'y' }, slots: [slot('19:00')], pick: slot('19:00') }], { exactTime: '19:00', date: '2026-10-02', partySize: 2, neighborhood: 'West Village', timeFrom: '18:30', timeTo: '20:30' });
    expect(text).toMatch(/2 restaurants have a table/); expect(text).toMatch(/1 at exactly 7:00 PM/); expect(text).toMatch(/Pick a restaurant/);
  });
});
