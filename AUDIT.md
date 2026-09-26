# Audit and redesign, 26 September 2026

A review of the demo as first extracted from the monorepo, what was wrong with it, and what changed.

## Findings

| # | Drawback | Risk | Fix |
|---|---|---|---|
| 1 | `app.ts` mixed HTTP routing, the booking state machine, timers and browser lifecycle in one file, with an ad-hoc `finish()` that had to be tricked into allowed transitions. | Hard to reason about; state bugs hide in route handlers. | `server/jobs.ts`: a `BookingJobs` service with an explicit transition table. Illegal moves are logged and refused. The API only translates HTTP into service calls. |
| 2 | A fresh Chromium was launched for every booking (~1.5 s) and closed after. | Slow tap-to-hold; memory churn; no shutdown hook. | `server/browser-pool.ts`: one browser per server, lazily launched, relaunched if it dies; each booking gets an isolated context (~100 ms). Graceful shutdown releases holds and closes the browser. |
| 3 | Availability was refetched from SevenRooms on every chat turn with unbounded parallelism. | Hammering a third party; risk of rate limiting during a demo. | `server/availability.ts`: 20 s cache keyed by query, fan-out capped at 6 concurrent requests, failures not cached, timings logged. |
| 4 | Codex ran one process per request with no limit and no memory. | Concurrent turns slow each other; retries pay twice. | `CodexQueue`: calls serialised, identical prompts answered from a 5-minute cache, overload rejected cleanly so the parser takes over. |
| 5 | Finished jobs were never removed, and a 300 KB screenshot was embedded in the job JSON and re-sent on every poll. | Memory grows forever; polling gets heavy. | Jobs swept 30 min after finishing. Screenshots were first moved behind a served endpoint and later dropped entirely (see "Since this review"); a stop now explains itself in words and, where possible, offers a live-view or SevenRooms finish. |
| 6 | Confirmed bookings lived only in memory. | A restart lost the demo's proof of work. | `server/ledger.ts`: confirmed bookings appended to `.local/bookings.json` (no contact details), listed at `/api/bookings` and in the page. |
| 7 | Env vars were read wherever they were used; no logger; no error or not-found handlers; unbounded request bodies. | Inconsistent errors, stack traces to clients, hard to operate. | `server/config.ts` (one typed config), `server/logger.ts` (JSON lines with request ids and timings), `ApiError` with an `onError` mapping, JSON 404s, 64 KB body limit. |
| 8 | The whole UI was one 160-line component with `setInterval` polling. | Hard to extend; polling never slowed down. | `web/hooks` (`useProfile`, `useBookingJob`) and `web/components` (`Results`, `JobPanel`, `ContactFields`, `Bookings`). Polling backs off to 3 s while a hold waits. |
| 9 | `/api/health` said nothing about the browser or the model. | No way to see readiness before a demo. | Health reports job counts, browser pool status and the Codex queue. |
| 10 | Tests covered routes but not caching, queueing, retention or persistence. | Regressions in the new layers would be silent. | `tests/services.test.ts` plus extended API, chat, driver and AI-provider tests: 56 tests. |

## Found while diagnosing "why can't it book"

The confirm step *was* pressing Submit. SevenRooms' reCAPTCHA Enterprise rejected it: `POST …/book → 400 {"errors":["ReCaptcha server-side validation failed."]}`, in headless Chromium and in a visible automation-driven Chrome alike. Two defects hid this: the driver only captured responses under `/api-yoa/`, so the 400 on `/booking/dining/widget/<id>/book` was missed and the job timed out after 40 s as `NO_CONFIRMATION`; and nothing recorded what happened on the wire. Fixes: the book response is captured wherever it lives and its status decides the outcome (2 s to a clear answer); every post-Submit request, response, console error and the final URL are stored on the job and listed at `GET /api/jobs`; the rejection is classified `CAPTCHA_REJECTED`; and because the widget then shows an "I'm not a robot" checkbox, the browser is visible by default, the panel asks the diner to tick it, and Tavola presses Submit again once the token exists. Tavola still solves nothing itself. A follow-up bug: when reCAPTCHA *did* accept the first Submit, the widget's 200 response carried `status: "success"` as a string, which the outcome check compared as a number and reported as a rejection while the restaurant had already confirmed. The HTTP status now decides, a numeric body status can only make a 2xx worse, and a regression test covers it.

## What did not change

- The booking contract: prepare fills and holds, only the diner's confirm presses Submit, holds expire, cancel releases.
- The core guardrail: Tavola never types a card number or a password.
- Single-user, single-machine scope. There is still one live booking session at a time and one local profile; that is deliberate for a demo.

## Since this review

The demo moved on from the local-only, screenshot-based shape reviewed above:

- **Deployable browser (Browserbase).** Auto mode can run on a remote cloud browser instead of a local window, so bookings work on a deployed server. When reCAPTCHA challenges, Tavola embeds Browserbase's interactive live view and the diner ticks the box in-app.
- **Deployable chat (Anthropic API).** Chat understanding can run through the Anthropic API (`ANTHROPIC_API_KEY`, `TAVOLA_AI_MODEL`, default `claude-sonnet-5`) instead of the local Codex CLI, so the agent needs no machine login. The parser still runs first and catches any model failure.
- **Card and sign-in venues finish in the live view.** Rather than a hard `PAYMENT_REQUIRED` / `LOGIN_REQUIRED` stop, on the cloud browser Tavola fills everything it can, holds the table, and hands the diner the live view to add the card or sign in and book; it records the confirmation. Tavola still never enters the card itself. Locally it stops and offers "Finish on SevenRooms".
- **Fees are a heads-up, not a wall.** A cancellation fee is shown to the diner to accept or decline at confirm; `TAVOLA_STRICT_NO_FEE=1` restores the old refuse-outright behaviour.
- **Screenshots removed.** The evidence image and its endpoint are gone; a stop explains itself in words and offers the live-view or SevenRooms finish instead.

## Still open (next steps)

- Per-user sessions and a real datastore if this ever serves more than one diner.
- The hourly canary per venue (see `ARCHITECTURE.md`, diagram 7).
- Direct hold calls for 10:00:00 releases.
