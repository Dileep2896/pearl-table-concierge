import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AvailabilityService, limiter } from '../server/availability';
import { CodexQueue, CodexUnavailable } from '../server/codex';
import { BookingLedger } from '../server/ledger';
import { loadConfig } from '../server/config';
import type { Slot } from '../server/sevenrooms';

const slot: Slot = { venue: 'v', time: '19:00', label: '7:00 PM', timeIso: '2026-10-02 19:00:00', area: '', type: 'book', accessId: 'a', shiftId: 's', shiftName: '' };
const query = { venue: 'dantewestvillage', date: '2026-10-02', partySize: 2, timeFrom: '19:00', timeTo: '21:00' };

describe('availability service', () => {
  it('serves repeats from cache within the TTL and refetches after it', async () => {
    let calls = 0; let clock = 1000;
    const service = new AvailabilityService({ fetch: async () => { calls += 1; return [slot]; }, cacheMs: 100, now: () => clock });
    expect(await service.slots(query)).toEqual([slot]); expect(await service.slots(query)).toEqual([slot]); expect(calls).toBe(1);
    clock += 200; await service.slots(query); expect(calls).toBe(2);
    await service.slots({ ...query, partySize: 4 }); expect(calls).toBe(3);
  });
  it('does not cache failures', async () => {
    let calls = 0;
    const service = new AvailabilityService({ fetch: async () => { calls += 1; if (calls === 1) throw new Error('boom'); return [slot]; } });
    await expect(service.slots(query)).rejects.toThrow('boom');
    expect(await service.slots(query)).toEqual([slot]); expect(calls).toBe(2);
  });
  it('caps concurrent fetches during a fan-out', async () => {
    let active = 0; let peak = 0;
    const service = new AvailabilityService({ concurrency: 2, fetch: async () => { active += 1; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active -= 1; return [slot]; } });
    const results = await service.search({ neighborhood: 'West Village', date: '2026-10-02', timeFrom: '19:00', timeTo: '21:00', partySize: 2 });
    expect(results.length).toBeGreaterThan(2); expect(peak).toBe(2);
  });
  it('limiter runs tasks in order under the cap', async () => {
    const run = limiter(1); const order: number[] = [];
    await Promise.all([1, 2, 3].map(n => run(async () => { await new Promise(r => setTimeout(r, 5)); order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('codex queue', () => {
  it('serialises calls, caches identical prompts, and rejects when overloaded', async () => {
    let active = 0; let peak = 0; let calls = 0;
    const queue = new CodexQueue({ maxQueued: 2, run: async prompt => { calls += 1; active += 1; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active -= 1; return { echo: prompt }; } });
    const [a, b] = await Promise.all([queue.run('one', {}), queue.run('two', {})]);
    expect(a).toEqual({ echo: 'one' }); expect(b).toEqual({ echo: 'two' }); expect(peak).toBe(1);
    expect(await queue.run('one', {})).toEqual({ echo: 'one' }); expect(calls).toBe(2);
    const burst = [queue.run('three', {}), queue.run('four', {}), queue.run('five', {})];
    await expect(burst[2]).rejects.toBeInstanceOf(CodexUnavailable);
    await Promise.all(burst.slice(0, 2));
  });
  it('does not cache a failed call', async () => {
    let calls = 0;
    const queue = new CodexQueue({ run: async () => { calls += 1; if (calls === 1) throw new CodexUnavailable('down'); return { ok: true }; } });
    await expect(queue.run('p', {})).rejects.toThrow('down');
    expect(await queue.run('p', {})).toEqual({ ok: true }); expect(calls).toBe(2);
  });
});

describe('ledger and config', () => {
  it('appends newest first and survives concurrent appends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pearl-ledger-'));
    try {
      const ledger = new BookingLedger(join(dir, 'nested', 'bookings.json'));
      expect(await ledger.list()).toEqual([]);
      const entry = (id: string) => ({ id, confirmedAt: '2026-10-02T19:00:00.000Z', venue: 'v', venueName: 'V', city: 'New York', date: '2026-10-02', time: '19:00', partySize: 2, reference: id.toUpperCase() });
      await Promise.all([ledger.append(entry('a')), ledger.append(entry('b')), ledger.append(entry('c'))]);
      expect((await ledger.list()).map(e => e.id)).toEqual(['c', 'b', 'a']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('reads config from the environment with safe defaults', () => {
    const config = loadConfig({ PEARL_DEMO_API_PORT: '9000', PEARL_DEMO_AI: 'off', PEARL_AVAILABILITY_CACHE_MS: 'nonsense', PEARL_ALLOW_FEE_VENUES: '1' });
    expect(config.apiPort).toBe(9000); expect(config.useCodex).toBe(false); expect(config.availabilityCacheMs).toBe(20_000); expect(config.requireFreeCancellation).toBe(false);
    expect(loadConfig({}).host).toBe('127.0.0.1');
  });
});
