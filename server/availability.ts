import { fetchAvailability, minutesOf, type AvailabilityQuery, type Slot } from './sevenrooms';
import { venuesFor, nearbyVenues, cityOf, type Venue } from './venues';
import { describeIntent, type Intent } from './chat';
import { log } from './logger';

/** `pick` is Pearl's choice when the diner named one time: the bookable slot closest to it. */
export type VenueAvailability = { venue: Venue; slots: Slot[]; pick?: Slot; error?: string };
export type SearchIntent = Required<Pick<Intent, 'date' | 'timeFrom' | 'timeTo' | 'partySize'>> & Intent;

/** Runs at most `limit` promises at once. Enough for a fan-out over a couple of dozen venues. */
export function limiter(limit: number) {
  let active = 0; const queue: (() => void)[] = [];
  const next = () => { active -= 1; queue.shift()?.(); };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>(resolve => queue.push(resolve));
    active += 1;
    try { return await task(); } finally { next(); }
  };
}

/**
 * Availability with a short cache and a concurrency cap. Repeated chat turns for the same window do not
 * re-hit SevenRooms, and a broad search cannot open dozens of connections at once.
 */
export class AvailabilityService {
  private cache = new Map<string, { at: number; value: Promise<Slot[]> }>();
  private run: <T>(task: () => Promise<T>) => Promise<T>;
  constructor(private options: { fetch?: typeof fetchAvailability; cacheMs?: number; concurrency?: number; timeoutMs?: number; now?: () => number } = {}) {
    this.run = limiter(options.concurrency ?? 6);
  }
  private now() { return this.options.now?.() ?? Date.now(); }

  async slots(query: AvailabilityQuery): Promise<Slot[]> {
    const key = JSON.stringify(query);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < (this.options.cacheMs ?? 20_000)) return hit.value;
    const value = this.run(() => (this.options.fetch ?? fetchAvailability)(query, { timeoutMs: this.options.timeoutMs }));
    this.cache.set(key, { at: this.now(), value });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 500) for (const [k, v] of this.cache) if (this.now() - v.at > (this.options.cacheMs ?? 20_000)) this.cache.delete(k);
    return value;
  }

  private async lookupVenues(venues: Venue[], intent: SearchIntent): Promise<VenueAvailability[]> {
    const results = await Promise.all(venues.map(async venue => {
      try {
        const slots = await this.slots({ venue: venue.slug, date: intent.date, partySize: intent.partySize, timeFrom: intent.timeFrom, timeTo: intent.timeTo });
        return { venue, slots, pick: pickFor(slots, intent) };
      } catch (error) {
        log('warn', 'availability_failed', { venue: venue.slug, message: error instanceof Error ? error.message : String(error) });
        return { venue, slots: [], error: 'lookup failed' } as VenueAvailability;
      }
    }));
    // Restaurants with instantly bookable times first, then request-only, then nothing.
    const rank = (entry: VenueAvailability) => entry.slots.some(s => s.type === 'book') ? 0 : entry.slots.length ? 1 : 2;
    return results.sort((a, b) => rank(a) - rank(b) || a.venue.name.localeCompare(b.venue.name));
  }

  async search(intent: SearchIntent): Promise<VenueAvailability[]> {
    const started = performance.now();
    const results = await this.lookupVenues(venuesFor(intent.neighborhood), intent);
    log('info', 'availability_search', { area: intent.neighborhood, venues: results.length, slots: results.reduce((n, r) => n + r.slots.length, 0), ms: Math.round(performance.now() - started) });
    return results;
  }

  /** Bookable tables in other neighborhoods of the same city. Used only when the asked-for area is dry. */
  async searchNearby(intent: SearchIntent): Promise<VenueAvailability[]> {
    const venues = nearbyVenues(intent.neighborhood);
    if (!venues.length) return [];
    const results = await this.lookupVenues(venues, intent);
    return results.filter(r => r.slots.some(s => s.type === 'book'));
  }
}

/** Closest bookable slot to the named time; a tie goes to the later one, since arriving early is easier than late. */
export function closestSlot(slots: Slot[], time: string): Slot | undefined {
  const target = minutesOf(time);
  return slots.filter(s => s.type === 'book').sort((a, b) => Math.abs(minutesOf(a.time) - target) - Math.abs(minutesOf(b.time) - target) || minutesOf(b.time) - minutesOf(a.time))[0];
}

/** Pearl's recommended one-tap time: closest to the named time, or to the middle of the window. */
export function pickFor(slots: Slot[], intent: Pick<Intent, 'exactTime' | 'timeFrom' | 'timeTo'>): Slot | undefined {
  if (intent.exactTime) return closestSlot(slots, intent.exactTime);
  if (intent.timeFrom && intent.timeTo) { const mid = Math.round((minutesOf(intent.timeFrom) + minutesOf(intent.timeTo)) / 2); return closestSlot(slots, `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`); }
  return slots.find(s => s.type === 'book');
}

const clock = (t: string) => t.replace(/^(\d\d):(\d\d)$/, (_, h, m) => `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? 'PM' : 'AM'}`);
const venueWord = (n: number) => (n === 1 ? 'restaurant' : 'restaurants');
const requestNote = (n: number) => `${n} ${venueWord(n)} nearby ${n === 1 ? 'takes' : 'take'} requests only — the restaurant confirms those by hand, so I can’t book them instantly.`;

const firstBookable = (r: VenueAvailability) => r.pick ?? r.slots.find(s => s.type === 'book');
function nearbyLine(nearby: VenueAvailability[], intent: Intent): string {
  if (!nearby.length) return '';
  const city = cityOf(intent.neighborhood) ?? nearby[0].venue.city;
  const named = nearby.slice(0, 3).map(r => { const s = firstBookable(r); return `${r.venue.name} (${r.venue.neighborhood}${s ? `, ${s.label}` : ''})`; });
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  return ` Nearby in ${city}, ${list} ${named.length === 1 ? 'has' : 'have'} tables — tap one below.`;
}

export function summarize(results: VenueAvailability[], intent: Intent, nearby: VenueAvailability[] = []) {
  const requestOnly = results.filter(r => r.slots.length && !r.slots.some(s => s.type === 'book')).length;
  const near = nearbyLine(nearby, intent);
  if (intent.exactTime) {
    const picks = results.filter(r => r.pick);
    const exact = picks.filter(r => r.pick!.time === intent.exactTime).length;
    if (!picks.length) return (requestOnly
      ? `No table I can book instantly ${describeIntent(intent)}. ${requestNote(requestOnly)}`
      : `No instant tables ${describeIntent(intent)}.`) + (near || ' Try another time or date.');
    return `${picks.length} ${picks.length === 1 ? 'restaurant has' : 'restaurants have'} a table ${describeIntent(intent)}${exact < picks.length ? `, ${exact} at exactly ${clock(intent.exactTime)}` : ''}. Pick a restaurant and I’ll book the closest time for you.`;
  }
  const bookable = results.flatMap(r => r.slots.filter(s => s.type === 'book'));
  const withTables = results.filter(r => r.slots.some(s => s.type === 'book')).length;
  if (!bookable.length) return (requestOnly
    ? `No tables I can book instantly ${describeIntent(intent)}. ${requestNote(requestOnly)}`
    : `No open tables ${describeIntent(intent)}.`) + (near || ' Try a different time window or date.');
  const parts = [`Found ${bookable.length} open ${bookable.length === 1 ? 'time' : 'times'} at ${withTables} ${venueWord(withTables)} ${describeIntent(intent)}.`];
  if (requestOnly) parts.push(`${requestOnly} more ${requestOnly === 1 ? 'takes' : 'take'} requests only.`);
  parts.push('Pick a restaurant and I’ll book my suggested time, or choose another.');
  return parts.join(' ');
}
