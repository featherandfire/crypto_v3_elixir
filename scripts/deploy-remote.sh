#!/usr/bin/env bash
#
# Runs on the EC2 host. Invoked by the deploy workflow via SSH.
# Args:
#   $1 — S3 bucket name (e.g. abcoins-deploys-prod)
#   $2 — release key prefix  (e.g. releases/abc12345)
#
# Assumes:
#   - awscli installed + instance has an IAM role with s3:GetObject on the bucket
#   - /opt/crypto/releases/ exists and is writable by `crypto`
#   - sudoers has NOPASSWD for `ec2-user` on:
#       /usr/bin/systemctl restart crypto-api
#       /usr/bin/systemctl status crypto-api
#       /usr/bin/rsync (for the /var/www/crypto copy)
#       /usr/bin/chown
#
# Exits non-zero on any failure so the GitHub Action reports a failed deploy.

set -euo pipefail

BUCKET="${1:?bucket name required}"
KEY="${2:?release key prefix required}"

STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT

SHA_SHORT="${KEY##*/}"
RELEASE_DIR="/opt/crypto/releases/${SHA_SHORT}"
WEB_DIR="/var/www/crypto"

echo "==> fetching release.tar.gz"
aws s3 cp "s3://${BUCKET}/${KEY}/release.tar.gz" "${STAGE_DIR}/release.tar.gz" --no-progress

echo "==> fetching frontend.tar.gz"
aws s3 cp "s3://${BUCKET}/${KEY}/frontend.tar.gz" "${STAGE_DIR}/frontend.tar.gz" --no-progress

echo "==> extracting release to ${RELEASE_DIR}"
sudo mkdir -p "${RELEASE_DIR}"
sudo tar -xzf "${STAGE_DIR}/release.tar.gz" -C "${RELEASE_DIR}" --strip-components=1
sudo chown -R crypto:crypto "${RELEASE_DIR}"

echo "==> flipping /opt/crypto/current symlink"
sudo ln -sfn "${RELEASE_DIR}" /opt/crypto/current

echo "==> extracting frontend to staging"
mkdir -p "${STAGE_DIR}/dist"
tar -xzf "${STAGE_DIR}/frontend.tar.gz" -C "${STAGE_DIR}/dist"

echo "==> rsync frontend to ${WEB_DIR}"
sudo rsync -a --delete "${STAGE_DIR}/dist/" "${WEB_DIR}/"
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
ls -1dt /opt/crypto/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read dir; do
  if [ "$(readlink -f /opt/crypto/current)" != "${dir%/}" ]; then
    sudo rm -rf "$dir"
    echo "    removed $dir"
  fi
done

echo "==> deploy $SHA_SHORT complete"
