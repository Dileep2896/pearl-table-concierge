# Pearl table concierge

Chat → live availability → real booking, on SevenRooms, with no paid APIs.

A self-contained web app. A diner types something like *"table for 2 in the West Village Friday, 7–9pm"*, Pearl finds real open tables on SevenRooms across a curated list of New York and San Francisco restaurants, shows every open time in the window, and books the one the diner confirms.

No paid APIs required for the local demo. Availability comes from SevenRooms' public reservation widget endpoint, and the booking is made by a Playwright browser driving that same widget exactly as a guest would. Chat understanding runs through a deterministic parser first; when a model is available it also uses one. To deploy, add an `ANTHROPIC_API_KEY` (the agent then runs on any server) and a `BROWSERBASE_API_KEY` (a cloud browser does the booking). Locally, chat can instead use the Codex CLI if it is signed in, and the parser alone needs no key at all.

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
| `PEARL_DEMO_AI` | on | `off` uses the deterministic parser only (no model) |
| `ANTHROPIC_API_KEY` | unset | Runs chat understanding through the Anthropic API, so the agent works on a deployed server with no local login. When set, it is preferred over the Codex CLI |
| `PEARL_AI_MODEL` | claude-sonnet-5 | Which model acts as the agent. `claude-haiku-4-5` is cheapest, `claude-opus-5` most capable |
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
| `PEARL_HUMAN_SOLVE_MS` | 120000 | How long Pearl waits for you to finish a human step in the live view (tick reCAPTCHA, or add a card / sign in at a venue that needs one) |
| `PEARL_LOG_LEVEL` | info | `debug`, `info`, `warn`, `error` |

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

The confirm step auto-fills from a local profile stored at `.local/profile.json` (git-ignored, created on first save). Edit it from the "Edit" link in the page header, or by saving changed details on the confirm form. It is sent only to the restaurant's SevenRooms booking form when you confirm a table. `PEARL_DEMO_PROFILE=/path/to/profile.json` overrides the location.

## Deploy

Two keys make Pearl run on a server with nothing local. Put them in `.env` (git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-...     # the agent that reads chat requests
BROWSERBASE_API_KEY=bb_live_...  # the cloud browser that books
```

With the Anthropic key, chat understanding runs through the Anthropic API instead of the local Codex CLI. With the Browserbase key, `npm run demo` runs in `auto` mode against a remote Browserbase session per booking — no window. The Browserbase key alone is enough (the project resolves from it). Set `PEARL_AI_MODEL` to choose the model (`claude-sonnet-5` by default).

**How reCAPTCHA is handled:** Pearl fills the form on the Browserbase cloud browser. If reCAPTCHA challenges on submit, Pearl embeds Browserbase's live view of that cloud browser in the app and asks you to tick "I'm not a robot" there — a real human tick, in-app, no paid captcha-solver and no separate window. Pearl detects the token and submits. This can work on the free plan when reCAPTCHA offers the checkbox. If the datacenter IP scores too low to even offer one, set `BROWSERBASE_PROXIES=1` (paid) for a residential IP.

**Venues that ask for a card or a sign-in:** Pearl never types a card number or a password. On the cloud browser it fills everything else, holds the table, and shows you the same live view to add the card (or sign in) and book there, then records the confirmation. Locally, with no in-app browser, it stops and offers "Finish on SevenRooms" instead. This drives an automated booking, subject to SevenRooms' terms; the clean path is a SevenRooms partnership.

## Booking modes

- **Handoff (default):** Pearl finds the table and opens the restaurant's SevenRooms page in an in-app browser panel; you pick the time, add details and confirm there, then tap "I'm done." Nothing pops out of the app, and it works on any server because the booking happens in your own browser.
- **Auto (`PEARL_BOOKING_MODE=auto`):** Pearl drives a browser to fill and submit for you. With `BROWSERBASE_API_KEY` set this is a remote cloud browser embedded as a live view — deployable, no window, and the default once the key is present. Without a key it drives a local browser window that stays off-screen until a human check is needed (not usable on a headless server).

## How an auto booking happens

1. Pick a time. Pearl opens the restaurant's SevenRooms page in the booking browser, selects that time (the widget holds the table for 5 minutes), reads the restaurant's policy, and fills the guest form from your profile. Nothing is submitted.
2. The panel shows what was filled, the policy, and a countdown on the hold, with **Confirm booking** and **Cancel**. On the Browserbase cloud browser it also embeds a live view so you can watch.
3. Only Confirm presses the restaurant's Submit button. SevenRooms runs reCAPTCHA Enterprise and rejects the first submit from any automated browser, then shows an "I'm not a robot" checkbox. On the cloud browser Pearl surfaces the live view and asks you to tick the box there; locally it brings the window forward. Pearl detects the token and submits again itself.
4. If the venue needs a card or a sign-in, Pearl does not stop on the cloud browser: it hands you the live view to add the card (or log in) and book there, and records the confirmation. Cancel releases the hold; picking another time replaces the pending one; if the hold runs out the panel says so and you pick again.

If the panel says it lost contact with the demo API, the API process has stopped. `npm run demo` starts both processes and stops both if either one dies.

## What to know before booking

- Bookings are real. The restaurant emails a confirmation with a cancel link. Cancel test bookings promptly.
- Only "book" slots are tappable. "Request" slots are shown but disabled, since those need the restaurant to approve.
- Pearl never types a card number or a password. On the cloud browser, a venue that needs a card or a sign-in is finished by you in the embedded live view (Pearl fills everything else); locally it stops with `PAYMENT_REQUIRED` / `LOGIN_REQUIRED` and offers "Finish on SevenRooms". A cancellation fee is shown to you to accept or decline at confirm, not a hard stop — set `PEARL_STRICT_NO_FEE=1` (or pass `requireFreeCancellation: true` to `SevenRoomsBooker`) to refuse fee venues outright.
- Venues live in `server/venues.ts`. SevenRooms has no public venue search, so coverage is a curated slug list: New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Add any SevenRooms venue by its URL slug (`sevenrooms.com/explore/<slug>/...`) with its city, neighborhood and timezone; `api-yoa/dining/widget_info?venue_url_key=<slug>` returns those details.
