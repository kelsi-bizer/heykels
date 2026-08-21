# HeyKels

An AI-native search engine where the search box is an agent.

Instead of retaining search terms and cookies, HeyKels retains **context** — durable markdown documents stored in *your own Google Drive*, consulted and updated on every search. You can read or delete any of them in Drive without the app in the loop, and edit them on the app's Memory page, which writes straight back to the same Drive files. (Editing lives in the app because Drive's own UI can only preview `.md` files — and "Open with Google Docs" edits a converted copy the agent never reads.) That is the point: the personalization is legible and yours, not an opaque profile inferred from click history.

## How a search works

Every query fans out to two model calls **at the same time**:

| Leg | What it does |
|---|---|
| **A — web** | `gemini-3.5-flash` grounded in Google Search + URL context |
| **B — memory** | `gemini-3.5-flash` over your own markdown memory documents |

Both land in a **sandbox**, and a third call merges them into one answer. From there the agent can act in Google Workspace — but **every action that changes something is confirmed by you first**.

**Memory can be imported, not just learned.** The Memory page takes a hand-written note, or a **ChatGPT / Claude data-export .zip** (also a bare `conversations.json`, or memory pasted into a `.txt`/`.md`). Imports are *distilled, never dumped*: only what **you** wrote in those conversations is read — assistant replies say nothing reliable about you — newest first, through the same fact-extraction contract the turn writer uses, so imported memory merges with searched memory instead of forming a second system. Big exports are processed newest-first up to a per-import budget; the result says what was skipped, and importing again continues.

**Photo turns swap leg A.** Attach a photo from the search box (＋ → Camera on a phone opens the camera directly) and a vision call transcribes the document instead of searching the web — the page in your hand beats the internet's guess about it. Dated events found on the page (a school calendar, a schedule) become a batch of `calendar_create_event` proposals on the same approval card as every other write, and the transcription flows into memory like anything else the search learned.

```
query ─┬─► leg A: web-grounded    ─┐
       └─► leg B: memory-grounded ─┴─► sandbox ─► synthesis ─► answer + tools
                                                      │
                                                      └─► memory writer ─► .md in Drive
```

## Requirements compliance

| # | Requirement | Where it lives |
|---|---|---|
| 1 | **Gemini 3.5 or newer**, via Gemini API **or** Vertex AI | `lib/pipeline/client.ts` — `gemini-3.5-flash` for all four roles, via the **Gemini API**. A Vertex switch exists, but the Interactions API this pipeline uses is served only by `generativelanguage.googleapis.com` — on Vertex the `/interactions` path 404s (verified in production) — so the switch warns loudly and deployments use an API key. |
| 2 | **A Google agent framework** | The **Google GenAI SDK** (`@google/genai`) is what the whole pipeline is built on — the Interactions API, streaming, function calling, and the multi-turn tool loop. See `lib/pipeline/synthesis.ts`. |
| 3 | **Google Cloud infrastructure** | **Cloud Run** (`Dockerfile`, `cloudbuild.yaml`) and **Cloud SQL for PostgreSQL** (`lib/db-url.ts` resolves the mounted socket). |

## Running it locally

```bash
npm install
cp .env.example .env          # then fill in the values below
./scripts/dev-db.sh           # local Postgres (or point DATABASE_URL anywhere)
npx prisma migrate dev
npm run dev
```

You need, at minimum:

- `AUTH_SECRET` and `APP_ENCRYPTION_KEY` — both `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — a Google OAuth client with **two** redirect URIs registered:
  `http://localhost:3000/api/auth/callback/google` (sign-in) and
  `http://localhost:3000/api/google/callback` (the Workspace grant)
- `GEMINI_API_KEY`, or `GOOGLE_GENAI_USE_VERTEXAI=true` plus `GOOGLE_CLOUD_PROJECT`

`npm test` and `npm run build` need neither a database nor an API key.

To click around without Google credentials, `node scripts/seed-dev.mjs` creates a user, a session token, and sample data; set the cookie `authjs.session-token=dev-session-token-abc123`.

## Deploying to Cloud Run

None of this is needed to run the app — it is only for putting HeyKels on the internet.

```bash
./scripts/setup-gcloud.sh YOUR_PROJECT_ID     # one time; safe to re-run
gcloud builds submit --config cloudbuild.yaml --substitutions _REGION=us-central1,_INSTANCE=heykels-db
```

The setup script enables the APIs, creates the Cloud SQL instance and the Artifact Registry repo, generates and stores the secrets, and — the step most guides omit — grants the Cloud Run and Cloud Build service accounts the IAM roles they need. Without those grants the deploy succeeds and the app then fails at runtime, unable to read its own secrets or reach the database.

**Deployments use a Gemini API key** (stored in Secret Manager as `heykels-gemini-key`). Vertex AI would be preferable — no key to rotate — but the Interactions API is not served on Vertex; the `/interactions` path 404s there, which surfaced in production as every search hanging. The `GOOGLE_GENAI_USE_VERTEXAI` switch remains for when Google ships it, and warns loudly if enabled.

Migrations run as their own Cloud Build step *before* traffic shifts — running them from the app on boot would race across concurrently starting instances. The service is deployed with `--no-cpu-throttling` and a 300s timeout because throttled CPU stalls a streaming response between tokens.

## A few decisions worth knowing

**The web leg returns plain text, not JSON.** Gemini's `url_citation` annotations carry character offsets into the model's text output. Forcing JSON makes those offsets index into a serialized string, so every citation silently points at the wrong span. Sources come from the annotations, never from anything the model writes about its own sources.

**Approval is a stream handoff, not a pause.** An HTTP response cannot block waiting for you to click Approve. So the stream ends on a `tool_proposed` event, the pending call is persisted, and your decision opens a *new* stream that continues the same Gemini interaction. It survives a page refresh, and it works on serverless. A rejection still sends a function result — omitting one leaves the interaction parked forever and poisons every later turn in the thread.

**Legs settle independently.** `Promise.allSettled`, never `Promise.all`: a rate limit on one leg must not discard the other's work. A failed leg degrades the answer and says so rather than failing the search.

**Memory reads never touch Drive.** Drive is the source of truth, but the search path reads a Postgres mirror; Drive syncs incrementally via `changes.list`. Writes merge by union of facts rather than overwriting, because two searches finishing close together would otherwise silently discard each other's learning.

**Memory documents are hidden from Drive search.** `drive_search_files` filters them out — they already reach the model through leg B, and surfacing them twice would invite the agent to rewrite memory outside the writer path.

## Google verification

Two scopes are **restricted** and need Google app verification plus a paid annual CASA security assessment before anyone outside your OAuth test-user list can grant them:

- `gmail.modify` — read, draft, and send mail
- `drive.readonly` — search and read your Drive

`drive.file` is requested alongside `drive.readonly` and is not redundant: read-only Drive cannot create the memory documents.

Until verification completes the app stays in Testing mode, where **Google expires refresh tokens every 7 days**. Expect to reconnect roughly weekly. That is Google policy and cannot be worked around in code — the app surfaces a Reconnect banner rather than failing quietly.

## Prototype

`prototype/index.html` is the original self-contained design prototype, kept because it still runs in any browser with no build step and no backend. The application's stylesheet is generated from it, so the two stay visually identical.

## Layout

```
app/                      routes: /login, /search, /search/[id], /memory, /settings/connections
  api/search/[id]/turn    NDJSON stream — runs the pipeline
  api/search/[id]/resume  second half of the approval handoff
  api/google/connect      Workspace consent (hand-rolled; Auth.js cannot widen scopes reliably)
lib/pipeline/             client, web leg, memory leg, sandbox, synthesis, orchestrator
lib/memory/               markdown docs, Drive store, cache sync, retrieval, writer
lib/workspace/tools/      Gmail, Calendar, Drive, Docs, Sheets
```
