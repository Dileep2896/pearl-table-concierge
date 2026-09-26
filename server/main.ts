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
import { log } from './logger';

const config = loadConfig();
// Auto mode's browser: Browserbase (remote, proxies + captcha solving) if configured, a remote CDP endpoint if given, else a local window.
const contexts: ContextSource = config.browserbase
  ? new BrowserbaseSource(config.browserbase)
  : new BrowserPool({ headless: config.headless, channel: config.browserChannel, cdpUrl: config.browserCdpUrl, args: config.browserOffscreen && !config.browserCdpUrl ? ['--window-position=-2400,0', '--window-size=460,940'] : undefined });
const remote = Boolean(config.browserbase || config.browserCdpUrl);
const ledger = new BookingLedger(config.ledgerPath);
const codex = new CodexQueue({ timeoutMs: config.codexTimeoutMs, cacheMs: config.codexCacheMs });
const jobs = new BookingJobs({
  booker: (onStep, onVerification) => new SevenRoomsBooker({ contexts, onStep, onVerification, requireFreeCancellation: config.requireFreeCancellation, remote, liveView: contexts.liveView?.bind(contexts), humanSolveMs: remote || !config.headless ? config.humanSolveMs : undefined }),
  ledger, prepareTimeoutMs: config.prepareTimeoutMs, holdMarginMs: config.holdMarginMs, minHoldMs: config.minHoldMs, retentionMs: config.jobRetentionMs, humanSolveMs: config.headless ? undefined : config.humanSolveMs,
});
const app = createApp({
  useCodex: config.useCodex, bookingMode: config.bookingMode, codex: codex.run,
  availability: new AvailabilityService({ cacheMs: config.availabilityCacheMs, concurrency: config.availabilityConcurrency, timeoutMs: config.availabilityTimeoutMs }),
  jobs, ledger, profiles: new ProfileStore(config.profilePath),
  health: () => ({ browser: 'status' in contexts ? (contexts as { status: () => unknown }).status() : { remote: true }, codexQueue: codex.status() }),
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.apiPort }, info => {
  console.log(`Pearl demo API: http://${config.host}:${info.port} · chat via ${config.useCodex ? 'Codex CLI' : 'parser'} · booking mode: ${config.bookingMode}${config.bookingMode === 'auto' ? (config.browserbase ? ' via Browserbase' : config.browserCdpUrl ? ' via remote browser' : ' (local browser)') : ' (in-app handoff)'}`);
  log('info', 'api_started', { port: info.port, codex: config.useCodex, dataDir: config.dataDir });
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
