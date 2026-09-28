import { randomUUID } from 'node:crypto';
import { SevenRoomsBooker, type BookingRequest, type BookingStep, type SubmitDiagnostics } from './booking-browser';
import type { Venue } from './venues';
import type { LedgerStore } from './ledger';
import { ApiError } from './errors';
import { log } from './logger';

export type JobState = 'PREPARING' | 'READY' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type JobResult = { status: string; code: string; message: string; reference?: string; policy?: string; pageUrl?: string; diagnostics?: SubmitDiagnostics };
export type BookingJob = {
  id: string; state: JobState; createdAt: string; updatedAt: string;
  steps: { step: BookingStep; note?: string; at: string }[];
  request: { venue: Venue; date: string; time: string; partySize: number; contact: BookingRequest['contact'] };
  /** Live view of the remote (Browserbase) browser, so the diner can watch and tick the captcha. */
  liveViewUrl?: string;
  /** Present once the form is filled: what Tavola typed and what the restaurant's policy says. */
  prepared?: { policy?: string; feeWarning?: string; needsDiner?: 'card' | 'login'; values?: Record<string, string>; holdExpiresAt: string };
  /** Set while the restaurant's page is waiting for the diner to tick the reCAPTCHA checkbox. */
  verification?: { requestedAt: string; expiresAt: string; passedAt?: string; liveViewUrl?: string };
  result?: JobResult;
};
const terminal: JobState[] = ['CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED'];
/** The only moves the state machine allows. Anything else is a bug and is logged, not applied. */
const transitions: Record<JobState, JobState[]> = {
  PREPARING: ['READY', 'FAILED', 'CANCELLED'], READY: ['SUBMITTING', 'CANCELLED', 'EXPIRED'], SUBMITTING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [], FAILED: [], CANCELLED: [], EXPIRED: [],
};

export type JobsOptions = {
  booker: (onStep: (step: BookingStep, note?: string) => void, onVerification: (liveViewUrl?: string) => void, onLiveView: (liveViewUrl?: string) => void) => SevenRoomsBooker;
  ledger?: LedgerStore;
  now?: () => Date;
  prepareTimeoutMs?: number;
  holdMarginMs?: number;
  minHoldMs?: number;
  /** How long finished jobs stay readable before they are dropped. */
  retentionMs?: number;
  /** Mirrors the booker's human-solve window so the page can show a countdown. */
  humanSolveMs?: number;
};

type Entry = { job: BookingJob; booker: SevenRoomsBooker; timers: ReturnType<typeof setTimeout>[] };

/**
 * The booking state machine. Owns every job, its browser session and its timers;
 * the HTTP layer only translates requests into these calls.
 */
export class BookingJobs {
  private entries = new Map<string, Entry>();
  private sweeper?: ReturnType<typeof setInterval>;
  constructor(private options: JobsOptions) {
    this.sweeper = setInterval(() => this.sweep(), 60_000); this.sweeper.unref?.();
  }
  private now() { return this.options.now?.() ?? new Date(); }
  private entry(id: string) { const entry = this.entries.get(id); if (!entry) throw new ApiError(404, 'NOT_FOUND', 'That booking is unknown or has been cleaned up.'); return entry; }
  get(id: string): BookingJob { return this.entry(id).job; }
  list(): BookingJob[] { return [...this.entries.values()].map(e => e.job); }
  status() { const jobs = this.list(); return { total: jobs.length, active: jobs.filter(j => !terminal.includes(j.state)).length }; }

  private move(entry: Entry, to: JobState, result?: JobResult) {
    const { job } = entry;
    if (!transitions[job.state].includes(to)) { log('warn', 'job_transition_rejected', { id: job.id, from: job.state, to }); return false; }
    job.state = to; job.updatedAt = this.now().toISOString(); if (result) job.result = result;
    return true;
  }
  private async finish(entry: Entry, to: JobState, result: JobResult) {
    if (!this.move(entry, to, result)) return;
    for (const timer of entry.timers) clearTimeout(timer); entry.timers = [];
    await entry.booker.close();
    const { job } = entry;
    log('info', 'booking_finished', { id: job.id, venue: job.request.venue.slug, state: to, code: result.code, reference: result.reference });
    if (to === 'CONFIRMED' && this.options.ledger) {
      await this.options.ledger.append({ id: job.id, confirmedAt: job.updatedAt, venue: job.request.venue.slug, venueName: job.request.venue.name, city: job.request.venue.city, date: job.request.date, time: job.request.time, partySize: job.request.partySize, reference: result.reference, pageUrl: result.pageUrl, policy: result.policy })
        .catch(error => log('error', 'ledger_write_failed', { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** Serializes start() so two near-simultaneous picks can't both run the cancel-then-insert and place two holds. */
  private starting: Promise<unknown> = Promise.resolve();

  /** Phase 1: open the page, hold the table, fill the form, then wait for the diner. */
  start(request: BookingRequest, venue: Venue): Promise<BookingJob> {
    const run = this.starting.then(() => this.startExclusive(request, venue));
    this.starting = run.then(() => {}, () => {});
    return run;
  }
  private async startExclusive(request: BookingRequest, venue: Venue): Promise<BookingJob> {
    // One live browser session per server: a new pick replaces a pending one and releases its hold.
    for (const entry of this.entries.values()) {
      if (entry.job.state === 'SUBMITTING') throw new ApiError(429, 'BUSY', 'A booking is being submitted right now. Wait for it to finish.');
      if (['PREPARING', 'READY'].includes(entry.job.state)) await this.finish(entry, 'CANCELLED', { status: 'CANCELLED', code: 'REPLACED', message: 'Replaced by a newer pick.' });
    }
    const id = randomUUID(); const at = this.now().toISOString();
    const job: BookingJob = { id, state: 'PREPARING', createdAt: at, updatedAt: at, steps: [], request: { venue, date: request.date, time: request.time, partySize: request.partySize, contact: request.contact } };
    const entry: Entry = { job, booker: this.options.booker((step, note) => {
      const at = this.now().toISOString();
      job.steps.push({ step, note, at }); job.updatedAt = at;
      if (note === 'human verification needed') job.verification = { requestedAt: at, expiresAt: new Date(this.now().getTime() + (this.options.humanSolveMs ?? 120_000)).toISOString() };
      if (note?.startsWith('verification passed') && job.verification) job.verification.passedAt = at;
    }, liveViewUrl => { const vAt = this.now().toISOString(); job.verification = { requestedAt: job.verification?.requestedAt ?? vAt, expiresAt: job.verification?.expiresAt ?? new Date(this.now().getTime() + Math.max(this.options.humanSolveMs ?? 0, 180_000)).toISOString(), liveViewUrl, passedAt: job.verification?.passedAt }; job.updatedAt = vAt; }, liveViewUrl => { if (liveViewUrl) { job.liveViewUrl = liveViewUrl; job.updatedAt = this.now().toISOString(); } }), timers: [] };
    this.entries.set(id, entry);
    const prepareTimer = setTimeout(() => { void this.finish(entry, 'FAILED', { status: 'FAILED', code: 'TIMEOUT', message: 'The booking browser did not finish preparing within 2 minutes. Nothing was submitted.' }); }, this.options.prepareTimeoutMs ?? 120_000);
    prepareTimer.unref?.(); entry.timers.push(prepareTimer);
    void entry.booker.prepare({ ...request, timezone: venue.timezone }).then(prepared => {
      if (job.state !== 'PREPARING') return;
      if (prepared.status !== 'READY') { void this.finish(entry, 'FAILED', { status: 'FAILED', code: prepared.code, message: prepared.message, policy: prepared.policy, pageUrl: prepared.pageUrl }); return; }
      const holdMs = Math.max(this.options.minHoldMs ?? 30_000, (prepared.holdSeconds ?? 300) * 1000 - (this.options.holdMarginMs ?? 20_000));
      job.prepared = { policy: prepared.policy, feeWarning: prepared.feeWarning, needsDiner: prepared.needsDiner, values: prepared.values, holdExpiresAt: new Date(this.now().getTime() + holdMs).toISOString() };
      for (const timer of entry.timers) clearTimeout(timer); entry.timers = [];
      this.move(entry, 'READY');
      const expiry = setTimeout(() => { void this.finish(entry, 'EXPIRED', { status: 'EXPIRED', code: 'HOLD_EXPIRED', message: 'The restaurant’s 5-minute hold lapsed before you confirmed. Pick the time again.' }); }, holdMs);
      expiry.unref?.(); entry.timers.push(expiry);
    }).catch(error => { void this.finish(entry, 'FAILED', { status: 'FAILED', code: 'UNEXPECTED', message: error instanceof Error ? error.message : 'Preparation failed.' }); });
    return job;
  }

  /** Phase 2: the diner's explicit confirmation is the only thing that presses Submit. */
  async confirm(id: string): Promise<BookingJob> {
    const entry = this.entry(id); const { job } = entry;
    if (job.state === 'EXPIRED') throw new ApiError(409, 'NOT_READY', 'The hold expired. Pick the time again.');
    if (job.state !== 'READY' || !entry.booker.ready) throw new ApiError(409, 'NOT_READY', `This booking is ${job.state.toLowerCase()}. Pick the time again.`);
    for (const timer of entry.timers) clearTimeout(timer); entry.timers = [];
    this.move(entry, 'SUBMITTING');
    void entry.booker.confirm().then(result => {
      void this.finish(entry, result.status === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED', { status: result.status, code: result.code, message: result.message, reference: result.reference, policy: result.policy, pageUrl: result.pageUrl, diagnostics: result.diagnostics });
    }).catch(error => { void this.finish(entry, 'FAILED', { status: 'FAILED', code: 'UNEXPECTED', message: error instanceof Error ? error.message : 'Confirmation failed.' }); });
    return job;
  }

  async cancel(id: string): Promise<BookingJob> {
    const entry = this.entry(id);
    if (entry.job.state === 'SUBMITTING') throw new ApiError(409, 'BUSY', 'Submit was already pressed; wait for the result.');
    await this.finish(entry, 'CANCELLED', { status: 'CANCELLED', code: 'CANCELLED', message: 'Cancelled before submitting. The hold was released.' });
    return entry.job;
  }

  /** Drops finished jobs after the retention window so memory stays flat. */
  sweep() {
    const cutoff = this.now().getTime() - (this.options.retentionMs ?? 30 * 60_000);
    for (const [id, entry] of this.entries) if (terminal.includes(entry.job.state) && Date.parse(entry.job.updatedAt) < cutoff) this.entries.delete(id);
  }

  async close() {
    clearInterval(this.sweeper);
    for (const entry of this.entries.values()) if (!terminal.includes(entry.job.state)) await this.finish(entry, entry.job.state === 'SUBMITTING' ? 'FAILED' : 'CANCELLED', { status: 'CANCELLED', code: 'SHUTDOWN', message: 'The server stopped before this booking finished.' });
  }
}
