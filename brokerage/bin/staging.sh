#!/usr/bin/env bash
# Runs a mix task with .env.staging loaded + MIX_ENV=prod.
# Usage: bin/staging.sh ecto.migrate | ecto.rollback --step 1 | phx.server
# Bails if .env.staging is missing or DATABASE_URL is still the placeholder.

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
