#!/usr/bin/env bash
#
# One-time Google Cloud setup for deploying HeyKels to Cloud Run.
#
# You do NOT need this to run HeyKels. `npm run dev` needs only a Google OAuth
# client and a local database. This is purely for putting it on the internet.
#
#   ./scripts/setup-gcloud.sh YOUR_PROJECT_ID
#
# Safe to re-run: every step either creates the thing or reports it already exists.
# Nothing here is destructive.
set -uo pipefail

PROJECT="${1:-}"
REGION="${REGION:-us-central1}"
INSTANCE="${INSTANCE:-heykels-db}"
DB_NAME="${DB_NAME:-heykels}"
DB_USER="${DB_USER:-heykels}"

if [ -z "$PROJECT" ]; then
  echo "usage: $0 YOUR_PROJECT_ID" >&2
  exit 1
fi

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
# Most gcloud "create" calls fail loudly when the resource exists; that is fine.
ok() { "$@" 2>&1 | sed 's/^/    /' || true; }

gcloud config set project "$PROJECT" >/dev/null
say "Project: $PROJECT   Region: $REGION"

# ── 1. APIs ───────────────────────────────────────────────────────────────────
# Each is enabled independently; a missing one fails only when first called,
# which is why they all go on at once rather than as you hit them.
say "Enabling APIs (this takes a minute)"
ok gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  gmail.googleapis.com \
  calendar-json.googleapis.com \
  drive.googleapis.com \
  docs.googleapis.com \
  sheets.googleapis.com

# ── 2. Artifact Registry ──────────────────────────────────────────────────────
say "Container repository"
ok gcloud artifacts repositories create heykels \
  --repository-format=docker --location="$REGION" \
  --description="HeyKels container images"

# ── 3. Cloud SQL ──────────────────────────────────────────────────────────────
# This section fails LOUDLY, unlike the idempotent steps above. The `ok` helper
# tolerates already-exists errors, but on a first run it once swallowed a real
# creation failure and the script still printed "Setup complete" — every later
# step then failed against a database that was never there. Existence is checked
# explicitly, and a genuine failure stops the script.
say "Cloud SQL instance (slow — several minutes on first run)"
if gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  echo "    instance already exists"
else
  # --edition=enterprise is required: the API otherwise defaults new instances to
  # Enterprise Plus, where the cheap shared-core tiers like db-f1-micro are
  # invalid and creation is rejected with "Invalid Tier".
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_16 \
    --edition=enterprise \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-auto-increase || {
      echo "" >&2
      echo "Cloud SQL instance creation FAILED — stopping here." >&2
      echo "Nothing after this point can work without the database." >&2
      exit 1
    }
fi

say "Database and user"
if ! gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" >/dev/null 2>&1; then
  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" || exit 1
fi

DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
ok gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD"
# If the user already existed the create failed and the generated password is not
# in effect, so set it explicitly to keep the secret below truthful.
gcloud sql users set-password "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD" || exit 1

# ── 4. Secrets ────────────────────────────────────────────────────────────────
# Note there is no Gemini key here: the deploy uses Vertex AI, authenticating as
# the service account, so there is no model credential to store at all.
say "Secrets"
put_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "    $name (new version)"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- >/dev/null
    echo "    $name (created)"
  fi
}

put_secret heykels-db-password     "$DB_PASSWORD"
put_secret heykels-auth-secret     "$(openssl rand -base64 32)"
put_secret heykels-encryption-key  "$(openssl rand -base64 32)"

# These two are yours, from APIs & Services → Credentials. Placeholders are stored
# so the deploy does not fail on a missing secret; fill them in before going live.
if ! gcloud secrets describe heykels-google-id >/dev/null 2>&1; then
  put_secret heykels-google-id     "REPLACE_WITH_OAUTH_CLIENT_ID"
  put_secret heykels-google-secret "REPLACE_WITH_OAUTH_CLIENT_SECRET"
  NEED_OAUTH=1
fi

# ── 5. IAM ────────────────────────────────────────────────────────────────────
# The step people miss. Without these the deploy succeeds and the app then fails
# at runtime: it cannot read its own secrets, reach the database, or call Gemini.
say "Permissions for the Cloud Run service account"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

for role in roles/secretmanager.secretAccessor roles/cloudsql.client roles/aiplatform.user; do
  ok gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" --role="$role" --condition=None
  echo "    runtime: $role"
done

# Cloud Build runs the migration step and deploys, so it needs its own grants.
for role in roles/run.admin roles/cloudsql.client roles/secretmanager.secretAccessor roles/iam.serviceAccountUser; do
  ok gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${BUILD_SA}" --role="$role" --condition=None
  echo "    build: $role"
done

# ── done ──────────────────────────────────────────────────────────────────────
say "Setup complete"
cat <<EOF

    Cloud SQL connection name:  ${PROJECT}:${REGION}:${INSTANCE}
    Database / user:            ${DB_NAME} / ${DB_USER}
    Model access:               Vertex AI (no API key needed)

EOF

if [ "${NEED_OAUTH:-0}" = "1" ]; then
  cat <<EOF
    ⚠ Two secrets still hold placeholders. Create an OAuth client under
      APIs & Services → Credentials, then:

        printf '%s' YOUR_CLIENT_ID     | gcloud secrets versions add heykels-google-id --data-file=-
        printf '%s' YOUR_CLIENT_SECRET | gcloud secrets versions add heykels-google-secret --data-file=-

EOF
fi

cat <<EOF
    Then deploy:

        gcloud builds submit --config cloudbuild.yaml \\
          --substitutions _REGION=${REGION},_INSTANCE=${INSTANCE}

    Cloud Run prints a URL. Add these two to the OAuth client's redirect URIs:

        https://YOUR-URL/api/auth/callback/google
        https://YOUR-URL/api/google/callback

EOF
