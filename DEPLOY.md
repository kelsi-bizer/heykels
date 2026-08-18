# Deploying HeyKels

A step-by-step guide for the `heykels` project (org `bizer.ai`, project number `484024024830`).

**You don't need to install anything.** Every command below runs in Google Cloud Shell — a free Linux terminal inside your browser that already has Git, Node and the Google Cloud tools. Nothing touches your Mac.

Total time: about 25 minutes, most of it waiting on the database.

---

## Before you start

**Billing must be enabled on the project**, or the database step fails. Check at
[console.cloud.google.com/billing/linkedaccount?project=heykels](https://console.cloud.google.com/billing/linkedaccount?project=heykels).
Running cost is a few dollars a month, almost entirely the database.

**Have your OAuth client ID and secret ready.** They're at
[console.cloud.google.com/apis/credentials?project=heykels](https://console.cloud.google.com/apis/credentials?project=heykels)
under *OAuth 2.0 Client IDs*. Click your client; the ID and secret are on the right. You'll paste them in Step 4.

---

## How to use this guide

Open [shell.cloud.google.com](https://shell.cloud.google.com). A black terminal panel opens in your browser.

For each step below, **copy the whole grey block, paste it into that terminal, and press Enter.** Wait until the text stops scrolling and you get your prompt back before moving to the next one.

If something goes wrong, skip to [When something breaks](#when-something-breaks) at the bottom. You can safely re-run any step.

---

## Step 1 — Get the code

```bash
cd ~ && rm -rf heykels && \
git clone https://github.com/kelsi-bizer/heykels.git && \
cd heykels
```

> Cloud Shell may ask you to authorize Git access to GitHub. Say yes.

---

## Step 2 — Point Cloud Shell at the project

```bash
gcloud config set project heykels
```

---

## Step 3 — Create the infrastructure

This turns on the Google services, creates the database, generates your secret keys, and grants permissions.

```bash
./scripts/setup-gcloud.sh heykels
```

**This takes about 10 minutes** and is mostly silent while the database is created. That's normal — don't close the tab.

> Cloud Shell will pop up an **Authorize** button the first time. Click it.

It finishes by printing your connection details and a reminder about the two OAuth secrets, which is Step 4.

---

## Step 4 — Add your OAuth credentials

Two secrets were created as placeholders because only you have these values. Replace them now.

Copy this block, but **swap `PASTE_YOUR_CLIENT_ID_HERE` for your real client ID** before pressing Enter:

```bash
printf '%s' 'PASTE_YOUR_CLIENT_ID_HERE' | \
gcloud secrets versions add heykels-google-id --data-file=-
```

Then the same for the secret:

```bash
printf '%s' 'PASTE_YOUR_CLIENT_SECRET_HERE' | \
gcloud secrets versions add heykels-google-secret --data-file=-
```

Each should print something like `Created version [2]`.

> Keep the single quotes. They stop the shell from mangling special characters in your secret.

---

## Step 5 — Set up the database tables

```bash
./scripts/migrate-cloud.sh
```

Takes a couple of minutes. Ends with **`Database is up to date`**.

---

## Step 6 — Deploy

```bash
gcloud builds submit --config cloudbuild.yaml
```

**About 5 minutes.** Lots of output — that's the container being built. Near the end you'll see a line like:

```
Service URL: https://heykels-484024024830.us-central1.run.app
```

**Copy that URL.** You need it for the next step.

---

## Step 7 — Tell Google where to send people after sign-in

This is the one step that can't be automated, because the URL didn't exist until Step 6.

1. Go to [console.cloud.google.com/apis/credentials?project=heykels](https://console.cloud.google.com/apis/credentials?project=heykels)
2. Click your **OAuth 2.0 Client ID**
3. Under **Authorized redirect URIs**, click **+ ADD URI** twice and add both of these, replacing `YOUR-URL` with the URL from Step 6:

```
https://YOUR-URL/api/auth/callback/google
https://YOUR-URL/api/google/callback
```

4. Click **SAVE**

Both are required — signing in and connecting Workspace are separate flows. Changes can take a few minutes to take effect.

---

## Step 8 — Try it

Open your Cloud Run URL. Work through it in this order — it's designed so each step proves the one before it worked.

1. **Sign in with Google.** You land on the search page with a gradient "Hello, Kelsi".
2. **Search something factual** — *"what's new in AI search this month?"* — **before** connecting Workspace. The answer should stream in with numbered source links. The memory panel will say it has nothing stored yet. That's correct: it proves the live Gemini connection works.
3. **Connect Workspace** from the *Connections* page in the sidebar. Accept the permissions. A **HeyKels Memory** folder appears in your Google Drive with a `profile/basics.md` file in it.
4. **Search something about yourself** — *"what am I working on?"* — then ask a related follow-up. The second answer should reference what it learned, and the process panel shows the memory leg citing that file.
5. **Ask it to do something** — *"draft an email to the team about our launch"*. An approval card appears. Approve it, and the draft is in your Gmail. Reject it, and nothing is sent.

---

## Deploying changes later

Steps 1–5 are one-time. To ship an update afterwards:

```bash
cd ~/heykels && git pull && gcloud builds submit --config cloudbuild.yaml
```

Run `./scripts/migrate-cloud.sh` as well, but only if the database schema changed.

---

## When something breaks

**Paste the error to Claude.** That's the fastest path — the messages are usually specific.

| What you see | What it means |
|---|---|
| `billing account ... not found` in Step 3 | Billing isn't enabled. See *Before you start*. |
| Step 3 seems frozen | Normal. Creating the database really does take ~8 minutes with no output. |
| `Invalid Tier (db-f1-micro) for (ENTERPRISE_PLUS) Edition` | You're on an old copy of the setup script. Run `cd ~/heykels && git pull`, then re-run Step 3. |
| `ENOSPC: no space left on device` | Cloud Shell's 5GB disk is full. Free space with `npm cache clean --force; rm -rf ~/heykels/node_modules`, then re-run the failed step. |
| A later command complains about a missing project | Cloud Shell restarted (it does after ~20 min idle) and forgot the project. Run `cd ~/heykels && gcloud config set project heykels` and carry on. Your files survive restarts; the setting doesn't. |
| `PERMISSION_DENIED` in Step 6 | The permission grants in Step 3 didn't finish. Re-run `./scripts/setup-gcloud.sh heykels`. |
| `Error 400: redirect_uri_mismatch` at sign-in | Step 7 is missing, has a typo, or hasn't propagated. Check both URIs, and that there's no trailing slash. |
| Signed in, but bounced back to the login page | Usually the cookie. Try an incognito window. |
| "Access blocked: app not verified" | Expected. Your Google account must be on the **Test users** list under *Google Auth Platform → Audience*. |
| Search spins, then errors | The Gemini call failed. Check the logs, below. |
| Workspace disconnects after about a week | Expected, and not a bug — Google expires tokens every 7 days for unverified apps. Click **Reconnect**. |

**To read the application logs:**

```bash
gcloud run services logs read heykels --region us-central1 --limit 50
```

**To check the app is configured as expected:**

```bash
gcloud run services describe heykels --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)'
```

---

## What you just built

| Piece | What it is |
|---|---|
| **Cloud Run** | Runs the app. Scales to zero when nobody's using it, so idle costs nothing. |
| **Cloud SQL** | PostgreSQL. Holds your searches, and a fast local copy of your memory files. |
| **Vertex AI** | Serves `gemini-3.5-flash`. Authenticates as the service account — no API key anywhere. |
| **Secret Manager** | Holds the five secrets. Never in the container image, never in build logs. |
| **Your Google Drive** | The real home of your memory. Markdown files you can read, edit or delete yourself. |
