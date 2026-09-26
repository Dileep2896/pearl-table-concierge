import { describe, expect, it, vi } from 'vitest';
import { createAnthropicRunner, ModelUnavailable } from '../server/ai';
import { loadConfig } from '../server/config';
import { chatTurn } from '../server/chat';

const schema = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] };
// The runner only reads message.content and message.usage, so a minimal stand-in is enough.
const toolMessage = (input: unknown) => ({ content: [{ type: 'tool_use', name: 'reply', input }], usage: { input_tokens: 10, output_tokens: 5 } }) as never;

describe('anthropic chat runner', () => {
  it('forces the reply tool, strips $schema, and returns the tool input', async () => {
    const create = vi.fn(async (_params: unknown) => toolMessage({ ok: true }));
    const { run } = createAnthropicRunner({ apiKey: 'test', model: 'claude-sonnet-5', create });
    expect(await run('hello', schema)).toEqual({ ok: true });
    const params = create.mock.calls[0][0] as { model: string; tool_choice: unknown; tools: { name: string; input_schema: Record<string, unknown> }[] };
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'reply' });
    expect(params.tools[0].name).toBe('reply');
    expect(params.tools[0].input_schema.$schema).toBeUndefined();
    expect(params.tools[0].input_schema.type).toBe('object');
  });
  it('caches identical prompts so a repeat does not call the API twice', async () => {
    const create = vi.fn(async (_params: unknown) => toolMessage({ n: 1 }));
    const { run, status } = createAnthropicRunner({ apiKey: 'test', model: 'claude-sonnet-5', create });
    await run('same', schema); await run('same', schema);
    expect(create).toHaveBeenCalledTimes(1); expect(status().cached).toBe(1);
  });
  it('throws ModelUnavailable when the model returns no tool call', async () => {
    const create = vi.fn(async (_params: unknown) => ({ content: [{ type: 'text', text: 'hi' }], usage: {} }) as never);
    const { run } = createAnthropicRunner({ apiKey: 'test', model: 'x', create });
    await expect(run('p', schema)).rejects.toBeInstanceOf(ModelUnavailable);
  });
  it('labels a turn it answers as source "anthropic"', async () => {
    const now = new Date('2026-09-30T15:00:00');
    const run = async () => ({ reply: 'Checking West Village tables.', intent: { neighborhood: 'West Village', unsupportedLocation: null, date: '2026-10-02', timeFrom: '19:00', timeTo: '21:00', exactTime: null, partySize: 2 } });
    const turn = await chatTurn({ messages: [{ role: 'user', text: 'table for 2 west village friday 7-9' }], intent: {} }, { useCodex: true, now, run, modelSource: 'anthropic' });
    expect(turn.source).toBe('anthropic'); expect(turn.ready).toBe(true);
  });
});

describe('chat provider selection', () => {
  it('prefers the Anthropic API when a key is set', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: 'sk-test', PEARL_AI_MODEL: 'claude-haiku-4-5' } as NodeJS.ProcessEnv);
    expect(c.ai.provider).toBe('anthropic'); expect(c.ai.model).toBe('claude-haiku-4-5'); expect(c.ai.apiKey).toBe('sk-test'); expect(c.useCodex).toBe(true);
  });
  it('falls back to Codex when no key is set', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.ai.provider).toBe('codex'); expect(c.ai.model).toBe('claude-sonnet-5'); expect(c.useCodex).toBe(true);
  });
  it('is parser-only when PEARL_DEMO_AI=off even with a key', () => {
    const c = loadConfig({ PEARL_DEMO_AI: 'off', ANTHROPIC_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    expect(c.ai.provider).toBe('none'); expect(c.useCodex).toBe(false);
  });
});
