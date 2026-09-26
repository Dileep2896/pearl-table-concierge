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
| `PEARL_ALLOW_FEE_VENUES` | unset | `1` disables the no-fee guard |
| `PEARL_HEADED` | unset | `1` shows the booking browser |
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

## How a booking happens

1. Pick a time. Pearl opens the restaurant's SevenRooms page in a headless browser, selects that time (the widget holds the table for 5 minutes), reads the restaurant's policy, and fills the guest form from your profile. Nothing is submitted.
2. The panel shows what was filled, the policy, and a countdown on the hold, with **Confirm booking** and **Cancel**.
3. Only Confirm presses the restaurant's Submit button, once. Cancel closes the browser and releases the hold. Picking another time replaces the pending one. If the hold runs out, the panel says so and you pick again.

If the panel says it lost contact with the demo API, the API process has stopped. `npm run demo` starts both processes and stops both if either one dies.

## What to know before booking

- Bookings are real. The restaurant emails a confirmation with a cancel link. Cancel test bookings promptly.
- Only "book" slots are tappable. "Request" slots are shown but disabled, since those need the restaurant to approve.
- Restaurants that require a card at checkout are stopped with `PAYMENT_REQUIRED`, and restaurants whose cancellation policy mentions a fee or a card on file are stopped with `CANCELLATION_FEE`. Pearl never enters payment details and never books where cancelling could cost money. Pass `requireFreeCancellation: false` to `SevenRoomsBooker` to relax the second rule.
- Venues live in `server/venues.ts`. SevenRooms has no public venue search, so coverage is a curated slug list: New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Add any SevenRooms venue by its URL slug (`sevenrooms.com/explore/<slug>/...`) with its city, neighborhood and timezone; `api-yoa/dining/widget_info?venue_url_key=<slug>` returns those details.
