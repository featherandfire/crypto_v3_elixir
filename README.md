# abcoins

Self-directed brokerage app — stocks, ETFs, dividends, recurring
investments, wishlist auto-execute. Elixir/Phoenix API backend with an
Alpaca Broker integration (per-user accounts, KYC, ACH funding,
withdrawals, orders, webhooks), TypeScript + Alpine.js frontend, and a
Playwright E2E suite that runs against an in-process Broker API mock.

## Stack

**Backend** — Elixir 1.15+, Phoenix 1.8, Ecto 3.13, Bandit, PostgreSQL 16.
Decimal everywhere financial; HMAC-verified Alpaca webhooks; Swoosh +
Resend for transactional email.

**Frontend** — TypeScript 6 (strict) + Alpine.js 3 + Vite 8.
Chart.js 4 + chartjs-chart-treemap for holdings/dividend/price/projection
charts; Three.js for the neural-canvas backdrop. No React/Svelte (kept
intentionally — see [feedback_plain_ts_first.md] in repo memory).

## Features

- Per-user Alpaca brokerage accounts, KYC submission, ACH deposit +
  withdrawal flows, order placement (market / limit / stop / stop-limit /
  trailing-stop) with an explainer modal for each type.
- Wishlist with auto-execute (buy when `current_price <= trigger`),
  re-runs on every price poll.
- Recurring investments (daily / weekly / monthly), with email on fire.
- Holdings dashboard with three palette modes (Logo, Color, 10-Year
  Projection), donut breakdowns by industry chip, dividend income share,
  and share-price tier.
- Stock + ETF screener with chip filters, sub-filters, search, and a
  star-to-wishlist action; ticker strip with live quotes.
- Account Activity feed (transfers + fills) and Portfolio History chart.
- News & Communications card (Alpaca News + Finnhub merged) and Company
  Information card (Polygon primary, Finnhub fallback).
- Transactional email on 6 events: deposit settled, withdrawal initiated,
  order placed, wishlist filled, recurring fired, KYC approved.
- Dark / Light theme toggle + FX panel (saturation / contrast sliders)
  on the neural canvas, persisted in `localStorage`.

## External services

| Service      | Purpose                                              | Required for                |
| ------------ | ---------------------------------------------------- | --------------------------- |
| Alpaca Broker | Per-user accounts, KYC, ACH, orders, positions       | All brokerage features       |
| Alpaca Data  | Live quotes + bars                                   | Quotes, charts               |
| Finnhub      | Secondary news source + fallback company profile     | News card, profile fallback |
| Polygon.io   | Primary company-profile source                       | Company Information card   |
| Logo.dev     | Company logo PNGs + dominant-color sampling          | Holdings palette, ticker UI |
| Resend       | Transactional email (prod only)                      | Email notifications        |

Each service is opt-in: missing API keys downgrade the affected feature
(e.g. without `FINNHUB_API_KEY` the news aggregator falls back to
Alpaca-only) rather than crashing the app.

## Local development

### Prerequisites

- Elixir 1.15+ / OTP 26+ (Phoenix 1.8 baseline)
- PostgreSQL 16
- Node 20+ (for the Vite frontend and Playwright)

### Backend

```bash
cd brokerage
mix deps.get
mix ecto.setup
ALPACA_MOCK=1 mix phx.server     # serves on :4000
```

`ALPACA_MOCK=1` boots an in-process Plug that impersonates the Alpaca
Broker API — accounts approve instantly, orders fill at the limit price
(or $10 default) and update a position ledger, and activity entries
compute real `net_amount` from `qty * filled_avg_price`. Used by every
E2E spec; safe for local dev when you don't want to hit the real sandbox.

Drop `ALPACA_MOCK=1` (and set `ALPACA_API_KEY` + `ALPACA_API_SECRET`)
to talk to the real Alpaca paper-trading endpoint.

### Frontend

```bash
cd frontend
npm install
npm run dev       # Vite dev server on :5173 with HMR
```

The frontend proxies API requests to the Phoenix backend on `:4000`.

### Environment variables

The backend reads everything from `System.get_env` in
[brokerage/config/runtime.exs](brokerage/config/runtime.exs).
Common ones:

```
DATABASE_URL          # ecto://USER:PASS@HOST/DATABASE  (prod only)
SECRET_KEY_BASE
ALPACA_API_KEY        # paper-trading credentials
ALPACA_API_SECRET
ALPACA_MOCK=1         # skip real Alpaca; use in-process mock
FINNHUB_API_KEY       # optional — enables Finnhub news
POLYGON_API_KEY       # optional — enables Polygon company profiles
RESEND_API_KEY        # required in :prod
```

## Tests

### Backend

```bash
cd brokerage
mix test
```

### E2E (Playwright)

```bash
cd frontend
npm run test:e2e          # headless, ALPACA_MOCK on
npm run test:e2e:headed   # visible browser
npm run test:e2e:ui       # Playwright UI mode
npm run test:e2e:report   # open last HTML report
```

12 specs covering: critical path, auth flows, KYC validation,
order placement, multi-user isolation, unauthenticated access, webhook
hardening, wishlist (mutation + auto-execute), withdrawals, recurring
investments. Wall time on a laptop: ~4 minutes for the full suite (the
mock is ~3x faster than the real sandbox for deterministic flows).

## Deploy

- Staging migrations:
  `brokerage/bin/staging.sh ecto.migrate`
  (loads `.env.staging`, sets `MIX_ENV=prod`).
- EC2 deploy is symlink-based: `/opt/crypto/current` -> the active
  release, `/opt/crypto/previous` -> the last one. `scripts/rollback.sh`
  flips them and restarts `crypto-api` via systemd.

## Project layout

```
brokerage/        Phoenix umbrella-flat app
  lib/brokerage/
    alpaca.ex               Broker API client (Req)
    alpaca_mock/            In-process Plug + GenServer mock
    broker_funding/         ACH deposits + withdrawals
    brokerage_accounts/     Per-user Alpaca account records
    recurring_investments/  Cron-driven recurring buys
    wishlist_items/         Auto-execute wishlist
    notifications.ex        Email dispatch (swallows failures)
    emails.ex               Swoosh templates
  lib/brokerage_web/
    controllers/            JSON API endpoints
    router.ex
  priv/repo/migrations/

frontend/
  index.html                Single-page Alpine.js shell
  static/css/style.css      Theme variables + light-mode overrides
  static/js/app.ts          All app state + render logic
  tests/e2e/specs/          Playwright suites

scripts/                    Deploy + rollback shell scripts
```
