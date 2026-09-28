import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { AvailabilityService, summarize, type VenueAvailability, type SearchIntent } from './availability';
import { windowFromExact, parseIntent, isReady, type Intent, type ChatInput } from './chat';
import { neighborhoods, coverageSummary, detectNeighborhood, venuesFor } from './venues';
import { dateSchema, timeSchema } from './sevenrooms';
import { type MessageCreate } from './ai';
import { log } from './logger';

/** What the agent hands back: the same shape the chat endpoint returns, with the model composing the reply. */
export type AgentTurn = { reply: string; intent: Intent; ready: boolean; source: 'agent'; results: VenueAvailability[] | null; nearby: VenueAvailability[] | null };

/** The one tool the model can call: look up real tables. Its input is the resolved request. */
const searchArgs = z.object({
  neighborhood: z.string().min(1).max(60),
  date: dateSchema,
  partySize: z.number().int().min(1).max(8),
  exactTime: timeSchema.optional(),
  timeFrom: timeSchema.optional(),
  timeTo: timeSchema.optional(),
});
const toolSchema = (() => { const { $schema: _drop, ...schema } = z.toJSONSchema(searchArgs) as Record<string, unknown>; return schema as Anthropic.Messages.Tool.InputSchema; })();

function systemPrompt(now: Date): string {
  return `You are Tavola, a warm, concise restaurant concierge for New York City and San Francisco. Interpret the diner's latest message and either ask for one missing detail or call check_availability to find real tables.
Current instant: ${now.toISOString()} — ${now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} in New York.
Covered areas (pass one of these EXACTLY in "neighborhood"): ${neighborhoods.join(', ')}. "New York"/"San Francisco" are cities covering every venue there; the rest are neighborhoods. Map "the village" to West Village, "SF" to San Francisco, "NYC"/"Manhattan" to New York. If the diner names any other place, don't call the tool — say the demo covers ${coverageSummary()} and ask which to check.
Rules: dates are YYYY-MM-DD, today or within 30 days; "Friday" means the next Friday. Times are 24-hour HH:MM. One named time ("7pm", "around 8") → exactTime; a window ("7-9") → timeFrom and timeTo. Bare evening numbers mean PM. partySize is 1-8.
Call check_availability only when you know the area, date, time (a single time or a window) and party size. If any is missing, ask for exactly the missing ones in one friendly sentence — do not guess. Never invent restaurants, times or prices; the tool returns the real ones. After it returns, write one or two short warm sentences: how many restaurants have a table, name one or two with a time, and say to tap a time to book. The app shows the full list, so keep it brief.`;
}

/**
 * A model-driven agent: the model resolves the request itself and calls a check_availability tool over the real
 * SevenRooms data, then composes the reply from what came back. This replaces the parse-then-summarize path when
 * an Anthropic key is present; the deterministic parser stays as the fallback (see chatTurn) and fills the intent
 * chips when the model only asks a question.
 */
export function createAgent(options: { apiKey: string; model: string; availability: AvailabilityService; maxTokens?: number; timeoutMs?: number; now?: () => Date; create?: MessageCreate }) {
  const client = options.create ? undefined : new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 30_000, maxRetries: 1 });
  const create: MessageCreate = options.create ?? (params => client!.messages.create(params));

  const run = async (input: ChatInput): Promise<AgentTurn> => {
    const now = options.now?.() ?? new Date();
    const lastUser = [...input.messages].reverse().find(m => m.role === 'user')?.text ?? '';
    // Baseline intent from the parser, so the intent chips still fill even if the model only asks a question.
    const baseline = parseIntent(lastUser, input.intent, now);

    // The Anthropic API requires the first message to be role 'user'. The web client seeds a welcome assistant
    // message, and a sliced window can also begin mid-turn on an assistant reply, so drop any leading assistant turns.
    const history = input.messages.slice(-12);
    const firstUser = history.findIndex(m => m.role === 'user');
    const messages: Anthropic.Messages.MessageParam[] = (firstUser < 0 ? [] : history.slice(firstUser)).map(m => ({ role: m.role, content: m.text }));
    if (!messages.length) return { reply: 'What area, date, time and party size should I check?', intent: baseline, ready: false, source: 'agent', results: null, nearby: null };
    let captured: { intent: Intent; results: VenueAvailability[]; nearby: VenueAvailability[] } | undefined;

    for (let step = 0; step < 3; step++) {
      const response = await create({
        model: options.model,
        max_tokens: options.maxTokens ?? 700,
        system: systemPrompt(now),
        tools: [{ name: 'check_availability', description: 'Find real open tables at covered restaurants for a resolved request.', input_schema: toolSchema }],
        messages,
      });
      const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const reply = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map(b => b.text).join(' ').trim();
        if (captured) return { reply: reply || summarize(captured.results, captured.intent, captured.nearby), intent: captured.intent, ready: true, source: 'agent', results: captured.results, nearby: captured.nearby.length ? captured.nearby : null };
        return { reply: reply || 'What area, date, time and party size should I check?', intent: baseline, ready: false, source: 'agent', results: null, nearby: null };
      }
      // Answer every tool_use block in the turn (Anthropic rejects a follow-up that is missing any tool_result).
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const { output, capture } = await runSearchTool(toolUse.input, options.availability, now);
        if (capture) captured = capture;
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(output) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    // The model kept calling the tool; answer from the last capture rather than looping forever.
    if (captured) return { reply: summarize(captured.results, captured.intent, captured.nearby), intent: captured.intent, ready: true, source: 'agent', results: captured.results, nearby: captured.nearby.length ? captured.nearby : null };
    return { reply: 'What area, date, time and party size should I check?', intent: baseline, ready: false, source: 'agent', results: null, nearby: null };
  };

  return { run };
}

/** Runs the check_availability tool: validates the args, searches real availability, and returns a compact result. */
async function runSearchTool(rawInput: unknown, availability: AvailabilityService, now: Date): Promise<{ output: unknown; capture?: { intent: Intent; results: VenueAvailability[]; nearby: VenueAvailability[] } }> {
  const parsed = searchArgs.safeParse(rawInput);
  if (!parsed.success) return { output: { error: 'bad_arguments', detail: 'Provide neighborhood, date (YYYY-MM-DD), a time or window (HH:MM), and partySize 1-8.' } };
  const canonical = detectNeighborhood(parsed.data.neighborhood) ?? parsed.data.neighborhood;
  if (!venuesFor(canonical).length) return { output: { error: 'unsupported_area', covered: coverageSummary() } };
  let intent: Intent = { neighborhood: canonical, date: parsed.data.date, partySize: parsed.data.partySize, exactTime: parsed.data.exactTime, timeFrom: parsed.data.timeFrom, timeTo: parsed.data.timeTo };
  intent = windowFromExact(intent);
  if (!isReady(intent)) return { output: { error: 'missing_fields', need: 'a date, a time or window, and a party size' } };
  const searchIntent = intent as SearchIntent;
  const results = await availability.search(searchIntent);
  const nearby = results.some(r => r.slots.some(s => s.type === 'book')) ? [] : await availability.searchNearby(searchIntent);
  log('info', 'agent_search', { area: canonical, venues: results.length, nearby: nearby.length });
  const brief = (list: VenueAvailability[]) => list.map(r => ({ name: r.venue.name, neighborhood: r.venue.neighborhood, book: r.slots.filter(s => s.type === 'book').slice(0, 8).map(s => s.label), request: r.slots.filter(s => s.type === 'request').length }));
  return { output: { area: canonical, restaurants: brief(results), nearby: brief(nearby) }, capture: { intent, results, nearby } };
}
