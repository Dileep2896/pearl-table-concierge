// Playwright's local Chromium (~150 MB) is only needed for local auto-mode bookings. A deploy that books
// through Browserbase (a remote browser) or runs in handoff mode does not need it, so allow skipping the
// download with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (set for the Render build).
import { execSync } from 'node:child_process';

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' || process.env.PEARL_SKIP_BROWSER_DOWNLOAD === '1') {
  console.log('postinstall: skipping Playwright Chromium download (remote/handoff booking).');
  process.exit(0);
}

try {
  execSync('playwright install chromium', { stdio: 'inherit' });
} catch (error) {
  // A failed download should not fail the whole install; local auto-mode booking just won't work until it runs.
  console.warn('postinstall: `playwright install chromium` failed; run it manually for local auto-mode booking.', error?.message ?? error);
}
