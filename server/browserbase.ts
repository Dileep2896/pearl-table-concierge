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
  private projectId?: string;
  private sessions = new WeakMap<BrowserContext, string>();
  constructor(private options: { apiKey: string; projectId?: string; proxies?: boolean; solveCaptchas?: boolean }) {
    this.bb = new Browserbase({ apiKey: options.apiKey });
    this.projectId = options.projectId;
  }

  /** The API key alone identifies the account; the project is resolved from it once and cached. */
  private async project(): Promise<string> {
    if (this.projectId) return this.projectId;
    const projects = await this.bb.projects.list();
    const first = Array.isArray(projects) ? projects[0] : (projects as { data?: { id: string }[] }).data?.[0];
    if (!first?.id) throw new Error('Browserbase returned no projects for this API key. Check BROWSERBASE_API_KEY.');
    this.projectId = first.id;
    return this.projectId;
  }

  async context(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    const projectId = await this.project();
    const viewport = { width: options.viewport?.width ?? 430, height: options.viewport?.height ?? 900 };
    // Proxies and captcha solving are paid features. Request them only if asked; on a 402 (free plan) fall back
    // to a plain session so it still runs — though a plain datacenter session usually won't clear reCAPTCHA.
    const wantExtras = Boolean(this.options.proxies || this.options.solveCaptchas);
    const create = (extras: boolean) => this.bb.sessions.create({ projectId, ...(extras ? { proxies: Boolean(this.options.proxies) } : {}), browserSettings: { ...(extras ? { solveCaptchas: Boolean(this.options.solveCaptchas) } : {}), viewport } });
    let session;
    try {
      session = await create(wantExtras);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 402 && wantExtras) {
        log('warn', 'browserbase_no_proxies', { message: 'Proxies/captcha solving need a paid plan; retrying with a plain session (may not pass reCAPTCHA).' });
        try { session = await create(false); }
        catch (retry) { throw new Error(`Browserbase could not start a session: ${retry instanceof Error ? retry.message : String(retry)}`); }
      } else {
        throw new Error(status === 401 ? 'Browserbase rejected the credentials (401). Check BROWSERBASE_API_KEY.' : `Browserbase could not start a session: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    log('info', 'browserbase_session', { id: session.id, region: (session as { region?: string }).region });
    const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    // Browserbase hands back one ready context; close the connection (which ends the session) when we're done with it.
    const context = browser.contexts()[0] ?? await browser.newContext(options);
    this.sessions.set(context, session.id);
    context.once('close', () => { void browser.close().catch(() => {}); });
    return context;
  }

  /** Browserbase's interactive live view of the cloud browser — embeddable so the diner can tick the captcha. */
  async liveView(context: BrowserContext): Promise<string | undefined> {
    const id = this.sessions.get(context); if (!id) return undefined;
    try { const live = await this.bb.sessions.debug(id); return live.debuggerFullscreenUrl; } catch { return undefined; }
  }

  async close() { /* sessions end when their context closes */ }
}
