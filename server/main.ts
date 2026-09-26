import { existsSync, readFileSync } from 'node:fs';
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
// Chat backend: an Anthropic API key (deployable) if set, else the local Codex CLI, else parser only.
let model: ModelRunner | undefined;
let modelSource: 'anthropic' | 'codex' | undefined;
let modelStatus: () => Record<string, unknown> = () => ({ provider: 'parser' });
if (config.ai.provider === 'anthropic' && config.ai.apiKey) {
  const anthropic = createAnthropicRunner({ apiKey: config.ai.apiKey, model: config.ai.model, maxTokens: config.ai.maxTokens });
  model = anthropic.run; modelSource = 'anthropic'; modelStatus = () => anthropic.status();
} else if (config.ai.provider === 'codex') {
  const codex = new CodexQueue({ timeoutMs: config.codexTimeoutMs, cacheMs: config.codexCacheMs });
  // Wrap so `this` stays bound to the queue (CodexQueue.status is a method, not an arrow field).
  model = codex.run; modelSource = 'codex'; modelStatus = () => codex.status();
}
const jobs = new BookingJobs({
  booker: (onStep, onVerification, onLiveView) => new SevenRoomsBooker({ contexts, onStep, onVerification, onLiveView, requireFreeCancellation: config.requireFreeCancellation, remote, liveView: contexts.liveView?.bind(contexts), humanSolveMs: remote || !config.headless ? config.humanSolveMs : undefined }),
  ledger, prepareTimeoutMs: config.prepareTimeoutMs, holdMarginMs: config.holdMarginMs, minHoldMs: config.minHoldMs, retentionMs: config.jobRetentionMs, humanSolveMs: config.headless ? undefined : config.humanSolveMs,
});
// In production the same server serves the built web (npm run build → dist/) so the app is one deployable service.
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(rootDir, 'dist', 'index.html');
const webDir = existsSync(indexPath) ? 'dist' : undefined;
const indexHtml = webDir ? readFileSync(indexPath, 'utf8') : undefined;
const app = createApp({
  useCodex: config.useCodex, bookingMode: config.bookingMode, model, modelSource,
  availability: new AvailabilityService({ cacheMs: config.availabilityCacheMs, concurrency: config.availabilityConcurrency, timeoutMs: config.availabilityTimeoutMs }),
  jobs, ledger, profiles: new ProfileStore(config.profilePath), webDir, indexHtml,
  health: () => ({ browser: 'status' in contexts ? (contexts as { status: () => unknown }).status() : { remote: true }, chat: modelStatus() }),
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.apiPort }, info => {
  const chatVia = config.ai.provider === 'anthropic' ? `Anthropic ${config.ai.model}` : config.ai.provider === 'codex' ? 'Codex CLI' : 'parser';
  console.log(`Pearl ${webDir ? 'app + API' : 'demo API'}: http://${config.host}:${info.port} · web ${webDir ? 'served from dist/' : 'via Vite dev server'} · chat via ${chatVia} · booking mode: ${config.bookingMode}${config.bookingMode === 'auto' ? (config.browserbase ? ' via Browserbase' : config.browserCdpUrl ? ' via remote browser' : ' (local browser)') : ' (in-app handoff)'}`);
  log('info', 'api_started', { port: info.port, web: Boolean(webDir), chat: config.ai.provider, model: config.ai.provider === 'anthropic' ? config.ai.model : undefined, dataDir: config.dataDir });
});

/** Release every hold and close Chromium before the process goes away. */
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return; stopping = true;
  log('info', 'api_stopping', { signal });
  server.close();
  await jobs.close().catch(() => {});
  await contexts.close?.().catch(() => {});
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
