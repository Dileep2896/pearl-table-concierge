# Pearl demo — architecture diagrams

All diagrams are Mermaid and render on GitHub. The same sources are rendered to images for the presentation.

The frontend is a Vite + React sidebar shell (Concierge, Reservations, Settings) with a typed Zustand store holding chat, the booking job and its polling, the profile, saved bookings and the theme; UI is split into `web/ui` primitives and `web/features/*`. Motion is Framer Motion.

## 1. System overview

```mermaid
flowchart LR
  D([Diner]) --> UI[React app · Vite<br/>sidebar shell: Concierge · Reservations · Settings]
  UI --- ST[Zustand store<br/>chat · booking job · profile · theme]
  ST -->|/api| API[Hono API<br/>routing · errors · request log]
  API --> CH[Chat<br/>parser first, Codex when available]
  CH --> CQ[Codex queue<br/>serialised · 5 min cache]
  CQ --> CX[(Codex CLI<br/>local, no API key)]
  API --> AV[Availability service<br/>20 s cache · concurrency cap · nearby fallback]
  AV -->|GET widget/range| SR[(SevenRooms<br/>public widget)]
  API --> JB[Booking jobs<br/>state machine · timers · retention]
  JB --> BK[Booking driver<br/>prepare / confirm]
  BK --> BP[Browser pool<br/>one Chromium, a context per booking]
  BP -->|guest checkout + reCAPTCHA| SR
  JB --> LG[(Bookings ledger<br/>.local/bookings.json)]
  API --> PF[(Local profile<br/>.local/profile.json)]
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
  B-->>UI: Ready to book, or a named stop with a screenshot
  Diner->>UI: Confirm
  API->>B: confirm
  B->>SR: press Submit
  alt reCAPTCHA accepts
    SR-->>UI: Reservation confirmed
  else reCAPTCHA steps up to a checkbox
    B-->>UI: "One tick from you" · window to the front
    Diner->>SR: ticks "I'm not a robot"
    B->>SR: press Submit again
    SR-->>UI: Reservation confirmed
  end
```

## 3. Booking job states

```mermaid
stateDiagram-v2
  [*] --> PREPARING: diner taps a time
  PREPARING --> READY: form filled, table held
  PREPARING --> FAILED: card · fee · slot gone · timeout
  PREPARING --> CANCELLED: diner cancels or picks another time
  READY --> SUBMITTING: diner confirms
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

```mermaid
flowchart LR
  M[Diner message<br/>or tapped quick reply] --> P[Parser<br/>chrono-node · patterns · aliases]
  P --> C{Codex on?}
  C -->|yes| X[Codex CLI<br/>strict JSON] --> MG[Merge over parser<br/>validate with Zod]
  C -->|no| V
  MG --> V{All fields known?<br/>area · date · window · party}
  MG -.->|model fails or junk| V
  V -->|missing| Q[Ask + show quick-reply chips<br/>area · day · time · guests]
  V -->|unsupported place| R[Refuse with the covered areas]
  V -->|ready| F[Availability fan-out]
  F --> B{Bookable tables?}
  B -->|yes| S[Show open times<br/>closest pick per venue]
  B -->|no| N[Search the rest of the city<br/>name nearby bookable places]
```

## 5. Guardrails at the checkout

```mermaid
flowchart LR
  A[Checkout page open<br/>table held] --> B{Visible card field<br/>or payment frame?}
  B -->|yes| B1[Stop<br/>PAYMENT_REQUIRED]
  B -->|no| C{Login required?}
  C -->|yes| C1[Stop<br/>LOGIN_REQUIRED]
  C -->|no| D[Open policy dialog<br/>read + photograph]
  D --> E{Fee or card<br/>on file?}
  E -->|yes| E1[Stop<br/>CANCELLATION_FEE<br/>+ screenshot]
  E -->|no| F[Fill name, email, phone<br/>tick cancellation policy]
  F --> G[READY · wait for the diner]
  G -->|Confirm| H[Press Submit]
  H --> J{reCAPTCHA<br/>verdict}
  J -->|accepted| K[Confirmed<br/>saved to ledger]
  J -->|checkbox shown| L[Diner ticks the box<br/>Pearl presses Submit again]
  L --> K
  J -->|nobody ticks in 2 min| M[Stop: CAPTCHA_UNSOLVED<br/>try again]
  G -->|Cancel or 5 min| I[Close browser · hold released]
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
