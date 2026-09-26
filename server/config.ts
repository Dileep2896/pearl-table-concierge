import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every tunable in one place, read once at startup. Tests pass their own values. */
export type Config = {
  apiPort: number;
  host: string;
  useCodex: boolean;
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
  /** 'auto' drives a server browser (local); 'handoff' opens SevenRooms in the diner's own browser (deployable). */
  bookingMode: 'auto' | 'handoff';
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const num = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.PEARL_DATA_DIR || join(root, '.local');
  return {
    apiPort: num(env.PEARL_DEMO_API_PORT, 8788),
    host: env.PEARL_DEMO_HOST || '127.0.0.1',
    useCodex: env.PEARL_DEMO_AI !== 'off',
    dataDir,
    profilePath: env.PEARL_DEMO_PROFILE || join(dataDir, 'profile.json'),
    ledgerPath: env.PEARL_DEMO_LEDGER || join(dataDir, 'bookings.json'),
    prepareTimeoutMs: num(env.PEARL_PREPARE_TIMEOUT_MS, 120_000),
    holdMarginMs: num(env.PEARL_HOLD_MARGIN_MS, 20_000),
    minHoldMs: 30_000,
    jobRetentionMs: num(env.PEARL_JOB_RETENTION_MS, 30 * 60_000),
    availabilityCacheMs: num(env.PEARL_AVAILABILITY_CACHE_MS, 20_000),
    availabilityConcurrency: num(env.PEARL_AVAILABILITY_CONCURRENCY, 6),
    availabilityTimeoutMs: num(env.PEARL_AVAILABILITY_TIMEOUT_MS, 15_000),
    codexTimeoutMs: num(env.PEARL_CODEX_TIMEOUT_MS, 60_000),
    codexCacheMs: num(env.PEARL_CODEX_CACHE_MS, 5 * 60_000),
    // Fees are shown to the diner to decide by default; strict mode refuses fee venues outright.
    requireFreeCancellation: env.PEARL_STRICT_NO_FEE === '1',
    // Visible by default: SevenRooms' reCAPTCHA needs a person to tick a checkbox, which only works in a window you can see.
    headless: env.PEARL_HEADLESS === '1',
    browserChannel: env.PEARL_BROWSER_CHANNEL || undefined,
    browserCdpUrl: env.PEARL_BROWSER_CDP_URL || undefined,
    // The Browserbase API key alone is enough; the project resolves from it. PROJECT_ID stays optional.
    browserbase: env.BROWSERBASE_API_KEY ? { apiKey: env.BROWSERBASE_API_KEY, projectId: env.BROWSERBASE_PROJECT_ID || undefined, proxies: env.BROWSERBASE_PROXIES === '1', solveCaptchas: env.BROWSERBASE_SOLVE_CAPTCHAS === '1' } : undefined,
    humanSolveMs: num(env.PEARL_HUMAN_SOLVE_MS, 120_000),
    // The booking window stays off-screen while Pearl fills the form; it only comes into view if a reCAPTCHA checkbox appears.
    browserOffscreen: !env.PEARL_BROWSER_VISIBLE && env.PEARL_HEADLESS !== '1',
    // Default to the in-app browser handoff (no separate window, deployable). PEARL_BOOKING_MODE=auto drives a local server browser instead.
    bookingMode: env.PEARL_BOOKING_MODE === 'auto' || (env.PEARL_BOOKING_MODE !== 'handoff' && Boolean(env.BROWSERBASE_API_KEY)) ? 'auto' : 'handoff',
  };
}
