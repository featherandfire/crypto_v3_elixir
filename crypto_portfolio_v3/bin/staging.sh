#!/usr/bin/env bash
# Run any mix task with .env.staging loaded and MIX_ENV=prod set.
# Usage:
#   bin/staging.sh ecto.migrate
#   bin/staging.sh ecto.rollback --step 1
#   bin/staging.sh phx.server
#
# Reads .env.staging (gitignored) for DATABASE_URL, SECRET_KEY_BASE, and the
# other prod-required env vars. Bails if the file is missing or DATABASE_URL
# still contains the placeholder text.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.staging"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found" >&2
  echo "Copy from .env.staging.example (if present) or recreate it." >&2
  exit 1
fi

# Parse .env without `source` so values containing `$`, `` ` ``, or other
# shell-meaningful characters (e.g. Supabase-generated DB passwords) are
# treated literally. Splits on the first `=`; strips surrounding quotes.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if [[ "$value" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    export "$key=$value"
  fi
done < "$ENV_FILE"

if [[ "${DATABASE_URL:-}" == *"[YOUR-PASSWORD]"* || "${DATABASE_URL:-}" == *"[PROJECT-REF]"* ]]; then
  echo "error: DATABASE_URL in .env.staging still has placeholder values" >&2
  exit 1
fi

cd "$SCRIPT_DIR"
exec env MIX_ENV=prod mix "$@"
