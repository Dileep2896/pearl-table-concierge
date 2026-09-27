import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { BrowserPool, type ContextSource } from './browser-pool';
import { BrowserbaseSource } from './browserbase';
import { SevenRoomsBooker } from './booking-browser';
import { BookingJobs } from './jobs';
import { BookingLedger } from './ledger';
import { ProfileStore } from './profile';
import { AvailabilityService } from './availability';
import { Canary } from './canary';
import { CodexQueue } from './codex';
import { createAnthropicRunner, type ModelRunner } from './ai';
import { log } from './logger';

const config = loadConfig();
// Auto mode's browser: Browserbase (remote, proxies + captcha solving) if configured, a remote CDP endpoint if given, else a local window.
const contexts: ContextSource = config.browserbase
  ? new BrowserbaseSource(config.browserbase)
  : new BrowserPool({ headless: config.headless, channel: config.browserChannel, cdpUrl: config.browserCdpUrl, args: config.browserOffscreen && !config.browserCdpUrl ? ['--window-position=-2400,0', '--window-size=460,940'] : undefined });
const remote = Boolean(config.browserbase || config.browserCdpUrl);
const ledger = new BookingLedger(config.ledgerPath);
// Is the Codex CLI actually installed? On a deploy it usually is not, so probe once instead of spawning it
// (and failing) on every chat turn, and so /api/health can report the real backend.
const codexAvailable = () => { try { return spawnSync(process.env.TAVOLA_CODEX_BIN || 'codex', ['--version'], { timeout: 3000, stdio: 'ignore' }).status === 0; } catch { return false; } };
// Chat backend: an Anthropic API key (deployable) if set, else the local Codex CLI when present, else parser only.
let model: ModelRunner | undefined;
let modelSource: 'anthropic' | 'codex' | undefined;
let modelStatus: () => Record<string, unknown> = () => ({ provider: 'parser' });
if (config.ai.provider === 'anthropic' && config.ai.apiKey) {
  const anthropic = createAnthropicRunner({ apiKey: config.ai.apiKey, model: config.ai.model, maxTokens: config.ai.maxTokens });
  model = anthropic.run; modelSource = 'anthropic'; modelStatus = () => anthropic.status();
} else if (config.ai.provider === 'codex' && codexAvailable()) {
  const codex = new CodexQueue({ timeoutMs: config.codexTimeoutMs, cacheMs: config.codexCacheMs });
  // Wrap so `this` stays bound to the queue (CodexQueue.status is a method, not an arrow field).
  model = codex.run; modelSource = 'codex'; modelStatus = () => codex.status();
} else if (config.ai.provider === 'codex') {
  log('warn', 'codex_unavailable', { message: 'Chat model is on but the Codex CLI is not installed; falling back to the deterministic parser. Set ANTHROPIC_API_KEY to use a model.' });
}
// The model path only runs when a real backend is wired, so a keyless deploy uses the parser (and health says so).
const useModel = Boolean(model);
const jobs = new BookingJobs({
  booker: (onStep, onVerification, onLiveView) => new SevenRoomsBooker({ contexts, onStep, onVerification, onLiveView, requireFreeCancellation: config.requireFreeCancellation, remote, liveView: contexts.liveView?.bind(contexts), humanSolveMs: remote || !config.headless ? config.humanSolveMs : undefined }),
  ledger, prepareTimeoutMs: config.prepareTimeoutMs, holdMarginMs: config.holdMarginMs, minHoldMs: config.minHoldMs, retentionMs: config.jobRetentionMs, humanSolveMs: config.headless ? undefined : config.humanSolveMs,
});
// In production the same server serves the built web (npm run build → dist/) so the app is one deployable service.
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(rootDir, 'dist', 'index.html');
const webDir = existsSync(indexPath) ? 'dist' : undefined;
const indexHtml = webDir ? readFileSync(indexPath, 'utf8') : undefined;
const availability = new AvailabilityService({ cacheMs: config.availabilityCacheMs, concurrency: config.availabilityConcurrency, timeoutMs: config.availabilityTimeoutMs });
const canary = new Canary({ availability, intervalMs: config.canaryIntervalMs });
const app = createApp({
  useCodex: useModel, bookingMode: config.bookingMode, model, modelSource, rateLimitPerMinute: config.rateLimitPerMinute,
  availability, canary,
  jobs, ledger, profiles: new ProfileStore(config.profilePath), webDir, indexHtml,
  health: () => ({ browser: 'status' in contexts ? (contexts as { status: () => unknown }).status() : { remote: true }, chat: modelStatus() }),
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.apiPort }, info => {
  const chatVia = modelSource === 'anthropic' ? `Anthropic ${config.ai.model}` : modelSource === 'codex' ? 'Codex CLI' : 'parser';
  console.log(`Tavola ${webDir ? 'app + API' : 'demo API'}: http://${config.host}:${info.port} · web ${webDir ? 'served from dist/' : 'via Vite dev server'} · chat via ${chatVia} · booking mode: ${config.bookingMode}${config.bookingMode === 'auto' ? (config.browserbase ? ' via Browserbase' : config.browserCdpUrl ? ' via remote browser' : ' (local browser)') : ' (in-app handoff)'}`);
  log('info', 'api_started', { port: info.port, web: Boolean(webDir), chat: modelSource ?? 'parser', model: modelSource === 'anthropic' ? config.ai.model : undefined, canaryEveryMs: config.canaryIntervalMs || undefined, dataDir: config.dataDir });
  canary.start();
});

/** Release every hold and close Chromium before the process goes away. */
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return; stopping = true;
  log('info', 'api_stopping', { signal });
  // Stop accepting connections and let in-flight requests drain before tearing down browsers and exiting.
  await new Promise<void>(resolve => server.close(() => resolve())).catch(() => {});
  canary.stop();
  await jobs.close().catch(() => {});
  await contexts.close?.().catch(() => {});
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

// Baseline error capture: never let a stray rejection or exception take the server down silently. Wire a real
// tracker (e.g. Sentry) here by forwarding these events when SENTRY_DSN is set.
process.on('unhandledRejection', reason => log('error', 'unhandled_rejection', { message: reason instanceof Error ? reason.message : String(reason) }));
process.on('uncaughtException', error => log('error', 'uncaught_exception', { message: error.message, stack: error.stack?.split('\n').slice(0, 3).join(' | ') }));
