# HeyKels

An AI-native search engine where the search box is an agent.

Instead of retaining search terms and cookies, HeyKels retains **context** — durable, human-readable markdown memory documents stored in *your own Google Drive*, consulted and updated on every search.

## How a search works

Every query fans out to two model calls **in parallel**:

| | |
|---|---|
| **Leg A — web** | `gemini-3.5-flash` grounded in Google Search + URL context |
| **Leg B — memory** | `gemini-3.5-flash` over your markdown memory documents |

Both results land in a **sandbox**, and a third `gemini-3.5-flash` call merges them into one cohesive answer. From there the agent can act in your Google Workspace — Gmail, Calendar, Drive, Docs, Sheets — with **every write action gated behind explicit confirmation**.

```
query ─┬─► leg A: web-grounded    ─┐
       └─► leg B: memory-grounded ─┴─► sandbox ─► synthesis ─► answer + tools
                                                      │
                                                      └─► memory writer ─► .md in Drive
```

## Prototype

`prototype/index.html` is a self-contained, no-build clickable prototype of the full UI. Open it directly in a browser:

```bash
open prototype/index.html      # macOS
xdg-open prototype/index.html  # Linux
```

It runs on canned data — no API key, no backend, no network. What it demonstrates:

- The Gemini-style shell: collapsible sidebar, **New Search**, Recent list, light/dark themes
- A live **process panel** showing both legs streaming at once, then merging in the sandbox
- A streamed answer with inline citations and source chips
- A **tool confirmation card** with working Approve / Reject, including the rejection path
- The **Memory** browser — the actual markdown documents, frontmatter and all
- The **Connections** page, granted scopes, and the 7-day token expiry warning

Try the four suggestion chips — each routes to a different scenario (web-heavy, memory-heavy, Gmail draft, Calendar event).

## Status

The prototype is milestone **M0**. The application itself is not built yet — see the implementation plan for the remaining milestones (M1–M8: scaffold, auth, pipeline, Drive memory, Workspace tools, tests).

## Notes on Google verification

Two of the scopes this product needs are **restricted** and require Google app verification plus a paid annual CASA security assessment before non-test users can grant them:

- `gmail.modify` — read, draft, and send mail
- `drive.readonly` — search and read your Drive

Until verification completes, the OAuth app stays in Testing mode, where **Google expires refresh tokens every 7 days**. Expect to reconnect roughly weekly during development. This is Google policy and cannot be worked around in code.
