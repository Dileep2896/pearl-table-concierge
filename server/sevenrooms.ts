import { z } from 'zod/v4';

export const SEVENROOMS_BASE = 'https://www.sevenrooms.com';
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM');

export type Slot = {
  venue: string;
  time: string;        // HH:MM, restaurant-local
  label: string;       // e.g. "7:00 PM", as the widget shows it
  timeIso: string;     // "2026-10-02 19:00:00"
  area: string;        // seating description, e.g. "Indoor Dining"
  type: 'book' | 'request';
  accessId: string | null;
  shiftId: string;
  shiftName: string;
  durationMinutes?: number;
};

/** SevenRooms wants MM-DD-YYYY. */
export function toSevenRoomsDate(date: string) { const [y, m, d] = dateSchema.parse(date).split('-'); return `${m}-${d}-${y}`; }
export function minutesOf(time: string) { const [h, m] = timeSchema.parse(time).split(':').map(Number); return h * 60 + m; }
export function timeLabel(time: string) { const [hour, minute] = timeSchema.parse(time).split(':').map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`; }
export function isoToTime(timeIso: string) { const match = timeIso.match(/(\d{2}):(\d{2})/); if (!match) throw new Error(`Bad time_iso: ${timeIso}`); return `${match[1]}:${match[2]}`; }

const timeEntry = z.object({
  type: z.string(), time: z.string(), time_iso: z.string(),
  access_persistent_id: z.string().nullable().optional(), shift_persistent_id: z.string().optional(),
  public_time_slot_description: z.string().nullable().optional(), duration: z.number().optional(),
}).loose();
const shiftEntry = z.object({ name: z.string().optional(), shift_persistent_id: z.string(), is_closed: z.boolean().optional(), times: z.array(timeEntry).optional() }).loose();
const rangeResponse = z.object({ status: z.number(), data: z.object({ availability: z.record(z.string(), z.array(shiftEntry)) }).optional(), msg: z.string().optional() }).loose();

/** Flattens the widget response into bookable and request-only slots for one date. */
export function parseAvailability(json: unknown, date: string, venue: string): Slot[] {
  const parsed = rangeResponse.parse(json);
  if (parsed.status !== 200 || !parsed.data) throw new Error(parsed.msg || `SevenRooms returned status ${parsed.status} for ${venue}`);
  const shifts = parsed.data.availability[date] ?? [];
  const slots: Slot[] = [];
  for (const shift of shifts) {
    if (shift.is_closed) continue;
    for (const entry of shift.times ?? []) {
      if (entry.type !== 'book' && entry.type !== 'request') continue;
      slots.push({
        venue, time: isoToTime(entry.time_iso), label: entry.time, timeIso: entry.time_iso,
        area: entry.public_time_slot_description || '', type: entry.type,
        accessId: entry.access_persistent_id ?? null, shiftId: entry.shift_persistent_id ?? shift.shift_persistent_id,
        shiftName: shift.name ?? '', durationMinutes: entry.duration,
      });
    }
  }
  // One entry per clock time: prefer bookable over request-only, keep the widget's order.
  const seen = new Map<string, Slot>();
  for (const slot of slots) { const current = seen.get(slot.time); if (!current || (current.type === 'request' && slot.type === 'book')) seen.set(slot.time, slot); }
  return [...seen.values()].sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

export function withinWindow(slot: Pick<Slot, 'time'>, from: string, to: string) { const m = minutesOf(slot.time); return m >= minutesOf(from) && m <= minutesOf(to); }

export type AvailabilityQuery = { venue: string; date: string; partySize: number; timeFrom: string; timeTo: string };

export function availabilityUrl(query: AvailabilityQuery, base = SEVENROOMS_BASE) {
  const mid = Math.round((minutesOf(query.timeFrom) + minutesOf(query.timeTo)) / 2 / 15) * 15;
  const slot = `${String(Math.floor(mid / 60) % 24).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
  const url = new URL('/api-yoa/availability/widget/range', base);
  url.search = new URLSearchParams({ venue: query.venue, time_slot: slot, party_size: String(query.partySize), halo_size_interval: '16', start_date: toSevenRoomsDate(query.date), num_days: '1', channel: 'SEVENROOMS_WIDGET' }).toString();
  return url.toString();
}

/** Public widget endpoint: no key, no login. Read-only. */
export async function fetchAvailability(query: AvailabilityQuery, options: { fetch?: typeof fetch; base?: string; timeoutMs?: number } = {}): Promise<Slot[]> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(availabilityUrl(query, options.base), { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs ?? 15000) });
  if (!response.ok) throw new Error(`SevenRooms availability HTTP ${response.status} for ${query.venue}`);
  return parseAvailability(await response.json(), query.date, query.venue).filter(slot => withinWindow(slot, query.timeFrom, query.timeTo));
}

/** The guest-facing widget URL that the booking browser opens. */
export function searchPageUrl(venue: string, date: string, partySize: number, time: string, base = SEVENROOMS_BASE) {
  const url = new URL(`/explore/${venue}/reservations/create/search`, base);
  url.search = new URLSearchParams({ date: dateSchema.parse(date), party_size: String(partySize), time: timeSchema.parse(time) }).toString();
  return url.toString();
}
