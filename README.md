# Tavola table concierge

[![CI](https://github.com/Dileep2896/tavola-table-concierge/actions/workflows/ci.yml/badge.svg)](https://github.com/Dileep2896/tavola-table-concierge/actions/workflows/ci.yml)

Chat → live availability → real booking, on SevenRooms, with no paid APIs.

A self-contained web app. A diner types something like *"table for 2 in the West Village Friday, 7–9pm"*, Tavola finds real open tables on SevenRooms across a curated list of New York and San Francisco restaurants, shows every open time in the window, and books the one the diner confirms.

No paid APIs required for the local demo. Availability comes from SevenRooms' public reservation widget endpoint, and the booking is made by a Playwright browser driving that same widget exactly as a guest would. Chat understanding runs through a deterministic parser first; when a model is available it also uses one. To deploy, add an `ANTHROPIC_API_KEY` (the agent then runs on any server) and a `BROWSERBASE_API_KEY` (a cloud browser does the booking). Locally, chat can instead use the Codex CLI if it is signed in, and the parser alone needs no key at all.

**Live:** https://tavola-table-concierge.onrender.com · **Code:** https://github.com/Dileep2896/tavola-table-concierge

## Architecture, trade-offs, and cuts

**Architecture.** A React single-page app (Vite, Zustand, Framer Motion) talks to a small Hono API that does three things: understand the request (a deterministic parser first, the Anthropic API only for natural phrasing), find availability (one cached call per venue to SevenRooms' public widget), and book (a Playwright browser drives SevenRooms' guest checkout in two phases — hold the table, then submit only on the diner's confirm — tracked by an explicit job state machine). In production it runs as one Render web service that serves the built site and the API on one port, with a Browserbase cloud browser doing the booking. The seven Mermaid diagrams are in `ARCHITECTURE.md`; the long-form write-up and the cost / time / breakage / scale answers are in `DEMO.md`.

**Trade-offs.**
- **No paid API, no bot evasion.** Availability and booking both go through SevenRooms' public surfaces, driven like a person. If a platform blocks it, the answer is a partnership, not a workaround.
- **reCAPTCHA stays human.** It rejects the first automated Submit every time, so a person does the one tick — and adds any card — inside an embedded live view of the cloud browser. The agent never types a card number or a password.
- **Parser first, model optional.** Cheaper and more robust than sending every turn to a model; the model only improves phrasing, and a bad reply can't break a turn.
- **Confirm before submit.** Only the diner's click books, so it is slower than a fully-automatic path but never books the wrong thing.

**What I cut.** OpenTable (bot wall) and Apify (paid per booking); restaurant search (a curated 21-venue list of NY + SF restaurants instead); multi-user and accounts; in-app cancel and modify. V2 would add an hourly canary per venue to catch widget changes, direct hold calls for hot 10:00:00 releases, a second platform (Resy) through the same adapter boundary, and a tokenized card so card-required venues can be booked end to end.

## Run

```bash
npm install               # also installs Playwright Chromium
npm run demo            # API on http://127.0.0.1:8788 and web on http://localhost:5180
TAVOLA_DEMO_AI=off npm run demo   # skip Codex, use the deterministic parser only
```

## Frontend

React + Vite with a typed Zustand store (`web/store/store.ts`) holding chat, availability, the booking job (with its own polling lifecycle), the profile, saved bookings and the theme. The app is a sidebar shell with three pages — Concierge, Reservations, Settings — collapsing to a bottom tab bar on mobile. UI is split into `web/ui` primitives and `web/features/*` (chat, venues, booking, profile, bookings). When an area has no instantly bookable tables, the concierge names bookable restaurants elsewhere in the same city and shows them in a Nearby section. When the concierge is missing a detail, context-aware quick-reply chips (day, time, party size, area) let the diner tap instead of type. Motion is Framer Motion: shimmer while tables load, a lit stepper during preparation, a draining brass hold-ring, and a confirm seal. Luxury dark and light themes are CSS custom properties in `web/styles/theme.css`; the theme follows the system on first load and is remembered after.

## Configuration

Everything is an environment variable with a safe default (see `server/config.ts`):

| Variable | Default | Meaning |
|---|---|---|
| `TAVOLA_DEMO_AI` | on | `off` uses the deterministic parser only (no model) |
| `ANTHROPIC_API_KEY` | unset | Runs chat understanding through the Anthropic API, so the agent works on a deployed server with no local login. When set, it is preferred over the Codex CLI |
| `TAVOLA_AI_MODEL` | claude-sonnet-5 | Which model acts as the agent. `claude-haiku-4-5` is cheapest, `claude-opus-5` most capable |
| `TAVOLA_DEMO_API_PORT` / `TAVOLA_DEMO_WEB_PORT` | 8788 / 5180 | Ports |
| `TAVOLA_DATA_DIR` | `.local` | Profile and bookings ledger, when stored as JSON files |
| `DATABASE_URL` | unset | A Postgres connection string. When set, the bookings ledger and profile persist in Postgres (survives a restart); otherwise they live in JSON files under `TAVOLA_DATA_DIR` |
| `TAVOLA_AVAILABILITY_CACHE_MS` | 20000 | How long a venue lookup is reused |
| `TAVOLA_AVAILABILITY_CONCURRENCY` | 6 | Parallel SevenRooms requests |
| `TAVOLA_JOB_RETENTION_MS` | 1800000 | How long finished bookings stay readable |
| `TAVOLA_STRICT_NO_FEE` | unset | `1` refuses fee venues outright. By default a fee is shown to the diner to accept or decline at confirm |
| `TAVOLA_BOOKING_MODE` | handoff | Default `handoff` embeds the restaurant's SevenRooms page in an in-app browser panel for the diner to finish — no separate window, and the deployable mode. `auto` instead drives a local browser that fills and submits for you (opens a real browser window, needed for reCAPTCHA; local only) |
| `TAVOLA_HEADLESS` | unset | `1` hides the booking browser. A hidden browser cannot pass SevenRooms' reCAPTCHA, so leave it off for real bookings |
| `TAVOLA_BROWSER_VISIBLE` | unset | By default the booking window launches off-screen and only appears if a reCAPTCHA checkbox is needed. `1` keeps it on-screen throughout |
| `TAVOLA_BROWSER_CHANNEL` | unset | `chrome` uses the installed Google Chrome instead of Playwright's Chromium |
| `TAVOLA_BROWSER_CDP_URL` | unset | Auto mode connects to a remote browser over CDP instead of launching locally |
| `BROWSERBASE_API_KEY` | unset | Run auto mode on [Browserbase](https://browserbase.com) (the key alone; no project id). A fresh remote session per booking, no local browser, so it works on a deployed server. Setting it switches the default booking mode to `auto` |
| `BROWSERBASE_PROXIES` | unset | `1` uses Browserbase residential proxies (paid plan). Needed to have a real chance of clearing reCAPTCHA; without it the session has a datacenter IP and the submit is usually rejected |
| `BROWSERBASE_SOLVE_CAPTCHAS` | unset | `1` uses Browserbase's captcha solving (paid plan) |
| `TAVOLA_HUMAN_SOLVE_MS` | 120000 | How long Tavola waits for you to finish a human step in the live view (tick reCAPTCHA, or add a card / sign in at a venue that needs one) |
| `TAVOLA_RATE_LIMIT` | 120 | Per-IP requests per minute on `/api/*` (`0` disables) |
| `TAVOLA_CANARY_INTERVAL_MS` | 0 | How often the canary sweeps every venue's availability (`0` off; e.g. `3600000` for hourly). Status at `GET /api/canary`, trigger with `POST /api/canary/run` |
| `TAVOLA_LOG_LEVEL` | info | `debug`, `info`, `warn`, `error` |

`GET /api/health` reports the chat provider, the browser pool and job counts. `GET /api/bookings` lists confirmed reservations from the local ledger.

## Test

```bash
npm test
```

The booking driver test runs Chromium against a local stand-in for the widget, so it never touches SevenRooms.

## Docs

- `DEMO.md`: what was built, the token strategy, and the cost / time / breakage / scale / cuts answers.
- `ARCHITECTURE.md`: seven Mermaid diagrams (render on GitHub).
- `AUDIT.md`: the system-design review and what it changed.

## Diner profile

The confirm step auto-fills from a local profile stored at `.local/profile.json` (git-ignored, created on first save). Edit it from the "Edit" link in the page header, or by saving changed details on the confirm form. It is sent only to the restaurant's SevenRooms booking form when you confirm a table. `TAVOLA_DEMO_PROFILE=/path/to/profile.json` overrides the location.

## Deploy

Two keys make Tavola run on a server with nothing local. Put them in `.env` (git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-...     # the agent that reads chat requests
BROWSERBASE_API_KEY=bb_live_...  # the cloud browser that books
```

With the Anthropic key, chat understanding runs through the Anthropic API instead of the local Codex CLI. With the Browserbase key, booking runs in `auto` mode against a remote Browserbase session per booking — no window. The Browserbase key alone is enough (the project resolves from it). Set `TAVOLA_AI_MODEL` to choose the model (`claude-sonnet-5` by default).

**As one service.** `npm run build` compiles the web to `dist/`, and `npm start` runs a single server that serves that build and the API on one port (it reads the platform's `PORT` and binds `0.0.0.0`). `npm run demo` stays the two-process dev setup with hot reload.

```bash
npm run build && npm start   # one server, app + API, on http://localhost:8788
```

### Render

The repo includes `render.yaml`, so in Render you can pick **New → Blueprint** and point it at the repo, or create a **Web Service** by hand with:

- **Build command:** `npm install --include=dev && npm run build` (`--include=dev` keeps Vite available under Render's `NODE_ENV=production`).
- **Start command:** `npm start`
- **Health check path:** `/api/health`
- **Environment:** `ANTHROPIC_API_KEY` and `BROWSERBASE_API_KEY` (both secret), plus `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so the build skips the ~150 MB Chromium download it does not need (booking runs on Browserbase, or in the diner's own browser in handoff mode). Render injects `PORT` and the app binds `0.0.0.0` on its own.

Without a Browserbase key the service still runs in handoff mode, where the diner finishes the booking in an in-app SevenRooms panel — no server browser at all. Note that Render's free instances have an ephemeral disk, so the local profile and bookings ledger reset on each deploy or restart.

**How reCAPTCHA is handled:** Tavola fills the form on the Browserbase cloud browser. If reCAPTCHA challenges on submit, Tavola embeds Browserbase's live view of that cloud browser in the app and asks you to tick "I'm not a robot" there — a real human tick, in-app, no paid captcha-solver and no separate window. Tavola detects the token and submits. This can work on the free plan when reCAPTCHA offers the checkbox. If the datacenter IP scores too low to even offer one, set `BROWSERBASE_PROXIES=1` (paid) for a residential IP.

**Venues that ask for a card or a sign-in:** Tavola never types a card number or a password. On the cloud browser it fills everything else, holds the table, and shows you the same live view to add the card (or sign in) and book there, then records the confirmation. Locally, with no in-app browser, it stops and offers "Finish on SevenRooms" instead. This drives an automated booking, subject to SevenRooms' terms; the clean path is a SevenRooms partnership.

## Booking modes

- **Handoff (default):** Tavola finds the table and opens the restaurant's SevenRooms page in an in-app browser panel; you pick the time, add details and confirm there, then tap "I'm done." Nothing pops out of the app, and it works on any server because the booking happens in your own browser.
- **Auto (`TAVOLA_BOOKING_MODE=auto`):** Tavola drives a browser to fill and submit for you. With `BROWSERBASE_API_KEY` set this is a remote cloud browser embedded as a live view — deployable, no window, and the default once the key is present. Without a key it drives a local browser window that stays off-screen until a human check is needed (not usable on a headless server).

## How an auto booking happens

1. Pick a time. Tavola opens the restaurant's SevenRooms page in the booking browser, selects that time (the widget holds the table for 5 minutes), reads the restaurant's policy, and fills the guest form from your profile. Nothing is submitted.
2. The panel shows what was filled, the policy, and a countdown on the hold, with **Confirm booking** and **Cancel**. On the Browserbase cloud browser it also embeds a live view so you can watch.
3. Only Confirm presses the restaurant's Submit button. SevenRooms runs reCAPTCHA Enterprise and rejects the first submit from any automated browser, then shows an "I'm not a robot" checkbox. On the cloud browser Tavola surfaces the live view and asks you to tick the box there; locally it brings the window forward. Tavola detects the token and submits again itself.
4. If the venue needs a card or a sign-in, Tavola does not stop on the cloud browser: it hands you the live view to add the card (or log in) and book there, and records the confirmation. Cancel releases the hold; picking another time replaces the pending one; if the hold runs out the panel says so and you pick again.

If the panel says it lost contact with the demo API, the API process has stopped. `npm run demo` starts both processes and stops both if either one dies.

## What to know before booking

- Bookings are real. The restaurant emails a confirmation with a cancel link. Cancel test bookings promptly.
- Only "book" slots are tappable. "Request" slots are shown but disabled, since those need the restaurant to approve.
- Tavola never types a card number or a password. On the cloud browser, a venue that needs a card or a sign-in is finished by you in the embedded live view (Tavola fills everything else); locally it stops with `PAYMENT_REQUIRED` / `LOGIN_REQUIRED` and offers "Finish on SevenRooms". A cancellation fee is shown to you to accept or decline at confirm, not a hard stop — set `TAVOLA_STRICT_NO_FEE=1` (or pass `requireFreeCancellation: true` to `SevenRoomsBooker`) to refuse fee venues outright.
- Venues live in `server/venues.ts`. SevenRooms has no public venue search, so coverage is a curated slug list: New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Add any SevenRooms venue by its URL slug (`sevenrooms.com/explore/<slug>/...`) with its city, neighborhood and timezone; `api-yoa/dining/widget_info?venue_url_key=<slug>` returns those details.
