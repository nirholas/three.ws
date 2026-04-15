# 04-05 — View & embed: public agent gallery

**Branch:** `feat/agent-gallery`
**Stack layer:** 4 (View & embed)
**Depends on:** 04-01 (agent page polish)

## Why it matters

When users share their agent, they want it to be discoverable by others. A `/gallery` page surfaces public agents in a card grid with thumbnail + name + reputation. Without discovery the platform is just a hosting service.

## Read these first

| File | Why |
|:---|:---|
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Native-DOM rendering pattern; copy. |
| [api/agents.js](../../api/agents.js) | List endpoint — needs a public scope. |
| [src/agent-resolver.js](../../src/agent-resolver.js) | Resolution helpers. |
| [api/onchain/agent/[chainId]/[tokenId].js](../../api/onchain/agent/[chainId]/[tokenId].js) | Reputation join. |

## Build this

1. Add `GET /api/agents/public` — returns paginated list of agents where `visibility = 'public'`. Response: `{ agents: [{ id, name, thumbnail_url, description, owner_handle, reputation? }], next_cursor }`. Cursor-based pagination, 24 per page.
2. Create `public/gallery/index.html` and `public/gallery/gallery.js`. Three-column responsive grid (single column < 600px). Each card:
   - Square thumbnail (CDN-cached).
   - Name + truncated description.
   - Reputation stars if on-chain.
   - Click → `/agent/<id>`.
3. Filters: search box (debounced 250ms, server-side ILIKE), tag chips (skill-based: `chat`, `art`, `gaming`, `coach`).
4. Add `/gallery` route to [vercel.json](../../vercel.json).
5. Add a "Make public" toggle to dashboard agent settings (re-uses 03-03 metadata flow).
6. Empty state: "No agents yet — create one in /studio."

## Out of scope

- Do not add follow/like/comment.
- Do not add advanced ranking — newest first for v1.
- Do not require auth to view.

## Acceptance

- [ ] `/gallery` lists public agents.
- [ ] Pagination loads next page via cursor.
- [ ] Search filters within < 400ms.
- [ ] Tag chips filter results.
- [ ] Lighthouse a11y ≥ 90.

## Test plan

1. Seed three public agents.
2. Open `/gallery` — confirm grid, click into one.
3. Search by partial name — results filter live.
4. Tag click → server filters.
5. Toggle one to private from dashboard — disappears on next reload.
