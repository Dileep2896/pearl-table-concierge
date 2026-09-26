import { describe, expect, it } from 'vitest';
import { createApp, closestSlot, summarize } from '../server/app';
import type { Slot } from '../server/sevenrooms';
import type { SevenRoomsBooker, PrepareResult, BookingResult } from '../server/booking-browser';

/** A booker double that reports steps and resolves when the test says so. */
function fakeBooker(script: { prepare?: PrepareResult; confirm?: BookingResult; delayMs?: number }) {
  const calls: string[] = [];
  const booker = {
    calls, ready: false,
    async prepare() { calls.push('prepare'); await new Promise(r => setTimeout(r, script.delayMs ?? 5)); booker.ready = true; return script.prepare ?? { status: 'READY', code: 'READY', message: 'ok', policy: 'Please cancel 2 hours ahead.', values: { firstName: 'Test' }, holdSeconds: 300 }; },
    async confirm() { calls.push('confirm'); booker.ready = false; return script.confirm ?? { status: 'CONFIRMED', code: 'CONFIRMED', message: 'done', reference: 'REF123' }; },
    async close() { calls.push('close'); booker.ready = false; },
  };
  return booker as unknown as SevenRoomsBooker & { calls: string[] };
}
const body = JSON.stringify({ venue: 'miriamwestvillage', date: '2026-10-02', time: '19:00', partySize: 2, contact: { firstName: 'Test', lastName: 'Diner', email: 'diner@example.org', phone: '2125550100' } });
const post = (app: ReturnType<typeof createApp>, path: string, payload?: string) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('booking API', () => {
  it('prepares, waits for confirmation, then submits exactly once', async () => {
    const booker = fakeBooker({});
    const app = createApp({ useCodex: false, booker: () => booker });
    const started = await post(app, '/api/book', body); expect(started.status).toBe(202);
    const { job } = await started.json() as { job: { id: string; state: string } };
    expect(job.state).toBe('PREPARING');
    await wait(30);
    let current = (await (await app.request(`/api/book/${job.id}`)).json() as { job: { state: string; prepared?: { policy: string; holdExpiresAt: string } } }).job;
    expect(current.state).toBe('READY'); expect(current.prepared?.policy).toMatch(/2 hours/); expect(Date.parse(current.prepared!.holdExpiresAt)).toBeGreaterThan(Date.now());
    expect(booker.calls).toEqual(['prepare']);
    const confirmed = await post(app, `/api/book/${job.id}/confirm`); expect(confirmed.status).toBe(202);
    await wait(30);
    current = (await (await app.request(`/api/book/${job.id}`)).json() as { job: { state: string; result?: { reference?: string } } }).job as typeof current;
    expect(current.state).toBe('CONFIRMED'); expect((current as { result?: { reference?: string } }).result?.reference).toBe('REF123');
    expect(booker.calls).toEqual(['prepare', 'confirm', 'close']);
    expect((await post(app, `/api/book/${job.id}/confirm`)).status).toBe(409);
  });
  it('cancel releases the hold and a new pick replaces a pending one', async () => {
    const first = fakeBooker({}); const second = fakeBooker({}); let n = 0;
    const app = createApp({ useCodex: false, booker: () => (n++ === 0 ? first : second) });
    const { job: a } = await (await post(app, '/api/book', body)).json() as { job: { id: string } };
    await wait(30);
    const { job: b } = await (await post(app, '/api/book', body)).json() as { job: { id: string } };
    expect((await (await app.request(`/api/book/${a.id}`)).json() as { job: { state: string } }).job.state).toBe('CANCELLED');
    expect(first.calls).toEqual(['prepare', 'close']);
    await wait(30);
    const cancelled = await app.request(`/api/book/${b.id}`, { method: 'DELETE' }); expect(cancelled.status).toBe(200);
    expect(second.calls).toEqual(['prepare', 'close']);
    expect((await post(app, `/api/book/${b.id}/confirm`)).status).toBe(409);
  });
  it('fails the job when preparation reports a problem and never confirms', async () => {
    const booker = fakeBooker({ prepare: { status: 'FAILED', code: 'CANCELLATION_FEE', message: 'fee' } });
    const app = createApp({ useCodex: false, booker: () => booker });
    const { job } = await (await post(app, '/api/book', body)).json() as { job: { id: string } };
    await wait(30);
    const current = (await (await app.request(`/api/book/${job.id}`)).json() as { job: { state: string; result?: { code: string } } }).job;
    expect(current.state).toBe('FAILED'); expect(current.result?.code).toBe('CANCELLATION_FEE');
    expect((await post(app, `/api/book/${job.id}/confirm`)).status).toBe(409);
  });
  it('expires a hold that is not confirmed in time', async () => {
    const booker = fakeBooker({ prepare: { status: 'READY', code: 'READY', message: 'ok', holdSeconds: 1 } });
    const app = createApp({ useCodex: false, booker: () => booker, holdMarginMs: 0, minHoldMs: 0 });
    const { job } = await (await post(app, '/api/book', body)).json() as { job: { id: string } };
    await wait(30);
    expect((await (await app.request(`/api/book/${job.id}`)).json() as { job: { state: string } }).job.state).toBe('READY');
    await wait(1_200);
    expect((await (await app.request(`/api/book/${job.id}`)).json() as { job: { state: string; result?: { code: string } } }).job).toMatchObject({ state: 'EXPIRED', result: { code: 'HOLD_EXPIRED' } });
    expect(booker.calls).toEqual(['prepare', 'close']);
  });
});

describe('exact-time picks', () => {
  const slot = (time: string, type: 'book' | 'request' = 'book'): Slot => ({ venue: 'v', time, label: time, timeIso: `2026-10-02 ${time}:00`, area: '', type, accessId: 'a', shiftId: 's', shiftName: '' });
  it('chooses the closest bookable slot, later on a tie, ignoring request-only', () => {
    expect(closestSlot([slot('18:30'), slot('19:00', 'request'), slot('19:15'), slot('19:30')], '19:00')?.time).toBe('19:15');
    expect(closestSlot([slot('18:45'), slot('19:15')], '19:00')?.time).toBe('19:15');
    expect(closestSlot([slot('19:00')], '19:00')?.time).toBe('19:00');
    expect(closestSlot([slot('19:00', 'request')], '19:00')).toBeUndefined();
  });
  it('summarises picks per restaurant', () => {
    const venue = { slug: 'x', name: 'X', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '', cuisine: '' };
    const text = summarize([{ venue, slots: [slot('19:15')], pick: slot('19:15') }, { venue: { ...venue, slug: 'y' }, slots: [slot('19:00')], pick: slot('19:00') }], { exactTime: '19:00', date: '2026-10-02', partySize: 2, neighborhood: 'West Village', timeFrom: '18:30', timeTo: '20:30' });
    expect(text).toMatch(/2 restaurants have a table/); expect(text).toMatch(/1 at exactly 7:00 PM/); expect(text).toMatch(/Pick a restaurant/);
  });
});
