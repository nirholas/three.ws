---
mode: agent
description: "Track embed views, skill invocations, and session duration — without tracking users"
---

# Stack Layer 4: Embed Telemetry

## Problem

We need to know which agents are being embedded, where, how often they're interacted with, and which skills get used. Without tracking individual users (privacy-first).

## Implementation

### Events

POST to `/api/telemetry` (batched, fire-and-forget from client):
- `embed.view` — iframe loaded. Fields: `{ avatarId, parentOrigin, kiosk, theme, ua }`
- `embed.skill.invoked` — `{ avatarId, skillId, parentOrigin }`
- `embed.session.duration` — on pagehide: `{ avatarId, parentOrigin, ms, interactions }`

### Privacy

- Do NOT send: user id, wallet, IP (server drops it), cookies, referrer path (only origin).
- Hash the parent origin with a daily-rotating salt if you want aggregate origin counts without storing the raw value long-term. Start without hashing for v1.
- Respect `Do-Not-Track` header.

### Storage

`agent_telemetry` table in Neon:
```sql
avatar_id, event, parent_origin, kiosk bool, theme, ua_bucket, occurred_at
```

Keep raw events 30 days, then aggregate into `agent_telemetry_daily` rollups.

### Dashboard

Owner-only page `/dashboard/agents/:slug/stats`:
- 7-day / 30-day views.
- Top parent origins.
- Top skills invoked.
- Avg session duration.
- Sparkline of daily views.

### Rate limit

Drop events exceeding 100/min per avatar from a single IP. Use Upstash Redis.

### Batch + throttle

Client buffers events up to 10 or 5 seconds, then POSTs. Flush on `pagehide`.

## Validation

- Embed an agent in a test page → `embed.view` logged within 5s.
- Trigger 3 skills → 3 `embed.skill.invoked` events.
- Close the tab → `embed.session.duration` event captured.
- Stats dashboard shows the events.
- DNT header set → no events sent.
- `npm run build` passes.

## Do not do this

- Do NOT use Google Analytics / third-party tracker — build it in.
- Do NOT log IP or UA to the DB raw — bucket the UA (mobile/desktop/bot).
