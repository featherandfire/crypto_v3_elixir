#!/usr/bin/env bash
#
# Build + deploy on the EC2 host. Invoked over SSH by the deploy workflow.
# Args:
#   $1 — short git SHA (used as release dir name)
#
# Assumes:
#   - ~/src/crypto_v3_elixir is a clone of the repo; workflow has already
#     `git pull`ed the latest main before invoking this script.
#   - asdf + Erlang 28 + Elixir 1.19 available in ec2-user's shell.
#   - Node 22 + npm available in ec2-user's shell.
#   - /opt/crypto/releases/ exists and is writable by `crypto`.
#   - /etc/sudoers.d/crypto-deploy allows NOPASSWD for:
#       systemctl restart crypto-api, rsync, chown, tar, mkdir, ln, rm,
#       and `sudo -u crypto bash ...` for migrations.
#
# Exits non-zero on any failure so the GitHub Action reports a failed deploy.

set -euo pipefail

SHA_SHORT="${1:?short SHA required}"

REPO_DIR="$HOME/src/crypto_v3_elixir"
BACKEND_DIR="$REPO_DIR/crypto_portfolio_v3"
FRONTEND_DIR="$REPO_DIR/frontend"
RELEASE_DIR="/opt/crypto/releases/${SHA_SHORT}"
WEB_DIR="/var/www/crypto"

# Make sure asdf is loaded even in a non-interactive SSH session.
export ASDF_DIR="$HOME/.asdf"
if [ -f "$ASDF_DIR/asdf.sh" ]; then
  # shellcheck disable=SC1091
  . "$ASDF_DIR/asdf.sh"
fi

echo "==> git status"
cd "$REPO_DIR"
git log -1 --oneline

echo "==> building Elixir release (MIX_ENV=prod)"
cd "$BACKEND_DIR"
export MIX_ENV=prod
mix local.hex --force
mix local.rebar --force
mix deps.get --only prod
mix compile
mix release --overwrite

echo "==> building frontend"
cd "$FRONTEND_DIR"
npm ci
npm run build

echo "==> staging release to ${RELEASE_DIR}"
sudo mkdir -p "${RELEASE_DIR}"
sudo rsync -a --delete "${BACKEND_DIR}/_build/prod/rel/crypto_portfolio_v3/" "${RELEASE_DIR}/"
sudo chown -R crypto:crypto "${RELEASE_DIR}"

echo "==> flipping /opt/crypto/current symlink"
sudo ln -sfn "${RELEASE_DIR}" /opt/crypto/current

echo "==> rsync frontend to ${WEB_DIR}"
sudo rsync -a --delete "${FRONTEND_DIR}/dist/" "${WEB_DIR}/"
sudo chown -R caddy:caddy "${WEB_DIR}"

echo "==> running migrations"
sudo -u crypto bash -c '
  set -a
  source /etc/crypto/env
  set +a
  /opt/crypto/current/bin/crypto_portfolio_v3 eval "CryptoPortfolioV3.Release.migrate"
'

echo "==> restarting crypto-api"
sudo /usr/bin/systemctl restart crypto-api

echo "==> waiting for service to be ready"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null -m 2 http://127.0.0.1:4000/api/coins/top; then
    echo "==> service healthy"
    break
  fi
  [ "$i" = "30" ] && { echo "ERROR: service did not become healthy in 30s"; exit 1; }
  sleep 1
done

echo "==> pruning old releases (keep last 5)"
KEEP=5
ls -1dt /opt/crypto/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r dir; do
  if [ "$(readlink -f /opt/crypto/current)" != "${dir%/}" ]; then
    sudo rm -rf "$dir"
    echo "    removed $dir"
  fi
done

echo "==> deploy $SHA_SHORT complete"
