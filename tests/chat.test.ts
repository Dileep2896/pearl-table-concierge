import { describe, expect, it } from 'vitest';
import { chatTurn, missingFields, parseIntent, templateReply } from '../server/chat';
import { detectNeighborhood, venuesFor } from '../server/venues';

const now = new Date('2026-09-30T15:00:00'); // a Wednesday, local time

describe('intent parser', () => {
  it('reads the assignment example', () => {
    const intent = parseIntent('table for 2 in the West Village Friday, 7–9pm', {}, now);
    expect(intent).toEqual({ neighborhood: 'West Village', partySize: 2, date: '2026-10-02', timeFrom: '19:00', timeTo: '21:00' });
    expect(missingFields(intent)).toEqual([]);
  });
  it('keeps earlier details and applies corrections', () => {
    const first = parseIntent('4 people saturday around 8pm', {}, now);
    expect(first).toMatchObject({ partySize: 4, date: '2026-10-03', exactTime: '20:00', timeFrom: '19:30', timeTo: '21:30' });
    expect(missingFields(first)).toEqual(['neighborhood']); expect(templateReply(first)).toMatch(/covers New York \(West Village/);
    const second = parseIntent('make it 6 of us', first, now);
    expect(second).toMatchObject({ partySize: 6, date: '2026-10-03', exactTime: '20:00' });
    const third = parseIntent('actually the village, between 7 and 9', second, now);
    expect(third).toMatchObject({ neighborhood: 'West Village', partySize: 6, timeFrom: '19:00', timeTo: '21:00' });
  });
  it('asks for what is missing', () => {
    const intent = parseIntent('somewhere in greenwich village', {}, now);
    expect(intent.neighborhood).toBe('Greenwich Village');
    expect(templateReply(intent)).toMatch(/date, time window and party size/);
  });
  it('refuses places the demo does not cover instead of showing New York tables', () => {
    const intent = parseIntent('table for 2 in Fremont, CA friday 7-9pm', {}, now);
    expect(intent.unsupportedLocation).toBe('Fremont'); expect(intent.neighborhood).toBeUndefined();
    expect(missingFields(intent)).toContain('a covered neighborhood');
    expect(templateReply(intent)).toMatch(/can’t search Fremont/);
    expect(parseIntent('somewhere in Pleasanton, CA', {}, now).unsupportedLocation).toBe('Pleasanton');
    expect(parseIntent('table for 2 in the Fermont Friday, 7–9pm', {}, now).unsupportedLocation).toBe('Fermont');
    expect(parseIntent('dinner near union city tomorrow at 8', {}, now).unsupportedLocation).toBe('Union City');
    expect(parseIntent('2 people in the evening on friday', {}, now).unsupportedLocation).toBeUndefined();
    const fixed = parseIntent('ok, west village then', intent, now);
    expect(fixed.unsupportedLocation).toBeUndefined(); expect(fixed.neighborhood).toBe('West Village'); expect(missingFields(fixed)).toEqual([]);
  });
  it('maps neighborhoods and cities to venues, and unknown places to nothing', () => {
    expect(detectNeighborhood('dinner in the WV')).toBe('West Village');
    expect(venuesFor('West Village').every(v => v.neighborhood === 'West Village')).toBe(true);
    expect(venuesFor('Nowhere')).toEqual([]); expect(venuesFor(undefined)).toEqual([]);
    expect(venuesFor('San Francisco').length).toBeGreaterThan(8); expect(venuesFor('San Francisco').every(v => v.city === 'San Francisco' && v.timezone === 'America/Los_Angeles')).toBe(true);
    expect(venuesFor('Nob Hill').map(v => v.slug)).toEqual(['bigfour']);
    expect(venuesFor('New York').every(v => v.city === 'New York')).toBe(true);
  });
  it('treats one named time as an exact time with a window around it, and a range as a window', () => {
    const one = parseIntent('table for 2 in the west village friday at 7pm', {}, now);
    expect(one).toMatchObject({ exactTime: '19:00', timeFrom: '18:30', timeTo: '20:30' });
    const range = parseIntent('make it 7 to 9', one, now);
    expect(range.exactTime).toBeUndefined(); expect(range).toMatchObject({ timeFrom: '19:00', timeTo: '21:00' });
    expect(parseIntent('around 8', range, now)).toMatchObject({ exactTime: '20:00', timeFrom: '19:30', timeTo: '21:30' });
  });
  it('understands San Francisco and its neighborhoods', () => {
    const sf = parseIntent('dinner for 4 in SF saturday around 8', {}, now);
    expect(sf).toMatchObject({ neighborhood: 'San Francisco', partySize: 4, date: '2026-10-03', exactTime: '20:00', timeFrom: '19:30' });
    expect(missingFields(sf)).toEqual([]);
    expect(parseIntent('somewhere on nob hill', {}, now).neighborhood).toBe('Nob Hill');
    expect(parseIntent('near union square in san francisco', {}, now).neighborhood).toBe('Union Square');
    expect(parseIntent('table in oakland friday', {}, now).unsupportedLocation).toBe('Oakland');
    expect(templateReply(parseIntent('2 people friday 8pm', {}, now))).toMatch(/San Francisco \(Union Square/);
  });
});

describe('chat turn', () => {
  const messages = [{ role: 'user' as const, text: 'table for 2 in the West Village Friday, 7-9pm' }];
  it('uses the parser when Codex is off', async () => {
    const turn = await chatTurn({ messages, intent: {} }, { useCodex: false, now });
    expect(turn.source).toBe('parser'); expect(turn.ready).toBe(true); expect(turn.intent.date).toBe('2026-10-02');
  });
  it('merges the model reply over the parser and validates it', async () => {
    const run = async () => ({ reply: 'Checking West Village tables for two on Friday evening.', intent: { neighborhood: 'West Village', unsupportedLocation: null, date: '2026-10-02', timeFrom: '19:00', timeTo: '21:00', exactTime: null, partySize: 2 } });
    const turn = await chatTurn({ messages, intent: {} }, { useCodex: true, now, run });
    expect(turn.source).toBe('codex'); expect(turn.reply).toMatch(/Checking/); expect(turn.ready).toBe(true);
  });
  it('never returns results for an unsupported location even if the model says ready', async () => {
    const run = async () => ({ reply: 'Sorry, Fremont is not covered.', intent: { neighborhood: null, unsupportedLocation: 'Fremont, CA', date: '2026-10-02', timeFrom: '19:00', timeTo: '21:00', exactTime: null, partySize: 2 } });
    const turn = await chatTurn({ messages: [{ role: 'user', text: 'table for 2 in fremont ca friday 7-9pm' }], intent: {} }, { useCodex: true, now, run });
    expect(turn.ready).toBe(false); expect(turn.intent.unsupportedLocation).toBe('Fremont, CA');
  });
  it('falls back to the parser when Codex fails or returns junk', async () => {
    const junk = async () => ({ reply: 'x', intent: { neighborhood: null, unsupportedLocation: null, date: 'not-a-date', timeFrom: null, timeTo: null, exactTime: null, partySize: 99 } });
    const turn = await chatTurn({ messages, intent: {} }, { useCodex: true, now, run: junk });
    expect(turn.source).toBe('parser'); expect(turn.ready).toBe(true);
    const failing = async () => { throw new Error('boom'); };
    expect((await chatTurn({ messages, intent: {} }, { useCodex: true, now, run: failing })).source).toBe('parser');
  });
});
