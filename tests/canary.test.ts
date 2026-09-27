import { describe, expect, it } from 'vitest';
import { Canary } from '../server/canary';
import type { AvailabilityService } from '../server/availability';
import type { Slot } from '../server/sevenrooms';
import type { Venue } from '../server/venues';

const venues: Venue[] = [
  { slug: 'aok', name: 'A', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '', cuisine: '' },
  { slug: 'bad', name: 'B', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '', cuisine: '' },
];

describe('canary', () => {
  it('marks a venue degraded when its availability fetch throws, healthy otherwise', async () => {
    const availability: Pick<AvailabilityService, 'slots'> = {
      slots: async query => { if (query.venue === 'bad') throw new Error('502 from the widget'); return [{ time: '19:00' }] as unknown as Slot[]; },
    };
    const canary = new Canary({ availability, venues, intervalMs: 0 });
    const status = await canary.runOnce();
    expect(status.checked).toBe(2);
    expect(status.degraded).toEqual(['bad']);
    expect(status.venues.find(v => v.slug === 'aok')).toMatchObject({ ok: true, slots: 1 });
    expect(status.venues.find(v => v.slug === 'bad')?.ok).toBe(false);
    expect(status.venues.find(v => v.slug === 'bad')?.error).toMatch(/502/);
    expect(status.lastRunAt).toBeDefined();
  });
});
