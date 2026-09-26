import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore, isComplete } from '../server/profile';
import { createApp } from '../server/app';
import { AvailabilityService } from '../server/availability';
import { BookingJobs } from '../server/jobs';
import type { SevenRoomsBooker } from '../server/booking-browser';

const dirs: string[] = [];
async function tempStore() { const dir = await mkdtemp(join(tmpdir(), 'tavola-profile-')); dirs.push(dir); return new ProfileStore(join(dir, 'nested', 'profile.json')); }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('profile store', () => {
  it('returns an empty profile when nothing is saved, then round-trips', async () => {
    const store = await tempStore();
    expect(await store.read()).toEqual({ firstName: '', lastName: '', email: '', phone: '' });
    const saved = await store.write({ firstName: ' Dileep Kumar ', lastName: 'Sharma', email: 'diner@example.org', phone: '585 910 7897' });
    expect(saved.firstName).toBe('Dileep Kumar');
    expect(await store.read()).toEqual(saved);
    expect(JSON.parse(await readFile((store as unknown as { path: string }).path, 'utf8'))).toEqual(saved);
  });
  it('knows when a profile is complete enough to book', () => {
    expect(isComplete({ firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '2125550100' })).toBe(true);
    expect(isComplete({ firstName: 'A', lastName: '', email: 'a@b.co', phone: '2125550100' })).toBe(false);
    expect(isComplete({ firstName: 'A', lastName: 'B', email: 'nope', phone: '2125550100' })).toBe(false);
    expect(isComplete({ firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '12345' })).toBe(false);
  });
  it('serves and updates the profile over the API', async () => {
    const app = createApp({ useCodex: false, profiles: await tempStore(), availability: new AvailabilityService(), jobs: new BookingJobs({ booker: () => ({} as SevenRoomsBooker) }) });
    expect(await (await app.request('/api/profile')).json()).toEqual({ profile: { firstName: '', lastName: '', email: '', phone: '' }, complete: false });
    const put = await app.request('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Test', lastName: 'Diner', email: 'diner@example.org', phone: '2125550100' }) });
    expect(put.status).toBe(200); expect((await put.json()).complete).toBe(true);
    expect((await (await app.request('/api/profile')).json()).profile.firstName).toBe('Test');
    expect((await app.request('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'x'.repeat(80) }) })).status).toBe(400);
  });
});
