import { chromium, type BrowserContext, type BrowserContextOptions } from 'playwright';
import Browserbase from '@browserbasehq/sdk';
import type { ContextSource } from './browser-pool';
import { log } from './logger';

/**
 * A remote browser per booking on Browserbase: a fresh session with proxies and captcha solving,
 * connected over CDP. This is what lets auto mode (Pearl fills and submits) run on a deployed server —
 * Browserbase supplies the residential IP and solves the reCAPTCHA challenge in the background.
 */
export class BrowserbaseSource implements ContextSource {
  private bb: Browserbase;
  constructor(private options: { apiKey: string; projectId: string; proxies?: boolean; solveCaptchas?: boolean }) {
    this.bb = new Browserbase({ apiKey: options.apiKey });
  }

  async context(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    let session;
    try {
      session = await this.bb.sessions.create({
        projectId: this.options.projectId,
        proxies: this.options.proxies ?? true,
        browserSettings: {
          solveCaptchas: this.options.solveCaptchas ?? true,
          viewport: { width: options.viewport?.width ?? 430, height: options.viewport?.height ?? 900 },
        },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new Error(status === 401 ? 'Browserbase rejected the credentials (401). Check BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.' : `Browserbase could not start a session: ${error instanceof Error ? error.message : String(error)}`);
    }
    log('info', 'browserbase_session', { id: session.id, region: (session as { region?: string }).region });
    const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    // Browserbase hands back one ready context; close the connection (which ends the session) when we're done with it.
    const context = browser.contexts()[0] ?? await browser.newContext(options);
    context.once('close', () => { void browser.close().catch(() => {}); });
    return context;
  }

  async close() { /* sessions end when their context closes */ }
}
