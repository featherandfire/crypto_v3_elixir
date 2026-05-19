# Multi-stage build for Fly.io. Stage 1 builds the Vite frontend, stage 2
# builds the Elixir release with the dist/ tree baked into priv/static,
# stage 3 is the slim runtime image.
#
# Build locally with: docker build -f brokerage/Dockerfile -t brokerage .
# Fly builds it remotely on `flyctl deploy`.

# ── Stage 1: frontend build ───────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: elixir release build ─────────────────────────────────────────
FROM hexpm/elixir:1.19.5-erlang-28.3-debian-bookworm-20260505-slim AS builder

# Install build deps
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends build-essential git \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV MIX_ENV=prod LANG=C.UTF-8

WORKDIR /app/brokerage

RUN mix local.hex --force && mix local.rebar --force

# Pull deps first so they cache independently of source edits.
COPY brokerage/mix.exs brokerage/mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

COPY brokerage/config ./config
COPY brokerage/lib ./lib
COPY brokerage/priv ./priv

# Drop the built frontend into priv/static — Plug.Static serves it from
# there at runtime.
COPY --from=frontend /app/frontend/dist/ ./priv/static/

RUN mix compile
RUN mix release

# ── Stage 3: runtime ──────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8

WORKDIR /app

# Run as non-root.
RUN useradd --create-home --shell /bin/bash app && chown app:app /app
USER app

COPY --from=builder --chown=app:app /app/brokerage/_build/prod/rel/brokerage ./

ENV PHX_SERVER=true PORT=4000

EXPOSE 4000

CMD ["/app/bin/brokerage", "start"]
