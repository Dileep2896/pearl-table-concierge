import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../server/agent';
import { AvailabilityService } from '../server/availability';
import type { Slot } from '../server/sevenrooms';

const now = new Date('2026-09-30T15:00:00');
const slot = (time: string, label: string, type: Slot['type'] = 'book'): Slot => ({ venue: 'x', time, label, timeIso: `2026-10-02 ${time}:00`, area: 'Indoor Dining', type, accessId: type === 'book' ? 'a1' : null, shiftId: 's1', shiftName: 'Dinner' });
const bookable = new AvailabilityService({ fetch: async () => [slot('19:00', '7:00 PM')], cacheMs: 0, now: () => now.getTime() });
// A model turn as the SDK returns it; the agent reads only stop_reason and content.
const turn = (stop: string, content: unknown[]) => ({ stop_reason: stop, content }) as never;
const toolUse = (input: unknown) => turn('tool_use', [{ type: 'tool_use', id: 't1', name: 'check_availability', input }]);
const text = (t: string) => turn('end_turn', [{ type: 'text', text: t }]);

describe('agent', () => {
  it('calls check_availability over the real data, then writes the reply from what came back', async () => {
    const responses = [toolUse({ neighborhood: 'West Village', date: '2026-10-02', partySize: 2, exactTime: '19:00' }), text('Found tables in the West Village at 7:00 PM — tap a time to book.')];
    const create = vi.fn(async (_params: unknown) => responses.shift()!);
    const agent = createAgent({ apiKey: 'test', model: 'claude-sonnet-5', availability: bookable, now: () => now, create });
    const result = await agent.run({ messages: [{ role: 'user', text: 'table for 2 in the west village friday at 7' }], intent: {} });

    expect(result.source).toBe('agent');
    expect(result.ready).toBe(true);
    expect(result.results?.length).toBeGreaterThan(0);
    expect(result.results?.every(r => r.venue.neighborhood === 'West Village')).toBe(true);
    expect(result.reply).toMatch(/West Village/);
    expect(result.intent).toMatchObject({ neighborhood: 'West Village', date: '2026-10-02', partySize: 2, timeFrom: '18:30', timeTo: '20:30' });
    // The model called the tool, then was asked again to compose the reply.
    expect(create).toHaveBeenCalledTimes(2);
    const params = create.mock.calls[0][0] as { tools: { name: string; input_schema: Record<string, unknown> }[] };
    expect(params.tools[0].name).toBe('check_availability');
    expect(params.tools[0].input_schema.$schema).toBeUndefined();
  });

  it('asks for the missing details instead of searching when it has none', async () => {
    const create = vi.fn(async (_params: unknown) => text('Which neighborhood, date, time and party size should I check?'));
    const agent = createAgent({ apiKey: 'test', model: 'x', availability: bookable, now: () => now, create });
    const result = await agent.run({ messages: [{ role: 'user', text: 'hi' }], intent: {} });

    expect(result.ready).toBe(false);
    expect(result.results).toBeNull();
    expect(result.reply).toMatch(/neighborhood/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never returns results for an area the demo does not cover', async () => {
    let searched = false;
    const guarded = new AvailabilityService({ fetch: async () => { searched = true; return [slot('19:00', '7:00 PM')]; }, cacheMs: 0, now: () => now.getTime() });
    const responses = [toolUse({ neighborhood: 'Boston', date: '2026-10-02', partySize: 2, exactTime: '19:00' }), text('The demo only covers New York and San Francisco — which should I check?')];
    const create = vi.fn(async (_params: unknown) => responses.shift()!);
    const agent = createAgent({ apiKey: 'test', model: 'x', availability: guarded, now: () => now, create });
    const result = await agent.run({ messages: [{ role: 'user', text: 'table for 2 in boston at 7' }], intent: {} });

    expect(searched).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.results).toBeNull();
    expect(result.reply).toMatch(/New York|San Francisco/);
  });

  it('drops the leading assistant turn so the model gets a user-first conversation (the client seeds a welcome)', async () => {
    const create = vi.fn(async (_params: unknown) => text('Which neighborhood should I check?'));
    const agent = createAgent({ apiKey: 'test', model: 'x', availability: bookable, now: () => now, create });
    await agent.run({ messages: [
      { role: 'assistant', text: 'Good evening. Tell me where, when and for how many.' },
      { role: 'user', text: 'a table for two' },
      { role: 'assistant', text: 'Which neighborhood?' },
      { role: 'user', text: 'west village friday at 7' },
    ], intent: {} });
    // The Anthropic API rejects a conversation that does not start with role 'user'.
    const params = create.mock.calls[0][0] as { messages: { role: string }[] };
    expect(params.messages[0].role).toBe('user');
    expect(params.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
