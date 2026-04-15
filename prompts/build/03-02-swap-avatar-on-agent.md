# 03-02 — Swap which avatar an agent uses

## Why it matters

A user may have multiple avatars (from multiple selfies, or from upload/Avaturn) but one agent identity. They need a dashboard control to pick which avatar is the "face" of their agent. This is the minimum edit primitive: no model tweaking, just selection.

## Context

- Agent ↔ avatar link: `agent_identities.avatar_id` ([api/_lib/schema.sql](../../api/_lib/schema.sql)).
- Agent update endpoint: [api/agents/[id].js](../../api/agents/[id].js) — `PUT` accepts `avatar_id`.
- Avatar listing: [api/avatars/index.js](../../api/avatars/index.js) — `GET` returns caller's avatars.
- Agent fetch: `/api/agents/me` via [api/agents.js](../../api/agents.js).
- Dashboard entry: [public/dashboard/index.html](../../public/dashboard/index.html).

## What to build

### Dashboard — avatar picker for the agent

On the dashboard, add a section labeled **"My agent."** It shows:

- The current agent's name (editable inline, PUT to `/api/agents/:id`).
- A grid of the user's avatars as thumbnails. The currently-selected avatar has a highlighted border.
- Clicking another avatar → optimistic swap, then PUT `/api/agents/:id { avatar_id }`. On error, revert and show a toast.

Reuse the existing dashboard CSS theme. No new page.

### Thumbnail endpoint (if not already present)

The avatar grid needs a thumbnail. If `avatars.thumbnail_key` is populated and served via R2 public base, use it. If not, render the GLB into a still PNG on first access and cache it.

- New endpoint `api/avatars/[id]/thumbnail.js` (GET, 302 redirects to R2 public URL once generated).
- Generation strategy: open a headless puppeteer-less renderer is overkill — instead, require the upload flow to set `thumbnail_key`. For selfie-generated avatars, capture a frame during generation (RPM typically returns one). For legacy avatars without thumbnails, fall back to a stock silhouette image.

If rendering thumbnails is too heavy to ship in this prompt, stub the endpoint to return a default PNG and defer real thumbnails to a later prompt. Document the decision.

## Out of scope

- Avatar deletion from this UI (covered elsewhere).
- Renaming avatars from this UI.
- Multiple agents per user (one agent is the v1 assumption).

## Acceptance

1. Dashboard shows "My agent" section with agent name and avatar grid.
2. Clicking a different avatar updates the selection visibly within 200ms.
3. Refreshing the page shows the new selection persisted.
4. `/agent/:id` renders with the chosen avatar.
5. Setting `avatar_id` to an avatar owned by someone else → server returns 400/403 (verify the existing endpoint already enforces ownership; add check if missing).
6. Editing the agent name persists.
