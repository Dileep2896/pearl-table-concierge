import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
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
/** `screenshot` is only set on FAILED: the restaurant's page at the moment Pearl stopped, as evidence for the diner. */
export type PrepareResult = { status: 'READY' | 'FAILED'; code: string; message: string; policy?: string; values?: Record<string, string>; holdSeconds?: number; pageUrl?: string; pageText?: string; screenshot?: Buffer };
export type BookingResult = { status: 'CONFIRMED' | 'FAILED'; code: string; message: string; reference?: string; policy?: string; pageUrl?: string; pageText?: string; screenshot?: Buffer; response?: unknown };

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

type Session = { browser: Browser; context: BrowserContext; page: Page; bookResponse?: unknown; holdResponse?: unknown; policy: string; policyShot?: Buffer };

/**
 * Drives the public SevenRooms guest widget exactly as a diner would, in two phases.
 * prepare(): open the page, pick the time (the widget holds the table for 5 minutes), fill the four contact
 * fields, accept the cancellation policy, and stop. confirm(): press Submit once and read the confirmation.
 * It never enters payment details; if the checkout asks for a card, or the policy mentions a fee, it stops.
 */
export class SevenRoomsBooker {
  private session?: Session;
  constructor(private options: { launch?: () => Promise<Browser>; base?: string; onStep?: (step: BookingStep, note?: string) => void; headless?: boolean; requireFreeCancellation?: boolean } = {}) {}
  private step(step: BookingStep, note?: string) { this.options.onStep?.(step, note); }
  get ready() { return Boolean(this.session); }

  async prepare(request: BookingRequest): Promise<PrepareResult> {
    const input = bookingRequestSchema.parse(request);
    const base = this.options.base ?? SEVENROOMS_BASE;
    await this.close();
    this.step('OPENING');
    const browser = await (this.options.launch?.() ?? chromium.launch({ headless: this.options.headless ?? true, timeout: 20000 }));
    const context = await browser.newContext({ locale: 'en-US', timezoneId: input.timezone, viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    const session: Session = { browser, context, page, policy: '' };
    page.on('response', (response: Response) => {
      const url = response.url();
      if (!url.includes('/api-yoa/')) return;
      if (/\/hold\/add\b/.test(url)) void response.json().then(json => { session.holdResponse = json; }).catch(() => {});
      if (/\/book(?:\?|$)/.test(url) && response.request().method() === 'POST') void response.json().then(json => { session.bookResponse = json; }).catch(() => {});
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
      if (await this.asksForCard(page)) throw new BookingFailure('PAYMENT_REQUIRED', 'This restaurant asks for a card at checkout. Pearl does not enter payment details.');
      if (await page.locator('input[type="password"]').filter({ visible: true }).count() > 0) throw new BookingFailure('LOGIN_REQUIRED', 'This restaurant requires a SevenRooms login. Pearl stopped.');
      ({ text: session.policy, screenshot: session.policyShot } = await this.readPolicy(page));
      if (this.options.requireFreeCancellation !== false && session.policy && /\$\s?\d|\bfee\b|\bcharged?\b|\bdeposit\b|card on file/i.test(session.policy)) throw new BookingFailure('CANCELLATION_FEE', `This restaurant's policy mentions a fee, so Pearl did not book: "${session.policy.slice(0, 220)}"`);
      this.step('FILLING');
      await page.locator('input[name="firstName"]').fill(input.contact.firstName);
      await page.locator('input[name="lastName"]').fill(input.contact.lastName);
      await page.locator('input[name="emailAddress"]').fill(input.contact.email);
      const phone = page.locator('input[name="phoneNumber"]');
      await phone.click(); await phone.fill(''); await phone.pressSequentially(input.contact.phone.replace(/^\+?1/, '').replace(/\D/g, ''), { delay: 20 });
      const policyBox = page.locator('#agreedToBookingPolicy');
      if (await policyBox.count() > 0 && !(await policyBox.isChecked())) await policyBox.check({ force: true });
      const submit = page.locator('[data-test="checkout-button-complete"]');
      if (await submit.isDisabled()) throw new BookingFailure('SUBMIT_DISABLED', 'The widget kept Submit disabled after filling the form.');
      await page.waitForTimeout(400);
      const values = Object.fromEntries(await page.locator('input[name="firstName"], input[name="lastName"], input[name="emailAddress"], input[name="phoneNumber"]').evaluateAll(els => els.map(el => [(el as HTMLInputElement).name, (el as HTMLInputElement).value])));
      const holdSeconds = Number((session.holdResponse as { data?: { hold_duration_sec?: number } } | undefined)?.data?.hold_duration_sec) || 300;
      this.session = session;
      this.step('READY', `held ${holdSeconds}s`);
      return { status: 'READY', code: 'READY', message: 'The form is filled and the table is held. Confirm to submit.', policy: session.policy, values, holdSeconds, pageUrl: page.url() };
    } catch (error) {
      const failure = error instanceof BookingFailure ? error : new BookingFailure('BROWSER_ERROR', `The booking browser hit an error: ${(error as Error)?.message?.split('\n')[0] ?? 'unknown'}`);
      const pageText = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 800);
      // Evidence: the policy dialog itself for a fee stop, otherwise the page as it looked when Pearl stopped.
      const screenshot = failure.code === 'CANCELLATION_FEE' && session.policyShot ? session.policyShot : await page.screenshot({ type: 'png', fullPage: true, timeout: 8000 }).catch(() => undefined);
      this.step('FAILED', failure.code);
      await browser.close().catch(() => {});
      return { status: 'FAILED', code: failure.code, message: failure.message, policy: session.policy, pageUrl: page.url(), pageText, screenshot };
    }
  }

  /** Presses Submit in the prepared session. Exactly one click, then waits for the widget's answer. */
  async confirm(): Promise<BookingResult> {
    const session = this.session;
    if (!session) return { status: 'FAILED', code: 'NOT_PREPARED', message: 'Nothing is prepared to confirm. Pick a time again.' };
    const { page } = session;
    try {
      this.step('SUBMITTING');
      const submit = page.locator('[data-test="checkout-button-complete"]');
      if (await submit.isDisabled()) throw new BookingFailure('SUBMIT_DISABLED', 'The widget kept Submit disabled.');
      await submit.click();
      const outcome = await this.awaitOutcome(page, () => session.bookResponse, 40000);
      const pageText = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
      const screenshot = await page.screenshot({ type: 'png', fullPage: false, timeout: 8000 }).catch(() => undefined);
      if (outcome === 'error') throw Object.assign(new BookingFailure('WIDGET_REJECTED', 'SevenRooms did not accept the booking. The page reported an error.'), { pageText, screenshot });
      if (outcome === 'timeout') throw Object.assign(new BookingFailure('NO_CONFIRMATION', 'No confirmation appeared within 40 seconds. Check your email before retrying.'), { pageText, screenshot });
      const reference = extractReference(session.bookResponse, pageText);
      this.step('CONFIRMED', reference);
      return { status: 'CONFIRMED', code: 'CONFIRMED', message: `Reservation confirmed${reference ? ` (${reference})` : ''}. A confirmation email is on its way.`, reference, policy: session.policy, pageUrl: page.url(), pageText: pageText.slice(0, 1200), screenshot, response: session.bookResponse ?? session.holdResponse };
    } catch (error) {
      const failure = error instanceof BookingFailure ? error : new BookingFailure('BROWSER_ERROR', `The booking browser hit an error while confirming: ${(error as Error)?.message?.split('\n')[0] ?? 'unknown'}`);
      const extra = error as { pageText?: string; screenshot?: Buffer };
      this.step('FAILED', failure.code);
      return { status: 'FAILED', code: failure.code, message: failure.message, policy: session.policy, pageUrl: page.url(), pageText: extra.pageText, screenshot: extra.screenshot };
    } finally { await this.close(); }
  }

  /** Convenience for tests and scripts: prepare then confirm in one go. */
  async book(request: BookingRequest): Promise<BookingResult> {
    const prepared = await this.prepare(request);
    if (prepared.status !== 'READY') return { status: 'FAILED', code: prepared.code, message: prepared.message, policy: prepared.policy, pageUrl: prepared.pageUrl, pageText: prepared.pageText, screenshot: prepared.screenshot };
    return this.confirm();
  }

  /** Closes the browser, which also releases the widget's hold. Safe to call any time. */
  async close() { const session = this.session; this.session = undefined; await session?.browser.close().catch(() => {}); }

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
  /** Resolves 'confirmed' when the widget's book call succeeds or a confirmation page renders, 'error' on a visible failure. */
  private async awaitOutcome(page: Page, bookResponse: () => unknown, timeoutMs: number): Promise<'confirmed' | 'error' | 'timeout'> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const response = bookResponse();
      if (response && typeof response === 'object') {
        const status = (response as { status?: number }).status;
        if (status === undefined || status === 200) return 'confirmed';
        return 'error';
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
