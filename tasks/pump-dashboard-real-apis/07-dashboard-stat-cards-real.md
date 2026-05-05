# 07 — Dashboard stat cards: add the cards that `updateDashboard()` already targets, and wire them to real data

## Problem
[pump-dashboard.html](../../pump-dashboard.html) `updateDashboard()` (lines ~1188–1200) writes to DOM IDs that **do not exist on the page**:
- `stat-bot-status`
- `stat-bot-mode`
- `stat-claims`
- `stat-watches`
- `stat-uptime`

`updateUptime()` (lines ~1202–1211) also writes to `stat-uptime`. The reads silently no-op every 10 seconds. The user gets zero visibility into bot state. This is dead wiring shipped to production.

## Outcome
The Dashboard page renders a stat-card row at the top with five cards — **Bot Status**, **Mode**, **Claims Detected**, **Active Watches**, **Uptime** — that update from the real `GET /api/healthz` payload every 10 seconds (the existing poll). Numbers match what `curl /api/healthz` returns.

## Endpoint
[api/healthz.js](../../api/healthz.js) is the source of truth. If it does not currently expose `monitor.running`, `monitor.mode`, `monitor.claimsDetected`, `watches.total`, and `uptime`, extend it to include them — read real values from the Postgres tables (`pump_claims`, `watches`, plus a process uptime) using the existing `sql` helper. **Do not synthesize values in the frontend** and **do not return constants** from the endpoint.

## Implementation
1. In [api/healthz.js](../../api/healthz.js), confirm/extend the response shape:
   ```json
   {
     "ok": true,
     "uptime": 12345,
     "monitor": { "running": true, "mode": "live", "claimsDetected": 42 },
     "watches": { "total": 3 }
   }
   ```
   `claimsDetected` = `SELECT count(*) FROM pump_claims`. `watches.total` = `SELECT count(*) FROM watches WHERE deleted_at IS NULL`. `monitor.running` = whether the bot worker process has reported a heartbeat in the last 60s (table `bot_heartbeat`); if no such table exists yet, add the migration in [migrations/](../../migrations/) and write a real heartbeat from [workers/](../../workers/). No hardcoded `running: true`.
2. In [pump-dashboard.html](../../pump-dashboard.html), insert a `.stats-grid` block at the top of `#page-dashboard` containing five `.stat-card` divs with IDs `stat-bot-status`, `stat-bot-mode`, `stat-claims`, `stat-watches`, `stat-uptime` (the same IDs the JS already targets). Reuse the existing `.stat-card` CSS already defined in this file.
3. Real states:
   - Before first response: each card value renders `—` (em dash), not `0` or fake numbers.
   - On API disconnect (the existing `updateApiStatus('error')` path): cards keep their last real value, but flip to a muted color and show a small "stale" badge (real, not faked).

## Definition of done
- Cards visibly update on page load and again 10s later.
- Numbers match `curl http://localhost:3000/api/healthz` exactly.
- Stop the bot worker → within ~60s, `Bot Status` flips to `Stopped` based on real heartbeat absence.
- No hardcoded `running: true` in the codebase response.
- `npm test` green; **completionist** subagent run on changed files.
