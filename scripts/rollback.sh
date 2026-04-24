#!/usr/bin/env bash
#
# Flip /opt/crypto/current back to /opt/crypto/previous and restart.
#
# /opt/crypto/previous is updated by scripts/deploy-remote.sh on every
# deploy — it points at whatever `current` pointed at before the new
# release took over. That makes rollback deterministic: always goes to
# the release that was actually running before the last deploy, instead
# of guessing "second newest directory by mtime" which could land on a
# broken artifact from a prior failed build.
#
# Run on the EC2: `bash ~/src/crypto_v3_elixir/scripts/rollback.sh`
# Or via the manual .github/workflows/rollback.yml workflow_dispatch.

set -euo pipefail

CURRENT_LINK=/opt/crypto/current
PREVIOUS_LINK=/opt/crypto/previous

if [ ! -L "$PREVIOUS_LINK" ]; then
  echo "ERROR: $PREVIOUS_LINK does not exist — no rollback target recorded"
  echo "Either this is a fresh install or deploy-remote.sh hasn't run once yet."
  exit 1
fi

CURRENT_TARGET=$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "")
PREV_TARGET=$(readlink -f "$PREVIOUS_LINK")

if [ ! -d "$PREV_TARGET" ]; then
  echo "ERROR: $PREVIOUS_LINK points at $PREV_TARGET which no longer exists"
  exit 1
fi

if [ "$CURRENT_TARGET" = "$PREV_TARGET" ]; then
  echo "ERROR: current and previous already point at the same release"
  echo "Nothing to roll back to."
  exit 1
fi

echo "==> rolling back from $(basename "$CURRENT_TARGET") to $(basename "$PREV_TARGET")"

# Swap: current becomes what previous was; previous becomes what current was
# (so a second rollback invocation can undo this one).
sudo ln -sfn "$PREV_TARGET" "$CURRENT_LINK"
sudo ln -sfn "$CURRENT_TARGET" "$PREVIOUS_LINK"

echo "==> restarting crypto-api"
sudo /usr/bin/systemctl restart crypto-api

echo "==> waiting for service to be ready"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null -m 2 http://127.0.0.1:4000/api/health; then
    echo "==> service healthy"
    break
  fi
  [ "$i" = "30" ] && { echo "ERROR: service did not become healthy in 30s"; exit 1; }
  sleep 1
done

echo "==> rollback complete"
