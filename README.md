# crypto_v3_elixir

Multi-chain crypto portfolio tracker. Elixir/Phoenix API backend, TypeScript/Alpine.js frontend, PostgreSQL. Tracks holdings across EVM chains, Solana, Tron, Bitcoin, and Litecoin; fetches live prices from CoinGecko; resolves any tx hash to structured details.

## Stack

**Backend** — `crypto_portfolio_v3/`
- Elixir 1.19, OTP 28, Phoenix 1.8, Ecto 3.13, Bandit 1.10
- PostgreSQL 16
- Dependencies: `req`, `bcrypt_elixir`, `dotenvy`, `postgrex`, `phoenix_live_dashboard`

**Frontend** — `frontend/`
- TypeScript 6 (strict mode), Vite 8
- Alpine.js 3 (reactive framework), Chart.js 4, Three.js

**External services**
- CoinGecko (prices, contract resolution, yearly volatility)
- CryptoCompare (long-range % changes)
- Etherscan V2 (EVM balances + tx history) — requires free API key
- TronGrid (TRX + TRC-20)
- Solana public RPC, mempool.space (BTC), litecoinspace.org (LTC)

## Supported chains

Balance fetching: 7 EVM chains (Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Base) + Solana + Tron.

Transaction detail parsing: those 9 plus Bitcoin + Litecoin (11 total).

## Local dev

### Prereqs
- Elixir 1.19 + Erlang/OTP 28 (`brew install elixir`)
- PostgreSQL 16 running on `localhost:5432` with a `postgres` superuser (`brew install postgresql@16 && brew services start postgresql@16`)
- Node.js 22 + npm 10
- Phoenix generator: `mix archive.install hex phx_new`

### First-time setup

```bash
# Backend
cd crypto_portfolio_v3
mix deps.get
mix ecto.create
mix ecto.migrate

# Frontend
cd ../frontend
npm install

# Secrets
cp frontend/.env.example crypto_portfolio_v3/.env
# Edit crypto_portfolio_v3/.env — minimum: ETHERSCAN_API_KEY (free from etherscan.io)
```

### Running (two terminals)

```bash
# Terminal 1: Phoenix API on :4000
cd crypto_portfolio_v3
ENABLE_PREFETCHERS=true mix phx.server

# Terminal 2: Vite frontend on :3000
cd frontend
npm run dev
```

Open `http://localhost:3000`.

Vite proxies `/api/*` to Phoenix. Phoenix serves pure JSON; no HTML routes yet.

### Environment variables

Set in `crypto_portfolio_v3/.env` (gitignored). Template at `frontend/.env.example`.

| Var | Required? | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | prod only | dev-only fallback | Required or Phoenix won't boot in prod |
| `ETHERSCAN_API_KEY` | recommended | empty | Free tier works but slow without it |
| `COINGECKO_BASE_URL` | no | `https://api.coingecko.com/api/v3` | Override for pro plans |
| `CRYPTOCOMPARE_API_KEY` | no | empty | Optional |
| `ENABLE_PREFETCHERS` | no | `false` | Set `true` to auto-populate volatility + long-range data |
| `YEARLY_PREFETCH_TOP` | no | `200` | Top-N coins to prefetch yearly stats for |
| `PCT_PREFETCH_TOP` | no | `200` | Top-N coins for % change prefetch |
| `SOLANA_RPC_URL` | no | public mainnet-beta | Override for paid Helius/QuickNode |
| `DATABASE_URL` | prod only | dev uses `postgres:postgres@localhost` | `ecto://user:pass@host/db` format |

## Project structure

```
crytpo_elixir/                                # monorepo root
├── crypto_portfolio_v3/                      # Elixir/Phoenix backend
│   ├── lib/
│   │   ├── crypto_portfolio_v3/
│   │   │   ├── accounts/                     # Users + auth
│   │   │   ├── portfolios/                   # Portfolios, holdings, transactions
│   │   │   ├── market/                       # CoinGecko + CryptoCompare + prefetchers
│   │   │   ├── chain/                        # EVM, Solana, Tron, Bitcoin, Litecoin clients
│   │   │   └── application.ex                # Supervision tree
│   │   └── crypto_portfolio_v3_web/          # Controllers, router, plugs, serializer
│   ├── priv/repo/migrations/                 # 7 migrations (users, portfolios, coins, ...)
│   ├── config/                               # Dev/test/runtime config
│   └── test/                                 # ExUnit tests
│
└── frontend/                                 # TypeScript/Alpine/Vite frontend
    ├── index.html                            # Single-file composed HTML (partials inlined)
    ├── static/
    │   ├── js/app.ts                         # dashApp component + auth + API client
    │   ├── js/coin-data.ts                   # Static coin reference data
    │   ├── css/style.css
    │   └── favicon/
    ├── templates/partials/                   # Source partials (for refactoring; index.html is what renders)
    └── vite.config.ts
```

## Database

7 app tables:

```
users ──< portfolios ──< holdings ──< transactions
                           └──> coins
coins  ←→  coingecko_yearly_stats   (loose join, no FK)
coins  ←→  cryptocompare_pct_changes (loose join, no FK)
```

Single Postgres-specific feature: `NULLS NOT DISTINCT` unique index on `holdings(portfolio_id, coin_id, wallet_address)`.

All numeric values use `numeric(38, N)` for exact decimal precision. Serialized as strings on the JSON wire to avoid IEEE-754 drift — frontend parses on ingest.

## API endpoints

Auth-required (`Bearer <JWT>`):
- `POST /api/auth/register` / `POST /api/auth/login` / `GET /api/auth/me`
- `GET/POST/DELETE /api/portfolios[/:id]`
- `POST /api/portfolios/:id/refresh` — force CoinGecko price refresh for all coins in the portfolio
- `POST/PATCH/DELETE /api/portfolios/:id/holdings[/:id]`
- `GET/POST /api/portfolios/:id/holdings/:hid/transactions`

Public:
- `GET /api/coins/top | /search | /supply | /yearly-ranges | /:id/history`
- `GET /api/cryptocompare/changes | /volatility`
- `GET /api/wallet/chains`
- `GET /api/wallet/:chain/:address` — balances for one EVM chain
- `GET /api/wallet/solana/:address` — SOL + SPL
- `GET /api/wallet/tron/:address` — TRX + TRC-20
- `GET /api/wallet/all/:address` — auto-detect EVM/Solana/Tron
- `GET /api/wallet/:chain/:address/last-buy-fees` — EVM fee-party analysis
- `GET /api/wallet/solana/:address/last-buy-fees`
- `GET /api/wallet/from-tx/:hash` — resolve tx → sender
- `GET /api/lookup/:hash` — format detect + live tx parse across 11 chains

## Background workers

Two supervised GenServers under the main app supervisor, opt-in via `ENABLE_PREFETCHERS=true`:

- **`YearlyPrefetcher`** — top-N CoinGecko coins, fetches 365-day price chart, computes 1y high/low + 90/180/365-day annualized volatility. Cycles every 24h.
- **`PctChangePrefetcher`** — top-N symbols, fetches 548-day histoday from CryptoCompare, computes pct change. Cycles every 24h.

Both write to Postgres (`coingecko_yearly_stats`, `cryptocompare_pct_changes`) so frontend reads are pure DB queries.

Free-tier rate limits (CoinGecko especially) make a cold start of `top=200` take ~30–60 min. After that, incremental refresh is cheap.

## Known gaps

- **No production release config wired** — `mix phx.gen.release` + SPA catch-all plug is the last todo; until then, dev is two-terminal only.
- **No CI workflow** — add a `.github/workflows/ci.yml` that runs `mix test` + `npx tsc --noEmit` on push.
- **Tron wallet coverage is partial** — TronGrid lacks a "all TRC-20 balances" bulk endpoint, so we call `balanceOf` for a hardcoded top-10 list (USDT, USDC, WTRX, JST). Long-tail TRC-20s aren't auto-discovered.
- **EVM tx detail decimals** — for token Transfer logs, we use a small hardcoded stablecoin-decimals map + 18-default fallback. Non-stablecoin amounts on the lookup page may be off by a factor of 10^N for exotic tokens.
