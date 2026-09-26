# Pearl table concierge — what we built, and the answers to the hard questions

*Demo write-up, 26 September 2026. Companion to the running app in `.`.*

## The assignment

> Build a restaurant reservation agent with a simple chat UI on the reservation platform of your choice. The user asks ("table for 2 in the West Village Friday, 7–9pm"), the agent finds real availability on at least one platform, shows all open times, and books one after the user confirms.

## What we built

A web chat where a diner types a request in plain language, sees every open table in their window at real restaurants, taps one, reviews what will be submitted, and confirms. The reservation is real: the restaurant emails the confirmation.

**Platform: SevenRooms.** Its public reservation widget exposes availability with no key, no login and no bot wall, and its guest checkout can be driven by a headless browser exactly as a person would. Nothing in the pipeline is paid.

**Flow, end to end**

1. **Understand.** The message goes through a deterministic parser (dates, time windows, party size, neighbourhood). When Codex is available it also goes to the model for a natural reply and looser phrasing; the model's answer is validated and merged over the parser's, so a bad model answer can never break a turn.
2. **Find tables.** If the diner named one time ("at 7"), Pearl picks the closest bookable table at each restaurant and the diner only chooses the restaurant; a window ("7–9pm") shows every open time. One HTTP GET per venue to SevenRooms' widget endpoint, fanned out with at most six in flight and cached for 20 seconds, so a repeated question costs nothing. Bookable and request-only slots are shown separately.
3. **Prepare.** On tap, an isolated context in the server's single shared Chromium opens the restaurant's own page, selects the time (the widget holds the table for 5 minutes), reads the cancellation policy, checks for card fields, and fills the guest form from a locally stored profile. It stops there.
4. **Confirm.** The page shows what was filled, the policy and a hold countdown, with Confirm and Cancel. Only Confirm presses the restaurant's Submit. SevenRooms' reCAPTCHA Enterprise rejects that first press from any automated browser (HTTP 400, "ReCaptcha server-side validation failed") and swaps in an "I'm not a robot" checkbox, so the booking browser stays visible: the diner ticks the box, Pearl detects the token and presses Submit again. Cancel releases the hold.

**Services.** The server is a small set of single-purpose modules: a booking state machine with an explicit transition table (`jobs.ts`), a browser pool (`browser-pool.ts`), a cached availability service, a Codex queue that serialises and caches model calls, a bookings ledger on disk, and one typed config. The HTTP layer only translates requests into service calls; every error has a stable code, every request a log line with an id and a timing. `AUDIT.md` records the review that produced this shape.

**Guardrails.** Pearl never enters payment details, refuses venues whose policy mentions a fee or a card on file, never books without the explicit confirm click, and every browser step has a timeout so nothing can hang. When it stops, it shows a screenshot of the restaurant's page at that moment (the policy dialog, the card form) as evidence of what it saw and why it refused, with a link to the live page.

**Coverage.** 21 validated venues: New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Anywhere else is refused with a clear message rather than a fallback.

## How we got here

- **OpenTable was the first target and failed.** Its Akamai edge refuses headless Chromium at the protocol level (`ERR_HTTP2_PROTOCOL_ERROR` in under a second), and even a headed browser gets an interstitial challenge and then a hard 403. Every free "fix" is bot-detection evasion: stealth-patched browsers, residential proxies, captcha solvers. Fragile, against the terms, and it would sign into users' accounts through proxies. Cut.
- **Apify was the paid shortcut.** $0.05 per availability check, $3.99 per booking, plus an OpenTable one-time-code login. Fine for a company, wrong for a demo that should cost nothing. Cut.
- **Yelp and Tock** are partner-only or Cloudflare-walled. **Resy** works through a reverse-engineered API but needs a personal login token and often a card on file. Parked.
- **SevenRooms** had everything: a public availability endpoint, a guest checkout, real West Village restaurants, and an open-source precedent (PolyAI's Dishoom booker) proving a headless submit works.

## Tokens: how the demo stays cheap and fast

Every chat turn that the parser handles alone costs zero model tokens. Measured on the actual prompt the demo builds (4 characters per token):

| Turn | Prompt | Schema | Reply | Total |
|---|---|---|---|---|
| First message | ~540 | ~190 | ~55 | ~780 tokens |
| 12 messages in | ~920 | ~190 | ~55 | ~1,165 tokens |

About 600 of those tokens are fixed instructions repeated every turn.

**Three levers, in order of payoff**

1. **Parser first, model only when needed.** Well-formed requests, which is most of a demo, never reach the model. Zero tokens, 0.2 ms.
2. **Prompt caching** on the fixed instructions. Cached reads bill at about a tenth of input price, cutting a Sonnet 5 turn from ~$0.0025 to ~$0.0014.
3. **Right-sized model.** This is extraction, not reasoning. Haiku 4.5 handles it at half the Sonnet price.

Today the model path runs through the Codex CLI on a subscription, so the metered cost is $0 and the saving is latency: 0.2 ms versus ~8 s per turn.

## The five questions

### Cost: what does one search or booking cost? At 10,000 users? Where does the money go?

| Item | Marginal cost | Notes |
|---|---|---|
| One search | $0 | 6–12 HTTP GETs to a public endpoint, ~0.5–0.8 s |
| One booking | ~$0.002 of compute | ~8 s of a shared headless Chromium; one browser serves every booking |
| One chat turn, parser | $0 | |
| One chat turn, Sonnet 5 metered | ~$0.0025 (~$0.0014 cached) | Haiku 4.5 about half; Opus 5 about 2.5× |

**At 10,000 users** (assume 4 conversations and 2 bookings per user per month, 5 turns each, 40% of turns needing the model):

| Line | Monthly |
|---|---|
| Model tokens (Sonnet 5, cached) | ~$115 |
| Browser workers for 20,000 bookings (~55 browser-hours) | one $40–80 VM, or ~$30 of serverless containers |
| Availability calls | $0 (but see rate limiting under Breakage) |
| Hosting, DB, monitoring | ~$50–100 |
| **Total infrastructure** | **~$250–300** |

**Where the money really goes** is people, not infrastructure: someone has to watch for widget changes, validate venues, and handle the bookings that fail. That is why the Breakage answer matters more than the Cost answer. If the platform pushes back, the next cost line is either a partnership fee or a proxy bill, and both dwarf the numbers above.

### Time: how long from ask → times → booked? Fast enough for a hot table that releases at 10:00:00?

Measured today on a laptop:

| Step | Parser path | Codex path |
|---|---|---|
| Understand the message | 0.2 ms | ~8 s |
| Find tables across 6 venues | 0.5–0.8 s | same |
| Tap → form filled, table held | ~4–5 s (shared browser, no launch cost) | same |
| Confirm → restaurant's response | ~3 s when reCAPTCHA accepts; plus one tick from the diner when it shows the checkbox | same |
| **Ask → times** | **under 1 s** | **~9 s** |
| **Ask → booked, with a human confirming** | **~12 s plus the human** | **~22 s plus the human** |

**Hot tables: not yet.** A 10:00:00 release is a race against people who have the page open and against bots that call the hold endpoint directly. Our tap-to-hold path is ~6 s because it renders the page and clicks like a person. Two upgrades would make it competitive: poll the availability endpoint at ~1 Hz from 09:59:50 and call the widget's `hold/add` endpoint directly the moment a slot appears (PolyAI reports ~1.5 s bookings this way), then fill and submit in a pre-warmed browser. The confirm step stays human unless the diner pre-authorises the booking in advance, which is a product decision, not a technical one.

### Breakage: what happens when the platform changes or blocks you? How would you know?

**What breaks, and what the diner sees**

| Change | Effect | Diner sees |
|---|---|---|
| Widget selectors change (`data-time`, `checkout-button-complete`, input names) | Prepare fails at that step | "The widget did not open the checkout" or "no times shown"; no hold, no booking |
| New required field (birthday, postcode) | Submit disabled or rejected | `SUBMIT_DISABLED` / `WIDGET_REJECTED`; nothing booked |
| reCAPTCHA rejects the automated submit (it does, every time) | First Submit gets HTTP 400, a checkbox appears | `CAPTCHA_REJECTED` when the browser is hidden; in a visible window the panel asks the diner to tick the box and Pearl resubmits. `CAPTCHA_UNSOLVED` if nobody does within two minutes |
| Availability endpoint changes shape | Zod parse throws | Venue shows "could not check"; others still work |
| Rate limiting or IP block | 4xx/5xx from the endpoint | Venues show "could not check"; bookings fail at open |
| Restaurant leaves SevenRooms | Slug returns 400 | Venue shows "could not check" until removed |

Every failure is a named code at a named step, logged as a structured JSON event with a request id, and nothing is ever submitted on a failure path. `GET /api/health` reports the browser pool, the Codex queue and job counts, so readiness can be checked before a demo. Availability failures are not cached, so a blip clears on the next turn.

**How we'd know before a diner does.** Today: only from those logs. V2, and cheap: a canary that runs every hour per venue: fetch availability, open the checkout in dry-run mode, verify the four inputs and the Submit button exist, release the hold. It costs a hold nobody wanted for a few seconds and would catch selector drift, captcha changes and blocks within an hour. Pair it with a version fingerprint of the widget's JS bundle so a redeploy raises a flag even before the canary fails.

**Being blocked is a business event, not a bug.** The plan is to stop, not to evade: no stealth browsers, no proxy rotation. The right escalation is a SevenRooms partnership or an official API, and the adapter boundary below is designed so that swap is contained.

### Scale: what changes going from 1 platform to 5?

The pipeline already has the shape of an adapter: `availability(venue, date, party, window)`, `prepare(request)`, `confirm()`, `close()`. Adding a platform means implementing those four for it. What actually changes:

1. **Venue discovery becomes the hard problem.** No platform offers a free venue search. Each needs its own curated directory with slugs or IDs, city, neighbourhood, timezone, and a validation job. This is data work that grows linearly with coverage, and it is where most of the effort goes.
2. **Auth models diverge.** SevenRooms: guest checkout. Resy: user login token and often a card. OpenTable: OTP login plus Akamai. Tock: Cloudflare and an account. Each needs its own credential handling and its own consent story for the diner.
3. **Slot semantics differ.** Bookable vs request-only, deposits, prix-fixe tickets, seating areas, holds of different lengths. The domain model needs a common vocabulary with per-platform flags, and the UI has to explain them.
4. **Policies and money.** Every platform has its own way of expressing fees and cancellation windows. The no-fee guard has to be re-derived per platform, and "never enter a card" may become "enter a card only with explicit consent".
5. **Breakage multiplies.** Five widgets, five canaries, five sets of selectors that drift on their own schedule. Monitoring stops being optional.
6. **Ranking across platforms.** The same restaurant can appear on two platforms with different availability. De-duplication and a preference order are needed.
7. **Terms and relationships.** Each platform's terms differ. At five platforms the honest path is partnerships for the ones that gate access and widget-driving only where it is clearly a guest flow.

What does not change: the chat layer, the profile, the confirm-before-submit contract, and the job state machine.

### Cuts: what did you cut, and what's V2?

**Cut for the demo**

- OpenTable (Akamai) and Apify (cost). Both reachable only by paying or evading.
- Restaurant search. Replaced by a curated, validated venue list; anywhere else is refused.
- Request-only slots. Shown but not tappable, because they need the restaurant to approve.
- Venues that want a card or charge fees. Refused by policy.
- Login flows, modify and cancel from within Pearl. Cancellation is via the restaurant's email.
- Multi-user. One diner profile, one live browser session at a time. Confirmed bookings do persist to a local ledger; in-flight jobs are in memory and swept after 30 minutes.
- Screenshots in the UI. Replaced by the explicit confirm step.
- The mobile app. The demo is a standalone web page.

**V2, in order**

1. Hourly canary per venue with alerting, plus widget-bundle fingerprinting.
2. Direct hold and book calls for hot-table releases, with a pre-warmed browser for the submit.
3. A venue directory tool: paste a SevenRooms URL, validate it, pull name, address and timezone automatically.
4. Persistence and accounts: bookings history, cancel and modify through the platform's own links.
5. A second platform through the adapter boundary, most likely Resy with explicit user consent, to prove the abstraction.
6. Prompt caching and Haiku for the model path when it moves to a metered API.
7. Card-required venues with explicit consent and a tokenised payment method, if the product wants them.

## Proof it works

On 26 September 2026 the flow booked a real table end to end: Miriam West Village, Friday 2 October 2026, 7:00 PM, party of 2, reservation #XGYXY455VAU, confirmed by the restaurant by SMS. On that run reCAPTCHA accepted the first Submit; on other runs it showed the checkbox and waited for the tick. Both paths are handled and covered by tests against a local stand-in for the widget.

## Architecture diagrams

Seven Mermaid diagrams (system overview with the service layout, booking sequence, job states, message understanding, checkout guardrails, scaling to five platforms, the V2 canary) are in `ARCHITECTURE.md` and render on GitHub.

## Try it

```bash
npm run demo                     # API on 127.0.0.1:8788, web on localhost:5180
PEARL_DEMO_AI=off npm run demo   # deterministic parser only
npm test                # 43 tests: parser, availability cache and limiter, Codex queue, ledger, driver against a local widget stand-in, API state machine
```
