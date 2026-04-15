---
mode: agent
description: "Public /agents gallery — discover, search, featured agents"
---

# Stack Layer 4 (support): Agents Gallery

## Problem

Without a discovery page, created agents are islands. Need a public `/agents` gallery that lists public avatars, supports search, and surfaces featured agents.

## Implementation

### Page

`public/agents/index.html` — native DOM, infinite scroll.

### Data

`GET /api/avatars/public?cursor=&q=&tag=&sort=recent|popular`:
- Returns `{ items: [...], nextCursor, total }`.
- Items: `{ id, slug, name, bio, thumbnailUrl, ownerHandle, skillsCount, onchain: bool, createdAt }`.
- Only `visibility: 'public'`, not soft-deleted.
- Cursor is created_at-based for `recent`, score-based for `popular`.

### Card

Each card shows: small 3D preview (static thumbnail, not live viewer — perf), name, bio, skills count, verified-onchain badge. Click → `/agent/:slug`.

### Thumbnails

Generated at publish time (stack-15 or a separate cron): render the avatar's idle frame to a 512×512 PNG and cache. Store URL in `avatars.thumbnail_url`.

### Featured

`featured` bool on `avatars` table. Editable only by admin. Featured agents surface at top with a badge.

### Search

Simple Postgres full-text on `name`, `bio`, and denormalized skill names. Use `pg_trgm` for fuzzy match.

### Tags

Denormalized from attached skills' tags. Filter chips at the top ("3d", "assistant", "creative"…).

### Empty state

If no agents yet: "Be the first. Create your agent →" link to `/create/`.

## Validation

- `/agents` lists public avatars with thumbnails.
- Search "satoshi" finds matching agents.
- Scroll to bottom → next page loads.
- Private / deleted avatars never appear.
- `npm run build` passes.

## Do not do this

- Do NOT render live viewers for each card — thumbnails only (one live viewer per card would kill the page).
- Do NOT expose owner wallets or emails.
