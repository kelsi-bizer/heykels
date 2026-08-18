#!/usr/bin/env bash
#
# Apply database migrations to Cloud SQL, from Cloud Shell.
#
#   ./scripts/migrate-cloud.sh
#
# Run this once after setup, and again any time the schema changes.
#
# Why not in cloudbuild.yaml: Cloud Build does not mount the Cloud SQL socket, so a
# build step cannot reach the database without running an auth proxy sidecar. Doing
# it here keeps the failure messages visible instead of buried in build logs.
set -euo pipefail

PROJECT="${PROJECT:-heykels}"
REGION="${REGION:-us-central1}"
INSTANCE="${INSTANCE:-heykels-db}"
DB_NAME="${DB_NAME:-heykels}"
DB_USER="${DB_USER:-heykels}"
PORT="${PORT:-5433}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

CONNECTION="${PROJECT}:${REGION}:${INSTANCE}"

# Preflight: the proxy starts happily even when the instance doesn't exist, and the
# failure then surfaces later, tangled up in npm output. Better to stop now with a
# message that names the actual problem.
say "Checking the Cloud SQL instance exists"
STATE="$(gcloud sql instances describe "$INSTANCE" --project="$PROJECT" --format='value(state)' 2>/dev/null || true)"
if [ -z "$STATE" ]; then
  echo "Cloud SQL instance '$INSTANCE' does not exist in project '$PROJECT'." >&2
  echo "Run ./scripts/setup-gcloud.sh $PROJECT first." >&2
  exit 1
fi
echo "    $INSTANCE is $STATE"

say "Fetching the database password from Secret Manager"
DB_PASSWORD="$(gcloud secrets versions access latest \
  --secret=heykels-db-password --project="$PROJECT")"

# Cloud Shell may or may not ship the v2 proxy, so fetch it when absent. It is a
# single static binary and lands in this directory only.
PROXY="./cloud-sql-proxy"
if ! command -v cloud-sql-proxy >/dev/null 2>&1 && [ ! -x "$PROXY" ]; then
  say "Downloading the Cloud SQL Auth Proxy"
  curl -sSL -o "$PROXY" \
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.linux.amd64"
  chmod +x "$PROXY"
elif command -v cloud-sql-proxy >/dev/null 2>&1; then
  PROXY="cloud-sql-proxy"
fi

say "Opening a tunnel to $CONNECTION"
"$PROXY" --port "$PORT" "$CONNECTION" &
PROXY_PID=$!
# Always tear the tunnel down, including on failure or Ctrl-C.
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && break
  sleep 1
done

say "Installing dependencies (first run only, ~1 minute)"
[ -d node_modules ] || npm ci --no-audit --no-fund

say "Applying migrations"
# The proxy exposes Cloud SQL on localhost, so this is an ordinary TCP connection.
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}?schema=public" \
  npx prisma migrate deploy

say "Database is up to date"
