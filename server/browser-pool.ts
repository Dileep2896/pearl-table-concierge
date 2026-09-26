import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { log } from './logger';

export interface ContextSource { context(options?: BrowserContextOptions): Promise<BrowserContext>; }

/**
 * One Chromium process for the whole server, launched on first use and relaunched if it dies.
 * Each booking gets its own isolated context (cookies, storage), which costs ~100 ms instead of the
 * ~1.5 s a fresh browser launch costs, and keeps memory flat under repeated bookings.
 */
export class BrowserPool implements ContextSource {
  private browser?: Promise<Browser>;
  private open = 0;
  constructor(private options: { launch?: () => Promise<Browser>; headless?: boolean; /** e.g. 'chrome' to use the installed Google Chrome instead of Playwright's Chromium. */ channel?: string; args?: string[] } = {}) {}

  private async browserInstance(): Promise<Browser> {
    const current = this.browser ? await this.browser.catch(() => undefined) : undefined;
    if (current?.isConnected()) return current;
    this.browser = (this.options.launch ?? (() => chromium.launch({ headless: this.options.headless ?? true, channel: this.options.channel, args: this.options.args, timeout: 20_000 })))();
    const browser = await this.browser;
    browser.once('disconnected', () => { log('warn', 'browser_disconnected'); if (this.browser) this.browser = undefined; });
    log('info', 'browser_launched', { version: browser.version(), headless: this.options.headless ?? true, channel: this.options.channel ?? 'chromium' });
    return browser;
  }

  async context(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    const browser = await this.browserInstance();
    const context = await browser.newContext(options);
    this.open += 1;
    context.once('close', () => { this.open = Math.max(0, this.open - 1); });
    return context;
  }

  status() { return { launched: Boolean(this.browser), openContexts: this.open }; }

  async close() {
    const browser = this.browser ? await this.browser.catch(() => undefined) : undefined;
    this.browser = undefined;
    await browser?.close().catch(() => {});
  }
}
