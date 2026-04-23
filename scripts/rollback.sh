#!/usr/bin/env bash
#
# Flip the /opt/crypto/current symlink back to the previous release and restart.
# Run on the EC2: `sudo bash /opt/crypto/rollback.sh`
#   (or via a manual workflow_dispatch on GitHub that SSHes in and runs this).

set -euo pipefail

CURRENT_LINK=/opt/crypto/current
CURRENT_TARGET=$(readlink -f "$CURRENT_LINK")

PREV=$(ls -1dt /opt/crypto/releases/*/ 2>/dev/null \
  | grep -v "^${CURRENT_TARGET%/}/\$" \
  | head -n 1)

if [ -z "$PREV" ]; then
  echo "ERROR: no previous release to roll back to"
  exit 1
fi

echo "==> rolling back from $(basename "$CURRENT_TARGET") to $(basename "${PREV%/}")"
sudo ln -sfn "${PREV%/}" "$CURRENT_LINK"

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

echo "==> rollback complete"
