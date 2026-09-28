# Tavola demo — architecture diagrams

All diagrams are Mermaid and render on GitHub. The same sources are rendered to images for the presentation.

The frontend is a Vite + React sidebar shell (Concierge, Reservations, Settings) with a typed Zustand store holding chat, the booking job and its polling, the profile, saved bookings and the theme; UI is split into `web/ui` primitives and `web/features/*`. Motion is Framer Motion.

## 1. System overview

```mermaid
flowchart LR
  D([Diner]) --> UI[React app · Vite<br/>sidebar shell: Concierge · Reservations · Settings]
  UI --- ST[Zustand store<br/>chat · booking job · profile · theme]
  ST -->|/api| API[Hono API<br/>routing · errors · request log]
  API --> CH[Chat<br/>model agent tool-use · parser fallback]
  CH --> AI{Model backend}
  AN -.->|check_availability tool| AV
  AI -->|API key, deployable| AN[(Anthropic API<br/>claude-sonnet-5)]
  AI -->|local login| CX[(Codex CLI<br/>no API key)]
  API --> AV[Availability service<br/>20 s cache · concurrency cap · nearby fallback]
  AV -->|GET widget/range| SR[(SevenRooms<br/>public widget)]
  API --> JB[Booking jobs<br/>state machine · timers · retention]
  JB --> BK[Booking driver<br/>prepare / confirm]
  BK --> BR{Booking browser}
  BR -->|local window| BP[Chromium pool<br/>context per booking]
  BR -->|deployed| BB[(Browserbase<br/>cloud browser + live view)]
  BP -->|guest checkout + reCAPTCHA| SR
  BB -->|guest checkout + reCAPTCHA| SR
  JB --> LG[(Bookings ledger<br/>Postgres or .local/bookings.json)]
  API --> PF[(Diner profile<br/>Postgres or .local/profile.json)]
  API --> VN[(Curated venues<br/>21 slugs, NY + SF)]
```

## 2. One booking, end to end

```mermaid
sequenceDiagram
  actor Diner
  participant UI as Web page
  participant API as API
  participant B as Booking browser
  participant SR as SevenRooms

  Diner->>UI: "table for 2 in the West Village Friday at 7"
  UI->>API: chat
  API->>SR: availability, one GET per venue
  SR-->>UI: every open time, closest pick per restaurant
  Diner->>UI: picks a restaurant
  API->>B: prepare
  B->>SR: select time · table held 5 min · read policy · fill form
  B-->>UI: Ready to book (or a named stop with the reason)
  Diner->>UI: Confirm
  API->>B: confirm
  alt venue needs a card or a sign-in (cloud browser)
    B-->>UI: live view · "add your card and book"
    Diner->>SR: adds card / signs in · books in the live view
    SR-->>UI: Reservation confirmed
  else Tavola presses Submit
    B->>SR: press Submit
    alt reCAPTCHA accepts
      SR-->>UI: Reservation confirmed
    else reCAPTCHA steps up to a checkbox
      B-->>UI: live view · "tick I'm not a robot"
      Diner->>SR: ticks the box
      B->>SR: press Submit again
      SR-->>UI: Reservation confirmed
    end
  end
```

## 3. Booking job states

```mermaid
stateDiagram-v2
  [*] --> PREPARING: diner taps a time
  PREPARING --> READY: form filled, table held<br/>(card/sign-in venues finish in the live view)
  PREPARING --> FAILED: slot gone · timeout · card or sign-in with no live view
  PREPARING --> CANCELLED: diner cancels or picks another time
  READY --> SUBMITTING: diner confirms<br/>(or finishes the card/sign-in in the live view)
  READY --> CANCELLED: diner cancels
  READY --> EXPIRED: 5-minute hold lapses
  SUBMITTING --> CONFIRMED: restaurant accepts
  SUBMITTING --> FAILED: rejected or no confirmation
  CONFIRMED --> [*]
  FAILED --> [*]
  CANCELLED --> [*]
  EXPIRED --> [*]
```

## 4. Understanding a message

With an Anthropic key the model is the agent: it resolves the request and calls a `check_availability` tool over the real widget data, then writes the reply from what came back (`server/agent.ts`). The deterministic parser is the always-on fallback — used when no key is set and if the agent errors on a turn.

```mermaid
flowchart TB
  M[Diner message<br/>or tapped quick reply] --> K{Anthropic key set?}
  K -->|yes · agent| AG[Model agent<br/>server/agent.ts]
  AG --> T[check_availability tool<br/>resolve area · date · window · party]
  T --> AV[(Availability fan-out<br/>real SevenRooms slots)]
  AV --> AG
  AG -->|composes reply from real results| S[Reply + open times<br/>closest pick per venue]
  AG -.->|missing a detail| Q2[Ask one friendly question]
  AG -.->|off or errors this turn| P
  K -->|no · fallback| P[Deterministic parser<br/>chrono-node · patterns · aliases]
  P --> V{All fields known?<br/>area · date · window · party}
  V -->|missing| Q[Ask + show quick-reply chips<br/>area · day · time · guests]
  V -->|unsupported place| R[Refuse with the covered areas]
  V -->|ready| F[Availability fan-out]
  F --> B{Bookable tables?}
  B -->|yes| S
  B -->|no| N[Search the rest of the city<br/>name nearby bookable places]
```

## 5. Guardrails at the checkout

```mermaid
flowchart LR
  A[Checkout page open<br/>table held] --> D[Read policy<br/>fee is a heads-up, not a stop]
  D --> F[Fill name, email, phone<br/>tick cancellation policy]
  F --> B{Card or sign-in<br/>required?}
  B -->|no| G[READY · wait for the diner]
  B -->|yes, cloud browser| P[READY · live view<br/>diner adds card / signs in · Tavola never types it]
  B -->|yes, no live view| B1[Stop: PAYMENT_REQUIRED / LOGIN_REQUIRED<br/>offer Finish on SevenRooms]
  G -->|Confirm| H[Tavola presses Submit]
  P -->|diner books in the live view| K
  H --> J{reCAPTCHA<br/>verdict}
  J -->|accepted| K[Confirmed<br/>saved to ledger]
  J -->|checkbox shown| L[Diner ticks the box in the live view<br/>Tavola presses Submit again]
  L --> K
  J -->|nobody finishes in time| M[Stop: CAPTCHA_UNSOLVED<br/>try again]
  G -->|Cancel or 5 min| I[Close browser · hold released]
  P -->|Cancel or 5 min| I
```

## 6. From one platform to five

```mermaid
flowchart LR
  subgraph Stable
    UI[Chat + web page] --> J[Job state machine<br/>prepare → confirm]
    J --> I[Adapter interface<br/>availability · prepare · confirm · close]
  end
  I --> S1[SevenRooms<br/>guest checkout]
  I --> S2[Resy<br/>user token, often a card]
  I --> S3[OpenTable<br/>blocked · partnership only]
  I --> S4[Tock<br/>Cloudflare · account]
  I --> S5[Yelp<br/>partner API]
  subgraph Grows with each platform
    DIR[(Venue directories)]
    CAN[Canaries + alerts]
    POL[Fee + consent rules]
  end
  S1 --- DIR
  S2 --- DIR
  I --- CAN
  I --- POL
```

## 7. Knowing before a diner does (V2 canary)

```mermaid
flowchart LR
  T[Every hour, per venue] --> A[GET availability]
  A --> B[Dry-run to checkout<br/>select · hold · verify inputs + Submit]
  B --> R[Release the hold]
  A & B --> F{Anything changed?}
  F -->|selectors · shape · block| AL[Alert + mark venue degraded]
  F -->|fine| OK[Record OK]
  W[Widget JS bundle fingerprint] --> F
```
