# Pearl table concierge

Chat → live availability → real booking, on SevenRooms, with no paid APIs.

A self-contained web app. A diner types something like *"table for 2 in the West Village Friday, 7–9pm"*, Pearl finds real open tables on SevenRooms across a curated list of New York and San Francisco restaurants, shows every open time in the window, and books the one the diner confirms.

No paid APIs. Availability comes from SevenRooms' public reservation widget endpoint, and the booking is made by a headless Playwright browser driving that same widget exactly as a guest would. Chat understanding uses the Codex CLI (already signed in on this machine) with a built-in parser as fallback.

## Run

```bash
npm install               # also installs Playwright Chromium
npm run demo            # API on http://127.0.0.1:8788 and web on http://localhost:5180
PEARL_DEMO_AI=off npm run demo   # skip Codex, use the deterministic parser only
```

## Frontend

React + Vite with a typed Zustand store (`web/store/store.ts`) holding chat, availability, the booking job (with its own polling lifecycle), the profile, saved bookings and the theme. The app is a sidebar shell with three pages — Concierge, Reservations, Settings — collapsing to a bottom tab bar on mobile. UI is split into `web/ui` primitives and `web/features/*` (chat, venues, booking, profile, bookings). When an area has no instantly bookable tables, the concierge names bookable restaurants elsewhere in the same city and shows them in a Nearby section. When the concierge is missing a detail, context-aware quick-reply chips (day, time, party size, area) let the diner tap instead of type. Motion is Framer Motion: shimmer while tables load, a lit stepper during preparation, a draining brass hold-ring, and a confirm seal. Luxury dark and light themes are CSS custom properties in `web/styles/theme.css`; the theme follows the system on first load and is remembered after.

## Configuration

Everything is an environment variable with a safe default (see `server/config.ts`):

| Variable | Default | Meaning |
|---|---|---|
| `PEARL_DEMO_AI` | on | `off` uses the built-in parser only |
| `PEARL_DEMO_API_PORT` / `PEARL_DEMO_WEB_PORT` | 8788 / 5180 | Ports |
| `PEARL_DATA_DIR` | `.local` | Profile and bookings ledger |
| `PEARL_AVAILABILITY_CACHE_MS` | 20000 | How long a venue lookup is reused |
| `PEARL_AVAILABILITY_CONCURRENCY` | 6 | Parallel SevenRooms requests |
| `PEARL_JOB_RETENTION_MS` | 1800000 | How long finished bookings stay readable |
| `PEARL_STRICT_NO_FEE` | unset | `1` refuses fee venues outright. By default a fee is shown to the diner to accept or decline at confirm |
| `PEARL_BOOKING_MODE` | handoff | Default `handoff` embeds the restaurant's SevenRooms page in an in-app browser panel for the diner to finish — no separate window, and the deployable mode. `auto` instead drives a local browser that fills and submits for you (opens a real browser window, needed for reCAPTCHA; local only) |
| `PEARL_HEADLESS` | unset | `1` hides the booking browser. A hidden browser cannot pass SevenRooms' reCAPTCHA, so leave it off for real bookings |
| `PEARL_BROWSER_VISIBLE` | unset | By default the booking window launches off-screen and only appears if a reCAPTCHA checkbox is needed. `1` keeps it on-screen throughout |
| `PEARL_BROWSER_CHANNEL` | unset | `chrome` uses the installed Google Chrome instead of Playwright's Chromium |
| `PEARL_BROWSER_CDP_URL` | unset | Auto mode connects to a remote browser over CDP instead of launching locally |
| `BROWSERBASE_API_KEY` | unset | Run auto mode on [Browserbase](https://browserbase.com) (the key alone; no project id). A fresh remote session per booking, no local browser, so it works on a deployed server. Setting it switches the default booking mode to `auto` |
| `BROWSERBASE_PROXIES` | unset | `1` uses Browserbase residential proxies (paid plan). Needed to have a real chance of clearing reCAPTCHA; without it the session has a datacenter IP and the submit is usually rejected |
| `BROWSERBASE_SOLVE_CAPTCHAS` | unset | `1` uses Browserbase's captcha solving (paid plan) |
| `PEARL_HUMAN_SOLVE_MS` | 120000 | How long Pearl waits for you to tick the reCAPTCHA checkbox |
| `PEARL_LOG_LEVEL` | info | `debug`, `info`, `warn`, `error` |

`GET /api/health` reports the browser pool, the Codex queue and job counts. `GET /api/bookings` lists confirmed reservations from the local ledger.

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

The confirm step auto-fills from a local profile stored at `.local/profile.json` (git-ignored, created on first save). Edit it from the "Edit" link in the page header, or by saving changed details on the confirm form. It is sent only to the restaurant's SevenRooms booking form when you confirm a table. `PEARL_DEMO_PROFILE=/path/to/profile.json` overrides the location.

## Deploy with auto (Browserbase)

Put your key in `.env` (git-ignored):

```
BROWSERBASE_API_KEY=bb_live_...
```

Then `npm run demo` runs in `auto` mode against a remote Browserbase session per booking — no window, deployable. The key alone is enough (the project resolves from it).

**Free plan caveat (important):** proxies and captcha solving are paid. On the free plan the session runs but has a datacenter IP, so SevenRooms' reCAPTCHA will usually reject the submit — the booking fails and you fall back to handoff. To actually clear reCAPTCHA you need the Developer plan and `BROWSERBASE_PROXIES=1` (add `BROWSERBASE_SOLVE_CAPTCHAS=1` for stepped-up challenges). This route drives an automated booking, subject to SevenRooms' terms; the clean path is a SevenRooms partnership.

## Booking modes

- **Handoff (default):** Pearl finds the table and opens the restaurant's SevenRooms page in an in-app browser panel; you pick the time, add details and confirm there, then tap "I'm done." Nothing pops out of the app, and it works on any server because the booking happens in your own browser.
- **Auto (`PEARL_BOOKING_MODE=auto`, local only):** Pearl drives a real browser to fill and submit for you. That browser is a separate window (it must be real to pass reCAPTCHA); it stays off-screen until a human check is needed. Not usable on a headless server.

## How an auto booking happens

1. Pick a time. Pearl opens the restaurant's SevenRooms page in a headless browser, selects that time (the widget holds the table for 5 minutes), reads the restaurant's policy, and fills the guest form from your profile. Nothing is submitted.
2. The panel shows what was filled, the policy, and a countdown on the hold, with **Confirm booking** and **Cancel**.
3. Only Confirm presses the restaurant's Submit button. SevenRooms runs reCAPTCHA Enterprise on the checkout and rejects the first submit from any automated browser, then shows an "I'm not a robot" checkbox. Pearl keeps the browser window visible, tells you in the panel, waits for you to tick the box, and presses Submit again itself. Cancel closes the browser and releases the hold. Picking another time replaces the pending one. If the hold runs out, the panel says so and you pick again.

If the panel says it lost contact with the demo API, the API process has stopped. `npm run demo` starts both processes and stops both if either one dies.

## What to know before booking

- Bookings are real. The restaurant emails a confirmation with a cancel link. Cancel test bookings promptly.
- Only "book" slots are tappable. "Request" slots are shown but disabled, since those need the restaurant to approve.
- Restaurants that require a card at checkout are stopped with `PAYMENT_REQUIRED`, and restaurants whose cancellation policy mentions a fee or a card on file are stopped with `CANCELLATION_FEE`. Pearl never enters payment details and never books where cancelling could cost money. Pass `requireFreeCancellation: false` to `SevenRoomsBooker` to relax the second rule.
- Venues live in `server/venues.ts`. SevenRooms has no public venue search, so coverage is a curated slug list: New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Add any SevenRooms venue by its URL slug (`sevenrooms.com/explore/<slug>/...`) with its city, neighborhood and timezone; `api-yoa/dining/widget_info?venue_url_key=<slug>` returns those details.
