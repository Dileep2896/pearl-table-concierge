import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { log } from './logger';

/** The chat backend contract: turn a prompt + JSON schema into the model's structured reply. */
export type ModelRunner = (prompt: string, jsonSchema: unknown) => Promise<unknown>;
export class ModelUnavailable extends Error { constructor(message = 'The AI model did not return a reply.') { super(message); this.name = 'ModelUnavailable'; } }

/**
 * Chat understanding through the Anthropic API, so the agent can run on a deployed server with just an
 * API key — no local Codex login. Structured output is forced with a single `reply` tool whose input
 * schema is the reply schema, so the model must return valid JSON. Identical prompts (a retried request,
 * a double tap) are answered from a short in-memory cache so a repeat never pays twice.
 */
/** A message create call: the real Anthropic client by default, or a fake in tests. */
export type MessageCreate = (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Messages.Message>;

export function createAnthropicRunner(options: { apiKey: string; model: string; maxTokens?: number; cacheMs?: number; timeoutMs?: number; now?: () => number; create?: MessageCreate }): { run: ModelRunner; status: () => { provider: 'anthropic'; model: string; cached: number } } {
  const client = options.create ? undefined : new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 30_000, maxRetries: 1 });
  const create: MessageCreate = options.create ?? (params => client!.messages.create(params));
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const cacheMs = options.cacheMs ?? 5 * 60_000;
  const now = () => options.now?.() ?? Date.now();

  const run: ModelRunner = (prompt, jsonSchema) => {
    const key = createHash('sha256').update(prompt).update(JSON.stringify(jsonSchema)).digest('hex');
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.value;
    // The Anthropic API rejects an unknown top-level `$schema`; drop it and keep the rest of the JSON schema.
    const { $schema: _drop, ...schema } = (jsonSchema ?? { type: 'object' }) as Record<string, unknown>;
    const started = performance.now();
    const value = create({
        model: options.model,
        max_tokens: options.maxTokens ?? 700,
        tool_choice: { type: 'tool', name: 'reply' },
        tools: [{ name: 'reply', description: 'Return the concierge reply and the parsed booking intent.', input_schema: schema as Anthropic.Messages.Tool.InputSchema }],
        messages: [{ role: 'user', content: prompt }],
      })
      .then(message => {
        const block = message.content.find(b => b.type === 'tool_use') as { input: unknown } | undefined;
        if (!block) throw new ModelUnavailable('The model returned no structured reply.');
        log('info', 'ai_turn', { ms: Math.round(performance.now() - started), model: options.model, in: message.usage?.input_tokens, out: message.usage?.output_tokens });
        return block.input;
      })
      .catch(error => {
        // Any API/parse error degrades to the deterministic parser; surface a stable type for the caller.
        throw error instanceof ModelUnavailable ? error : new ModelUnavailable(error instanceof Error ? error.message : String(error));
      });
    cache.set(key, { at: now(), value });
    value.catch(() => cache.delete(key));
    if (cache.size > 200) for (const [k, v] of cache) if (now() - v.at > cacheMs) cache.delete(k);
    return value;
  };

  return { run, status: () => ({ provider: 'anthropic' as const, model: options.model, cached: cache.size }) };
}
