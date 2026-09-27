import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every tunable in one place, read once at startup. Tests pass their own values. */
export type Config = {
  apiPort: number;
  host: string;
  /** Whether the model path runs at all (false = deterministic parser only). Kept in sync with `ai.provider`. */
  useCodex: boolean;
  /** Chat backend: an Anthropic API key (deployable), the local Codex CLI, or none (parser only). */
  ai: { provider: 'anthropic' | 'codex' | 'none'; apiKey?: string; model: string; maxTokens: number };
  dataDir: string;
  profilePath: string;
  ledgerPath: string;
  prepareTimeoutMs: number;
  holdMarginMs: number;
  minHoldMs: number;
  jobRetentionMs: number;
  availabilityCacheMs: number;
  availabilityConcurrency: number;
  availabilityTimeoutMs: number;
  codexTimeoutMs: number;
  codexCacheMs: number;
  requireFreeCancellation: boolean;
  headless: boolean;
  browserChannel?: string;
  /** Connect auto-mode bookings to a remote browser (CDP ws:// or http:// endpoint) instead of launching locally. */
  browserCdpUrl?: string;
  browserbase?: { apiKey: string; projectId?: string; proxies: boolean; solveCaptchas: boolean };
  humanSolveMs: number;
  browserOffscreen: boolean;
  /** Per-IP request cap per minute on /api/* (0 disables). */
  rateLimitPerMinute: number;
  /** How often the canary sweeps every venue's availability (ms; 0 disables the schedule). */
  canaryIntervalMs: number;
  /** 'auto' drives a server browser (local); 'handoff' opens SevenRooms in the diner's own browser (deployable). */
  bookingMode: 'auto' | 'handoff';
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const num = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.TAVOLA_DATA_DIR || join(root, '.local');
  // Model on unless TAVOLA_DEMO_AI=off. Prefer an Anthropic API key (deployable) over the local Codex CLI.
  const aiOn = env.TAVOLA_DEMO_AI !== 'off';
  const apiKey = env.ANTHROPIC_API_KEY || undefined;
  const provider: 'anthropic' | 'codex' | 'none' = !aiOn ? 'none' : apiKey ? 'anthropic' : 'codex';
  return {
    // Prefer the platform's injected PORT (Render, etc.); fall back to the demo default for local runs.
    apiPort: num(env.PORT, num(env.TAVOLA_DEMO_API_PORT, 8788)),
    // Bind publicly when a platform PORT is present, otherwise stay on localhost for local dev.
    host: env.TAVOLA_DEMO_HOST || (env.PORT ? '0.0.0.0' : '127.0.0.1'),
    useCodex: provider !== 'none',
    ai: { provider, apiKey, model: env.TAVOLA_AI_MODEL || 'claude-sonnet-5', maxTokens: num(env.TAVOLA_AI_MAX_TOKENS, 700) },
    dataDir,
    profilePath: env.TAVOLA_DEMO_PROFILE || join(dataDir, 'profile.json'),
    ledgerPath: env.TAVOLA_DEMO_LEDGER || join(dataDir, 'bookings.json'),
    prepareTimeoutMs: num(env.TAVOLA_PREPARE_TIMEOUT_MS, 120_000),
    holdMarginMs: num(env.TAVOLA_HOLD_MARGIN_MS, 20_000),
    minHoldMs: 30_000,
    jobRetentionMs: num(env.TAVOLA_JOB_RETENTION_MS, 30 * 60_000),
    availabilityCacheMs: num(env.TAVOLA_AVAILABILITY_CACHE_MS, 20_000),
    availabilityConcurrency: num(env.TAVOLA_AVAILABILITY_CONCURRENCY, 6),
    availabilityTimeoutMs: num(env.TAVOLA_AVAILABILITY_TIMEOUT_MS, 15_000),
    codexTimeoutMs: num(env.TAVOLA_CODEX_TIMEOUT_MS, 60_000),
    codexCacheMs: num(env.TAVOLA_CODEX_CACHE_MS, 5 * 60_000),
    // Fees are shown to the diner to decide by default; strict mode refuses fee venues outright.
    requireFreeCancellation: env.TAVOLA_STRICT_NO_FEE === '1',
    // Visible by default: SevenRooms' reCAPTCHA needs a person to tick a checkbox, which only works in a window you can see.
    headless: env.TAVOLA_HEADLESS === '1',
    browserChannel: env.TAVOLA_BROWSER_CHANNEL || undefined,
    browserCdpUrl: env.TAVOLA_BROWSER_CDP_URL || undefined,
    // The Browserbase API key alone is enough; the project resolves from it. PROJECT_ID stays optional.
    browserbase: env.BROWSERBASE_API_KEY ? { apiKey: env.BROWSERBASE_API_KEY, projectId: env.BROWSERBASE_PROJECT_ID || undefined, proxies: env.BROWSERBASE_PROXIES === '1', solveCaptchas: env.BROWSERBASE_SOLVE_CAPTCHAS === '1' } : undefined,
    humanSolveMs: num(env.TAVOLA_HUMAN_SOLVE_MS, 120_000),
    // The booking window stays off-screen while Tavola fills the form; it only comes into view if a reCAPTCHA checkbox appears.
    browserOffscreen: !env.TAVOLA_BROWSER_VISIBLE && env.TAVOLA_HEADLESS !== '1',
    rateLimitPerMinute: env.TAVOLA_RATE_LIMIT === '0' ? 0 : num(env.TAVOLA_RATE_LIMIT, 120),
    canaryIntervalMs: num(env.TAVOLA_CANARY_INTERVAL_MS, 0),
    // Default to the in-app browser handoff (no separate window, deployable). TAVOLA_BOOKING_MODE=auto drives a local server browser instead.
    bookingMode: env.TAVOLA_BOOKING_MODE === 'auto' || (env.TAVOLA_BOOKING_MODE !== 'handoff' && Boolean(env.BROWSERBASE_API_KEY)) ? 'auto' : 'handoff',
  };
}
