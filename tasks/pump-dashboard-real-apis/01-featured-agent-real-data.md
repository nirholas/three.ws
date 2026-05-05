# 01 — Featured Agent panel: replace hardcoded "Agent CZ" with real data

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~485–497 hard‑code the Featured Agent panel:
- `id="featured-agent-name"` defaults to "Agent CZ"
- `id="featured-agent-desc"` is a hardcoded sentence
- `id="featured-agent-link"` points at `/agent-detail.html?id=cz`
- `id="featured-agent-avatar"` is empty

This is fake data shipped to production and violates [CLAUDE.md](../../CLAUDE.md) rule #1 (no placeholders).

## Outcome
On first paint of the Dashboard page, the Featured Agent card shows a **real** agent selected from the platform, with avatar image, real display name, real one‑line bio, and a link to that agent's real detail page.

## Selection rule (no fakery)
Pick "featured" deterministically from real data:
1. Prefer the agent with the highest aggregate `agent_revenue_events.net_total` over the last 30 days (join `agent_identities` to filter `deleted_at IS NULL` and visibility = public).
2. If revenue data is empty for the window, fall back to the most-recently-created public agent (`ORDER BY created_at DESC LIMIT 1`).

Do NOT hardcode agent ids, names, or fallback sample agents.

## Implementation
1. Add a real endpoint `GET /api/agents/featured` in `api/agents/featured.js` using the `sql` helper from [api/_lib/db.js](../../api/_lib/db.js). Return `{ data: { id, slug, display_name, bio, avatar_url, detail_url } }` or 404 when there are zero agents in the DB.
2. In [pump-dashboard.html](../../pump-dashboard.html), remove the hardcoded `Agent CZ` text and "/agent-detail.html?id=cz" href. On `DOMContentLoaded` and on every nav into the Dashboard page, call `apiFetch('/api/agents/featured')` and render:
   - avatar via `<img>` into `#featured-agent-avatar` (use the real `avatar_url`; if the agent has no avatar persisted, render the initials in a styled div — never a stock placeholder image)
   - `display_name`, `bio`, and the real `detail_url`
3. Real loading state (CSS skeleton or "Loading…" text) and real error state ("No agents available yet" only when 404). Do not fake a delay.

## Definition of done
- `curl http://localhost:3000/api/agents/featured` returns a real row from the database.
- Browser network tab shows that request succeeding on dashboard load.
- Removing all rows from `agent_identities` shows the real empty state, not a stub agent.
- No string "Agent CZ" or `id=cz` anywhere in the changed HTML.
- `npm test` green; run **completionist** subagent on changed files.
