import type { AvailabilityService } from './availability';
import { venues as allVenues, type Venue } from './venues';
import { log } from './logger';

export type VenueHealth = { slug: string; name: string; city: string; ok: boolean; slots: number; error?: string; checkedAt: string };
export type CanaryStatus = { lastRunAt?: string; checked: number; degraded: string[]; venues: VenueHealth[] };

/**
 * Knowing before a diner does: on an interval, hit each venue's availability endpoint for a near-future evening.
 * A fetch that throws or parses wrong marks that venue degraded, so SevenRooms drift shows up in `/api/canary`
 * (and the degraded count in `/api/health`) within the interval, not when a diner hits it.
 */
export class Canary {
  private results = new Map<string, VenueHealth>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunAt?: string;
  constructor(private options: { availability: Pick<AvailabilityService, 'slots'>; venues?: Venue[]; intervalMs: number; now?: () => Date }) {}

  private venues() { return this.options.venues ?? allVenues; }
  private now() { return this.options.now?.() ?? new Date(); }

  status(): CanaryStatus {
    const venues = [...this.results.values()];
    return { lastRunAt: this.lastRunAt, checked: venues.length, degraded: venues.filter(v => !v.ok).map(v => v.slug), venues };
  }

  start() {
    if (this.options.intervalMs <= 0) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  /** One sweep across every venue; safe to call on demand. Skips if a sweep is already in flight. */
  async runOnce(): Promise<CanaryStatus> {
    if (this.running) return this.status();
    this.running = true;
    const started = performance.now();
    const date = ymd(new Date(this.now().getTime() + 86_400_000)); // tomorrow, when a shift almost always exists
    try {
      await Promise.all(this.venues().map(venue => this.check(venue, date)));
      this.lastRunAt = this.now().toISOString();
      const degraded = [...this.results.values()].filter(v => !v.ok).length;
      log('info', 'canary_run', { venues: this.venues().length, degraded, ms: Math.round(performance.now() - started) });
    } finally { this.running = false; }
    return this.status();
  }

  private async check(venue: Venue, date: string) {
    const checkedAt = this.now().toISOString();
    try {
      const slots = await this.options.availability.slots({ venue: venue.slug, date, partySize: 2, timeFrom: '18:00', timeTo: '21:00' });
      this.results.set(venue.slug, { slug: venue.slug, name: venue.name, city: venue.city, ok: true, slots: slots.length, checkedAt });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 140);
      log('warn', 'canary_degraded', { venue: venue.slug, message });
      this.results.set(venue.slug, { slug: venue.slug, name: venue.name, city: venue.city, ok: false, slots: 0, error: message, checkedAt });
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
