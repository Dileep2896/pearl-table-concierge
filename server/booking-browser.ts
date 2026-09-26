import type { BrowserContext, Page, Response } from 'playwright';
import { BrowserPool, type ContextSource } from './browser-pool';
import { log } from './logger';
import { SEVENROOMS_BASE, searchPageUrl, timeLabel, dateSchema, timeSchema } from './sevenrooms';
import { z } from 'zod/v4';

export const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(120), phone: z.string().trim().regex(/^\+?[\d\s().-]{7,20}$/, 'phone must be digits'),
});
export type Contact = z.infer<typeof contactSchema>;
export const bookingRequestSchema = z.object({ venue: z.string().regex(/^[a-z0-9]+$/), date: dateSchema, time: timeSchema, partySize: z.number().int().min(1).max(8), contact: contactSchema, timezone: z.string().min(1).max(64).default('America/New_York') });
export type BookingRequest = z.input<typeof bookingRequestSchema>;

export type BookingStep = 'OPENING' | 'SELECTING_TIME' | 'HOLDING' | 'FILLING' | 'READY' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED';
/** `screenshot` is only set on FAILED: the restaurant's page at the moment Tavola stopped, as evidence for the diner. */
export type PrepareResult = { status: 'READY' | 'FAILED'; code: string; message: string; policy?: string; /** Set when the policy mentions a cancellation fee: the diner decides whether to go ahead. */ feeWarning?: string; /** Set when the checkout needs the diner to add a card or sign in: on a remote browser they finish it in the live view. */ needsDiner?: 'card' | 'login'; values?: Record<string, string>; holdSeconds?: number; pageUrl?: string; pageText?: string; screenshot?: Buffer };
/** What happened on the wire after Submit: enough to explain a rejection without re-running it. */
export type SubmitDiagnostics = { finalUrl: string; requests: { method: string; url: string; status?: number; body?: string; failure?: string }[]; console: string[]; pageText: string };
export type BookingResult = { status: 'CONFIRMED' | 'FAILED'; code: string; message: string; reference?: string; policy?: string; pageUrl?: string; pageText?: string; screenshot?: Buffer; response?: unknown; diagnostics?: SubmitDiagnostics };

export class BookingFailure extends Error { constructor(public code: string, message: string) { super(message); this.name = 'BookingFailure'; } }

/** Looks for a confirmation/reference code in the widget's booking response or the page text. */
export function extractReference(source: unknown, pageText = ''): string | undefined {
  const found: string[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 6) return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/reference|confirmation|conf_code|confcode/i.test(key) && typeof entry === 'string' && entry.length >= 3) found.push(entry);
      walk(entry, depth + 1);
    }
  };
  walk(source);
  if (found[0]) return found[0];
  const text = pageText.match(/(?:confirmation|reference)\s*(?:#|number|code|no\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i);
  return text?.[1];
}

type Session = { context: BrowserContext; page: Page; bookResponse?: unknown; bookStatus?: number; holdResponse?: unknown; policy: string; policyShot?: Buffer; /** Set when the diner must finish a card or login step in the live view. */ needsDiner?: 'card' | 'login' };

/**
 * Drives the public SevenRooms guest widget exactly as a diner would, in two phases.
 * prepare(): open the page, pick the time (the widget holds the table for 5 minutes), fill the four contact
 * fields, accept the cancellation policy, and stop. confirm(): press Submit once and read the confirmation.
 * It never enters payment details; if the checkout asks for a card, or the policy mentions a fee, it stops.
 */
export class SevenRoomsBooker {
  private session?: Session;
  constructor(private options: { contexts?: ContextSource; base?: string; onStep?: (step: BookingStep, note?: string) => void; requireFreeCancellation?: boolean; /** In a headed browser: how long to wait for a person to pass a visible captcha. */ humanSolveMs?: number; /** True for a remote browser (Browserbase/CDP). */ remote?: boolean; /** Interactive live-view URL for the remote browser, so the diner can tick the captcha in-app. */ liveView?: (context: BrowserContext) => Promise<string | undefined>; /** Reports the live-view URL when human verification starts. */ onVerification?: (liveViewUrl?: string) => void; /** Reports the live-view URL as soon as the remote browser is up, so the diner can watch. */ onLiveView?: (liveViewUrl?: string) => void } = {}) {}
  private get contexts(): ContextSource { return this.options.contexts ?? (this.options.contexts = new BrowserPool()); }
  private step(step: BookingStep, note?: string) { this.options.onStep?.(step, note); }
  get ready() { return Boolean(this.session); }

  async prepare(request: BookingRequest): Promise<PrepareResult> {
    const input = bookingRequestSchema.parse(request);
    const base = this.options.base ?? SEVENROOMS_BASE;
    await this.close();
    this.step('OPENING');
    const started = performance.now();
    const context = await this.contexts.context({ locale: 'en-US', timezoneId: input.timezone, viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
    // Reuse the browser's existing tab so a remote live view is watching the page Tavola actually drives.
    const page = context.pages()[0] ?? await context.newPage(); page.setDefaultTimeout(15000);
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    const session: Session = { context, page, policy: '' };
    // Surface the remote live view immediately so the diner watches Tavola fill the form.
    if (this.options.remote && this.options.liveView && this.options.onLiveView) void this.options.liveView(context).then(u => this.options.onLiveView?.(u)).catch(() => {});
    page.on('response', (response: Response) => {
      const url = response.url();
      if (!/sevenrooms\.com/.test(url)) return;
      if (/\/hold\/add\b/.test(url)) void response.json().then(json => { session.holdResponse = json; }).catch(() => {});
      // The booking call lives under /booking/dining/widget/<id>/book, not /api-yoa.
      if (/\/book(?:\?|$)/.test(url) && response.request().method() === 'POST') { session.bookStatus = response.status(); void response.text().then(text => { try { session.bookResponse = JSON.parse(text); } catch { session.bookResponse = { raw: text.slice(0, 300) }; } }).catch(() => { session.bookResponse = {}; }); }
    });
    try {
      await page.goto(searchPageUrl(input.venue, input.date, input.partySize, input.time, base), { waitUntil: 'domcontentloaded', timeout: 30000 });
      const label = timeLabel(input.time);
      this.step('SELECTING_TIME', label);
      await page.locator('button[data-time]').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => { throw new BookingFailure('NO_TIMES', 'The restaurant page did not show any times for that date.'); });
      const slot = page.locator(`button[data-time="${label}"]`).first();
      if (await slot.count() === 0) throw new BookingFailure('SLOT_GONE', `${label} is no longer offered on that date. Pick another time.`);
      await slot.click();
      const select = page.getByRole('button', { name: /^select$/i }).first();
      const checkout = page.locator('[data-test="checkout-button-complete"]');
      await Promise.race([select.waitFor({ state: 'visible', timeout: 12000 }), checkout.waitFor({ state: 'visible', timeout: 12000 })]).catch(() => { throw new BookingFailure('NO_CHECKOUT', 'The widget did not open the checkout after selecting the time.'); });
      this.step('HOLDING');
      if (await select.isVisible().catch(() => false)) await select.click();
      await checkout.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new BookingFailure('NO_CHECKOUT', 'The checkout form did not appear. The table may have just been taken.'); });
      // A cancellation fee is a heads-up, not a wall: unless strict mode is set, prepare the table and let the diner decide at confirm.
      ({ text: session.policy, screenshot: session.policyShot } = await this.readPolicy(page));
      const hasFee = Boolean(session.policy) && /\$\s?\d|\bfee\b|\bcharged?\b|\bdeposit\b|card on file/i.test(session.policy);
      if (hasFee && this.options.requireFreeCancellation === true) throw new BookingFailure('CANCELLATION_FEE', 'This restaurant charges a cancellation fee, so Tavola stopped before booking.');
      const feeWarning = hasFee ? session.policy : undefined;
      // A login replaces the guest form, so detect it before filling. A card is an extra field alongside the
      // guest form, so fill first — then a card-required venue only needs the card itself from the diner.
      const loginNeeded = (await page.locator('input[type="password"]').filter({ visible: true }).count()) > 0;
      this.step('FILLING');
      if (!loginNeeded) await this.fillGuestForm(page, input.contact);
      const needsDiner: 'card' | 'login' | undefined = loginNeeded ? 'login' : (await this.asksForCard(page)) ? 'card' : undefined;
      const values = Object.fromEntries(await page.locator('input[name="firstName"], input[name="lastName"], input[name="emailAddress"], input[name="phoneNumber"]').evaluateAll(els => els.map(el => [(el as HTMLInputElement).name, (el as HTMLInputElement).value])));
      const holdSeconds = Number((session.holdResponse as { data?: { hold_duration_sec?: number } } | undefined)?.data?.hold_duration_sec) || 300;
      if (needsDiner) {
        // On a remote browser (Browserbase) the diner finishes the card/login in the embedded live view and Tavola
        // records the result. Locally there is no in-app browser, so Tavola stops and offers the SevenRooms handoff.
        if (!(this.options.remote && this.options.liveView)) throw new BookingFailure(needsDiner === 'card' ? 'PAYMENT_REQUIRED' : 'LOGIN_REQUIRED', needsDiner === 'card' ? 'This restaurant asks for a card at checkout. Tavola does not enter payment details.' : 'This restaurant requires a SevenRooms login. Tavola stopped.');
        session.needsDiner = needsDiner;
        this.session = session;
        void this.options.liveView(session.context).then(u => this.options.onLiveView?.(u)).catch(() => {});
        log('info', 'booking_prepared_needs_diner', { venue: input.venue, needsDiner, ms: Math.round(performance.now() - started), holdSeconds });
        this.step('READY', `needs ${needsDiner}`);
        const message = needsDiner === 'card'
          ? 'This restaurant asks for a card at checkout. Tavola filled everything else — add your card in the live browser above and book there, then Tavola records the confirmation.'
          : 'This restaurant needs a SevenRooms sign-in. Do it in the live browser above and book there — Tavola records the confirmation.';
        return { status: 'READY', code: 'READY', message, policy: session.policy, feeWarning, needsDiner, values, holdSeconds, pageUrl: page.url() };
      }
      const submit = page.locator('[data-test="checkout-button-complete"]');
      if (await submit.isDisabled()) throw new BookingFailure('SUBMIT_DISABLED', 'The widget kept Submit disabled after filling the form.');
      await page.waitForTimeout(400);
      this.session = session;
      log('info', 'booking_prepared', { venue: input.venue, ms: Math.round(performance.now() - started), holdSeconds });
      this.step('READY', `held ${holdSeconds}s`);
      return { status: 'READY', code: 'READY', message: 'The form is filled and the table is held. Confirm to submit.', policy: session.policy, feeWarning, values, holdSeconds, pageUrl: page.url() };
    } catch (error) {
      const failure = error instanceof BookingFailure ? error : new BookingFailure('BROWSER_ERROR', `The booking browser hit an error: ${(error as Error)?.message?.split('\n')[0] ?? 'unknown'}`);
      const pageText = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 800);
      // Evidence: the policy dialog itself for a fee stop, otherwise the page as it looked when Tavola stopped.
      const screenshot = failure.code === 'CANCELLATION_FEE' && session.policyShot ? session.policyShot : await page.screenshot({ type: 'png', fullPage: true, timeout: 8000 }).catch(() => undefined);
      this.step('FAILED', failure.code);
      log('info', 'booking_stopped', { venue: input.venue, code: failure.code, ms: Math.round(performance.now() - started) });
      await context.close().catch(() => {});
      return { status: 'FAILED', code: failure.code, message: failure.message, policy: session.policy, pageUrl: page.url(), pageText, screenshot };
    }
  }

  /** Presses Submit in the prepared session. Exactly one click, then waits for the widget's answer. */
  async confirm(): Promise<BookingResult> {
    const session = this.session;
    if (!session) return { status: 'FAILED', code: 'NOT_PREPARED', message: 'Nothing is prepared to confirm. Pick a time again.' };
    const { page } = session;
    // Record what the widget does after Submit, so a rejection can be explained from the job alone.
    const diagnostics: SubmitDiagnostics = { finalUrl: '', requests: [], console: [], pageText: '' };
    const onRequest = (request: import('playwright').Request) => { if (request.method() !== 'GET' && /sevenrooms|recaptcha/.test(request.url())) diagnostics.requests.push({ method: request.method(), url: request.url().slice(0, 160) }); };
    const onResponse = async (response: Response) => {
      const entry = diagnostics.requests.find(r => r.url === response.url().slice(0, 160) && r.status === undefined); if (!entry) return;
      entry.status = response.status();
      if (/sevenrooms\.com\/api-yoa/.test(response.url())) entry.body = (await response.text().catch(() => '')).slice(0, 400);
    };
    const onFailed = (request: import('playwright').Request) => { const entry = diagnostics.requests.find(r => r.url === request.url().slice(0, 160) && r.status === undefined); if (entry) entry.failure = request.failure()?.errorText; };
    const onConsole = (message: import('playwright').ConsoleMessage) => { if (['error', 'warning'].includes(message.type())) diagnostics.console.push(message.text().slice(0, 200)); };
    page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onFailed); page.on('console', onConsole);
    try {
      // A card- or login-required venue: Tavola filled everything it can, and the diner completes the sensitive
      // step in the live view (adds the card / signs in, then books). Tavola never presses Submit here — it
      // watches the same session for the widget's confirmation and records it.
      if (session.needsDiner) {
        const liveViewUrl = this.options.remote && this.options.liveView ? await this.options.liveView(session.context).catch(() => undefined) : undefined;
        this.step('SUBMITTING', session.needsDiner === 'card' ? 'add your card in the live browser and book' : 'sign in and book in the live browser');
        this.options.onVerification?.(liveViewUrl);
        const budget = Math.max(this.options.humanSolveMs ?? 0, 180_000);
        log('info', 'booking_diner_finishing', { needsDiner: session.needsDiner, ms: budget, liveView: Boolean(liveViewUrl) });
        const outcome = await this.awaitOutcome(page, session, budget);
        const pageText = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
        diagnostics.finalUrl = page.url(); diagnostics.pageText = pageText.slice(0, 1500);
        if (outcome !== 'confirmed') throw new BookingFailure(session.needsDiner === 'card' ? 'PAYMENT_REQUIRED' : 'LOGIN_REQUIRED', session.needsDiner === 'card' ? 'Tavola did not see a confirmation after the card step. Nothing was booked. Finish on SevenRooms if the browser above did not complete it.' : 'Tavola did not see a confirmation after the sign-in step. Nothing was booked. Finish on SevenRooms if needed.');
        const dinerRef = extractReference(session.bookResponse, pageText) ?? (/is_success=true/.test(page.url()) ? 'confirmed' : undefined);
        this.step('CONFIRMED', dinerRef);
        return { status: 'CONFIRMED', code: 'CONFIRMED', message: `Reservation confirmed${dinerRef ? ` (${dinerRef})` : ''}. A confirmation email is on its way.`, reference: dinerRef, policy: session.policy, pageUrl: page.url(), pageText: pageText.slice(0, 1200), response: session.bookResponse ?? session.holdResponse, diagnostics };
      }
      this.step('SUBMITTING');
      const submit = page.locator('[data-test="checkout-button-complete"]');
      if (await submit.isDisabled()) throw new BookingFailure('SUBMIT_DISABLED', 'The widget kept Submit disabled.');
      await submit.click();
      let outcome = await this.awaitOutcome(page, session, 40000);
      // reCAPTCHA Enterprise rejects automated browsers on the first try and then shows a checkbox. In a
      // visible window a person can tick it; Tavola watches for the solved token and presses Submit again.
      if (outcome === 'error' && this.options.humanSolveMs && diagnostics.console.some(line => /recaptcha.*validation failed/i.test(line))) {
        await page.waitForTimeout(1500);
        // Remote browser (Browserbase): the solve arrives in the background — wait for the token and resubmit.
        // Local browser: only wait if a checkbox is actually on screen for the diner to tick.
        if (this.options.remote || await this.checkboxShowing(page)) {
          // Remote (Browserbase): the diner ticks the checkbox in an embedded live view. Local: reveal the window.
          const liveViewUrl = this.options.remote && this.options.liveView ? await this.options.liveView(session.context).catch(() => undefined) : undefined;
          this.step('SUBMITTING', 'human verification needed');
          this.options.onVerification?.(liveViewUrl);
          log('info', 'booking_captcha_waiting', { ms: this.options.humanSolveMs, remote: Boolean(this.options.remote), liveView: Boolean(liveViewUrl) });
          if (!this.options.remote) {
            await this.revealWindow(session).catch(() => {});
            await page.bringToFront().catch(() => {});
            await page.locator('iframe[src*="recaptcha"][src*="anchor"][src*="size=normal"]').first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          }
          outcome = await this.humanVerification(page, session, submit, this.options.humanSolveMs);
        }
      }
      const pageText = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
      diagnostics.finalUrl = page.url(); diagnostics.pageText = pageText.slice(0, 1500);
      const screenshot = await page.screenshot({ type: 'png', fullPage: true, timeout: 8000 }).catch(() => undefined);
      log('info', 'booking_submitted', { outcome, bookStatus: session.bookStatus, finalUrl: diagnostics.finalUrl, requests: diagnostics.requests.map(r => `${r.method} ${r.url.replace(/^https:\/\/www\.sevenrooms\.com/, '')} → ${r.status ?? r.failure ?? '…'}`), console: diagnostics.console.slice(0, 5) });
      const serverSaid = (() => { const r = session.bookResponse as { msg?: string; message?: string; errors?: unknown; raw?: string } | undefined; return r?.msg || r?.message || (r?.errors ? JSON.stringify(r.errors).slice(0, 200) : '') || r?.raw || ''; })();
      const captchaRejected = diagnostics.console.some(line => /recaptcha.*validation failed/i.test(line));
      if (outcome === 'captcha') throw Object.assign(new BookingFailure('CAPTCHA_UNSOLVED', 'SevenRooms asked for a human verification and nobody completed it in time. Nothing was booked. Pick the time again and tick the checkbox in the browser window when it appears.'), { pageText, screenshot });
      if (outcome === 'error') throw Object.assign(new BookingFailure(captchaRejected ? 'CAPTCHA_REJECTED' : 'WIDGET_REJECTED', captchaRejected ? `SevenRooms' reCAPTCHA rejected this automated browser (HTTP ${session.bookStatus}). Nothing was booked.${this.options.humanSolveMs ? '' : ' Run the API without TAVOLA_HEADLESS so a person can pass the checkbox in the browser window.'}` : `SevenRooms did not accept the booking (HTTP ${session.bookStatus ?? '?'}${serverSaid ? `: ${serverSaid}` : ''}). Nothing was booked.`), { pageText, screenshot });
      if (outcome === 'timeout') throw Object.assign(new BookingFailure('NO_CONFIRMATION', 'No confirmation appeared within 40 seconds. Check your email before retrying.'), { pageText, screenshot });
      const reference = extractReference(session.bookResponse, pageText) ?? (/is_success=true/.test(page.url()) ? 'confirmed' : undefined);
      this.step('CONFIRMED', reference);
      return { status: 'CONFIRMED', code: 'CONFIRMED', message: `Reservation confirmed${reference ? ` (${reference})` : ''}. A confirmation email is on its way.`, reference, policy: session.policy, pageUrl: page.url(), pageText: pageText.slice(0, 1200), screenshot, response: session.bookResponse ?? session.holdResponse, diagnostics };
    } catch (error) {
      const failure = error instanceof BookingFailure ? error : new BookingFailure('BROWSER_ERROR', `The booking browser hit an error while confirming: ${(error as Error)?.message?.split('\n')[0] ?? 'unknown'}`);
      const extra = error as { pageText?: string; screenshot?: Buffer };
      if (!diagnostics.finalUrl) { diagnostics.finalUrl = page.url(); diagnostics.pageText = (extra.pageText ?? '').slice(0, 1500); }
      this.step('FAILED', failure.code);
      return { status: 'FAILED', code: failure.code, message: failure.message, policy: session.policy, pageUrl: page.url(), pageText: extra.pageText, screenshot: extra.screenshot, diagnostics };
    } finally { page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed); page.off('console', onConsole); await this.close(); }
  }

  /** Convenience for tests and scripts: prepare then confirm in one go. */
  async book(request: BookingRequest): Promise<BookingResult> {
    const prepared = await this.prepare(request);
    if (prepared.status !== 'READY') return { status: 'FAILED', code: prepared.code, message: prepared.message, policy: prepared.policy, pageUrl: prepared.pageUrl, pageText: prepared.pageText, screenshot: prepared.screenshot };
    return this.confirm();
  }

  /** Moves the (off-screen) booking window into view so the diner can pass the checkbox. */
  private async revealWindow(session: Session) {
    const cdp = await session.context.newCDPSession(session.page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget') as { windowId: number };
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 80, width: 460, height: 940, windowState: 'normal' } });
    await cdp.detach().catch(() => {});
  }

  /** Closes this booking's browser context, which also releases the widget's hold. Safe to call any time. */
  async close() { const session = this.session; this.session = undefined; await session?.context.close().catch(() => {}); }

  /** Fills the four guest fields and accepts the cancellation policy on the checkout form. */
  private async fillGuestForm(page: Page, contact: Contact) {
    await page.locator('input[name="firstName"]').fill(contact.firstName);
    await page.locator('input[name="lastName"]').fill(contact.lastName);
    await page.locator('input[name="emailAddress"]').fill(contact.email);
    const phone = page.locator('input[name="phoneNumber"]');
    await phone.click(); await phone.fill(''); await phone.pressSequentially(contact.phone.replace(/^\+?1/, '').replace(/\D/g, ''), { delay: 20 });
    const policyBox = page.locator('#agreedToBookingPolicy');
    if (await policyBox.count() > 0 && !(await policyBox.isChecked())) {
      await policyBox.check({ force: true, timeout: 4000 }).catch(async () => {
        // Remote browsers sometimes don't register .check(); click the box directly, then via JS as a last resort.
        await policyBox.click({ force: true, timeout: 3000 }).catch(() => {});
        if (!(await policyBox.isChecked().catch(() => true))) await policyBox.evaluate((el: HTMLInputElement) => { if (!el.checked) el.click(); }).catch(() => {});
      });
    }
  }
  /**
   * Stripe.js mounts hidden utility iframes on every SevenRooms checkout, so only a rendered card frame
   * (or visible card / postal-code inputs) means the venue actually wants a card.
   */
  private async asksForCard(page: Page) {
    const frames = await page.locator('iframe[src*="stripe.com"], iframe[src*="freedompay"], iframe[title*="card" i], iframe[title*="payment" i]').evaluateAll(els => els.filter(el => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 40; }).length);
    if (frames > 0) return true;
    return await page.locator('input[autocomplete^="cc-"], input[name*="cardNumber" i], input[name="postalCode"], input[placeholder*="card number" i]').filter({ visible: true }).count() > 0;
  }
  /** Opens the policy dialog if the widget offers one, reads it, photographs it, and closes it again. */
  private async readPolicy(page: Page): Promise<{ text: string; screenshot?: Buffer }> {
    const info = page.locator('[data-test="agreement-term-info-button"]').first();
    if (await info.count() === 0) return { text: '' };
    try {
      await info.click({ timeout: 3000 });
      const dialog = page.locator('[role="dialog"]').last();
      await dialog.waitFor({ state: 'visible', timeout: 3000 });
      const text = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
      const screenshot = await page.screenshot({ type: 'png', fullPage: false, timeout: 5000 }).catch(() => undefined);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      return { text: text.replace(/^(?:Cancellation|Marketing) Policy\s*/i, '').slice(0, 600), screenshot };
    } catch { return { text: '' }; }
  }
  /** True when reCAPTCHA has switched from its invisible badge to the "I'm not a robot" checkbox. */
  private async checkboxShowing(page: Page) {
    return page.locator('iframe[src*="recaptcha"][src*="anchor"][src*="size=normal"]').evaluateAll(els => els.some(el => { const r = el.getBoundingClientRect(); return r.width > 150 && r.height > 40 && getComputedStyle(el).visibility !== 'hidden'; })).catch(() => false);
  }
  /**
   * Waits for a person to complete the visible checkbox. When the token appears, presses Submit again; if the
   * person pressed it themselves, the book response arrives on its own. Ends on success, a final rejection, or timeout.
   */
  private async humanVerification(page: Page, session: Session, submit: import('playwright').Locator, timeoutMs: number): Promise<'confirmed' | 'error' | 'captcha' | 'timeout'> {
    const end = Date.now() + timeoutMs; let pressed = false;
    session.bookStatus = undefined; session.bookResponse = undefined;
    while (Date.now() < end) {
      if (session.bookStatus !== undefined) return session.bookStatus < 400 ? 'confirmed' : 'error';
      if (!pressed) {
        const token = await page.evaluate(() => { try { return (window as any).grecaptcha?.enterprise?.getResponse() || ''; } catch { return ''; } }).catch(() => '');
        if (token) { pressed = true; log('info', 'booking_captcha_solved'); this.step('SUBMITTING', 'verification passed, submitting'); await submit.click().catch(() => {}); }
      }
      const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      if (/reservation (?:is )?confirmed|you're all set|you’re all set|booking confirmed/i.test(text) || /confirmation|confirmed|success/i.test(page.url())) return 'confirmed';
      await page.waitForTimeout(500);
    }
    return 'captcha';
  }
  /**
   * Resolves 'confirmed' when the widget's book call succeeds or a confirmation page renders, 'error' when the
   * server rejects it.
   */
  private async awaitOutcome(page: Page, session: Session, timeoutMs: number): Promise<'confirmed' | 'error' | 'captcha' | 'timeout'> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (session.bookStatus !== undefined && session.bookResponse !== undefined) {
        // The HTTP status decides. A numeric `status` in the body can only make a 2xx worse, never better.
        const bodyStatus = (session.bookResponse as { status?: unknown }).status;
        const bodyRejects = typeof bodyStatus === 'number' && bodyStatus >= 400;
        return session.bookStatus < 400 && !bodyRejects ? 'confirmed' : 'error';
      }
      const url = page.url();
      if (/confirmation|confirmed|success/i.test(url)) return 'confirmed';
      const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      if (/reservation (?:is )?confirmed|you're all set|you’re all set|booking confirmed|see you (?:on|at)/i.test(text)) return 'confirmed';
      if (/no longer available|something went wrong|unable to complete|could not be completed|try again later|verify you are human|captcha/i.test(text)) return 'error';
      await page.waitForTimeout(500);
    }
    return 'timeout';
  }
}
