import { describe, expect, it } from 'vitest';
import { availabilityUrl, fetchAvailability, parseAvailability, searchPageUrl, timeLabel, toSevenRoomsDate, withinWindow } from '../server/sevenrooms';

const sample = { status: 200, data: { availability: { '2026-10-02': [
  { name: 'Dinner', shift_persistent_id: 'shift-1', is_closed: false, times: [
    { type: 'book', sort_order: 1, time: '6:45 PM', time_iso: '2026-10-02 18:45:00', access_persistent_id: 'a1', shift_persistent_id: 'shift-1', public_time_slot_description: 'Indoor Dining', duration: 120 },
    { type: 'book', sort_order: 2, time: '7:00 PM', time_iso: '2026-10-02 19:00:00', access_persistent_id: 'a2', shift_persistent_id: 'shift-1', public_time_slot_description: 'Indoor Dining', duration: 120 },
    { type: 'request', sort_order: 3, time: '7:00 PM', time_iso: '2026-10-02 19:00:00', access_persistent_id: null, is_requestable: true },
    { type: 'request', sort_order: 4, time: '8:30 PM', time_iso: '2026-10-02 20:30:00', access_persistent_id: null, is_requestable: true },
    { type: 'book', sort_order: 5, time: '9:15 PM', time_iso: '2026-10-02 21:15:00', access_persistent_id: 'a5', shift_persistent_id: 'shift-1', public_time_slot_description: 'Patio' },
  ] },
  { name: 'Closed shift', shift_persistent_id: 'shift-2', is_closed: true, times: [{ type: 'book', sort_order: 9, time: '8:00 PM', time_iso: '2026-10-02 20:00:00', access_persistent_id: 'x' }] },
] } } };

describe('sevenrooms availability', () => {
  it('formats dates and labels the way the widget does', () => {
    expect(toSevenRoomsDate('2026-10-02')).toBe('10-02-2026');
    expect(timeLabel('19:00')).toBe('7:00 PM'); expect(timeLabel('12:15')).toBe('12:15 PM'); expect(timeLabel('00:30')).toBe('12:30 AM');
  });
  it('flattens shifts, prefers bookable over request-only and skips closed shifts', () => {
    const slots = parseAvailability(sample, '2026-10-02', 'dantewestvillage');
    expect(slots.map(s => `${s.time}:${s.type}`)).toEqual(['18:45:book', '19:00:book', '20:30:request', '21:15:book']);
    expect(slots[1]).toMatchObject({ label: '7:00 PM', area: 'Indoor Dining', accessId: 'a2', shiftId: 'shift-1', venue: 'dantewestvillage' });
  });
  it('filters to the requested window inclusively', () => {
    const slots = parseAvailability(sample, '2026-10-02', 'v').filter(s => withinWindow(s, '19:00', '21:00'));
    expect(slots.map(s => s.time)).toEqual(['19:00', '20:30']);
  });
  it('throws on an invalid venue response', () => {
    expect(() => parseAvailability({ code: 400, status: 400, msg: 'no venue provided' }, '2026-10-02', 'nope')).toThrow(/no venue provided/);
  });
  it('builds the public widget URLs', () => {
    const url = new URL(availabilityUrl({ venue: 'dantewestvillage', date: '2026-10-02', partySize: 2, timeFrom: '19:00', timeTo: '21:00' }));
    expect(url.pathname).toBe('/api-yoa/availability/widget/range');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ venue: 'dantewestvillage', time_slot: '20:00', party_size: '2', start_date: '10-02-2026', num_days: '1', channel: 'SEVENROOMS_WIDGET' });
    expect(searchPageUrl('dantewestvillage', '2026-10-02', 2, '19:00')).toBe('https://www.sevenrooms.com/explore/dantewestvillage/reservations/create/search?date=2026-10-02&party_size=2&time=19%3A00');
  });
  it('fetches with a browser user agent and applies the window', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => { calls.push(String(url)); expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/Mozilla/); return new Response(JSON.stringify(sample), { status: 200 }); }) as typeof fetch;
    const slots = await fetchAvailability({ venue: 'dantewestvillage', date: '2026-10-02', partySize: 2, timeFrom: '19:00', timeTo: '21:00' }, { fetch: fetchImpl });
    expect(calls).toHaveLength(1); expect(slots.map(s => s.time)).toEqual(['19:00', '20:30']);
  });
});
