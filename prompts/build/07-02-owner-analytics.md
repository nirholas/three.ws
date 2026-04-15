---
mode: agent
description: "Owner analytics: views, chat msgs, embed loads per agent — shown on the dashboard"
---

# 07-02 · Owner analytics

## Why it matters

Owners who share their agent want to know if anyone's actually interacting with it. Without this, there's no feedback loop. A minimal count — "15 page views, 3 chats, 2 embed loads this week" — is enough to keep owners engaged and validates whether distribution is working.

## Prerequisites

- 04-01 (agent page polish) merged so there's something to measure.
- 07-01 (production readiness) merged so the metrics pipeline exists.

## Read these first

- [api/_lib/http.js](../../api/_lib/http.js) — `wrap()` is where we'll record events.
- [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js) — reuses Upstash Redis.
- [api/_lib/schema.sql](../../api/_lib/schema.sql) — `usage_events` table already exists.

## Build this

### 1. Event recording

Instrument these endpoints to write rows into `usage_events`:

- `GET /agent/:id`  (via a middleware or shared helper) → `kind='agent_view'`.
- `GET /agent/:id/embed` → `kind='agent_embed_view'`.
- `POST /api/agents/:id/chat` (prompt `04-05`) → `kind='agent_chat_msg'`.
- `GET /api/agent-oembed` → `kind='agent_unfurl'`.

Write async and fire-and-forget — a slow insert must never block the request.

### 2. Privacy

- Do not record IP, user agent, referer, or session IDs in `usage_events.meta`. Only the agent_id and the event kind.
- Do not record visitor chat content.
- Events have 90-day retention. Add a nightly cleanup job (can be a simple SQL statement run from a Vercel cron).

### 3. Owner-facing analytics endpoint

`GET /api/agents/:id/analytics` (session-authed, owner-only):

```json
{
  "window_days": 30,
  "totals": { "views": 142, "embeds": 18, "chats": 47, "unfurls": 6 },
  "daily": [
    { "day": "2026-04-01", "views": 5, "embeds": 0, "chats": 3, "unfurls": 0 },
    ...
  ]
}
```

Use `date_trunc('day', created_at)` + `GROUP BY`. Add an index if missing: `(agent_id, kind, created_at)`.

### 4. Dashboard widget

On the dashboard "My agent" section, add a small sparkline + totals panel:

- Last-30-days view count with a sparkline.
- Chat messages, embed loads, unfurls as compact metric tiles.
- A "Last 7 days" / "Last 30 days" toggle.

Keep it small — this is a sidebar widget, not a full analytics page.

### 5. "Public" badge

If the agent has had > 10 views in the last 30 days, show a subtle "Seen by X people" line on the owner's dashboard. Soft social proof.

## Out of scope

- Per-visitor funnels. We don't track visitors.
- Heatmaps, session replay, geographic breakdowns.
- Conversion tracking.
- Exporting CSV of events.

## Acceptance

1. Open `/agent/:id` as a visitor → one `agent_view` row inserted.
2. Reload rapidly 5 times → 5 rows, no rate-limit (we're recording, not restricting).
3. Chat a message → one `agent_chat_msg` row.
4. Owner loads dashboard → sees totals matching DB.
5. Non-owner calling `/api/agents/:id/analytics` → 403.
6. Sentry is clean — no errors from the async insert path.
7. Query plan for the analytics endpoint uses the new index (EXPLAIN).
