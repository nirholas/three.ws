# 11 — Public agents directory

## Why

Bands 4 and 6 both benefit from a public index of every registered agent. Today there's no `/agents` list — you can only view an agent if you already know its id. The existing [public/explore/](../../public/explore/) is for 3D *models*, not agents.

A public directory makes the ecosystem feel alive, lets users discover agents, and is the natural surface to paginate on-chain registrations.

## What to build

### 1. Page

Create `public/agents/index.html`:

- Grid of agent cards: avatar thumbnail (iframe into `<agent-3d>` or a still PNG if available), name, short description, chain badge, registration date, click → `/agent/<id>`.
- Search box: filters by name / id / chain.
- Chain filter chips: All / Base / Base Sepolia / Optimism / Polygon.
- Sort: newest, most-reviewed, alphabetical.
- Pagination (30 per page, URL param `?page=2`).

### 2. Data

Source data from two places:

- **Local backend**: `GET /api/agents` — list endpoint. Check [api/agents/](../../api/agents/) — if a list endpoint already exists, consume it. If not, skip this branch and just use on-chain data. **Don't** create a new `/api/agents` list endpoint (that could conflict with prompt 08).
- **On-chain fallback**: if `/api/agents` isn't available, call `IdentityRegistry` for the latest N agents via a read-only RPC (use the ABI from [src/erc8004/abi.js](../../src/erc8004/abi.js)). Paginate by `agentId` descending.

### 3. Controller

Create `src/agents-directory.js`:

```js
export class AgentsDirectory {
  constructor(container)
  async load({ chain, search, sort, page })
  onCardClick(fn)
}
```

- Caches fetched pages in memory (SWR-style, 60s TTL).
- Uses `IntersectionObserver` to lazy-load avatar thumbnails.

### 4. Card component

Each card should be plain HTML, no framework. Use `loading="lazy"` on images. Every card has a stable `data-agent-id` attr for QA.

### 5. Empty state

If no agents exist yet (likely, pre-launch): show a friendly empty-state with a **"Register yours"** CTA → `/register` (which exists? if not, just link to `/create`).

## Files you own

- Create: `public/agents/index.html`
- Create: `public/agents/boot.js`
- Create: `public/agents/README.md`
- Create: `src/agents-directory.js`

## Files off-limits

- Everything under `api/agents/` — read-only. If a list endpoint doesn't exist, use on-chain fallback; do **not** create a list endpoint.
- `src/erc8004/*` — read-only.
- `public/explore/*` — different feature, don't touch.

## Acceptance

- `http://localhost:3000/agents/` renders without JS errors.
- Empty-state shows when backend returns `[]`.
- Filter / sort / search all work client-side on the already-fetched page.
- Pagination URL is shareable (refresh lands on the same page).
- Lighthouse accessibility score ≥ 90 (describe quickly).
- `npm run build` clean.

## Reporting

Data source used (backend vs on-chain), pagination approach, any endpoint assumptions you made and want verified, accessibility audit summary.
