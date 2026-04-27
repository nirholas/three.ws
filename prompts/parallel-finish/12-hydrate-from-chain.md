# Task: Hydrate dashboard from on-chain — import ERC-8004 agents owned by connected wallet

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [src/CLAUDE.md](../../src/CLAUDE.md) first.

Today, if a user has already minted an ERC-8004 agent on-chain, signing into three.ws does **not** auto-discover it. They have to re-register via `/deploy`, which creates a dupe. We need a "import my on-chain agents" flow.

The crawler at [api/cron/erc8004-crawl.js](../../api/cron/erc8004-crawl.js) indexes all agents into `erc8004_agents_index`. We use that index, filter by owner = user's linked wallets, and offer one-click import.

## Files you own (exclusive — all new)

- `src/erc8004/hydrate.js` — fetch agents for the user's connected wallets, dedupe against existing `agent_identities`, return the delta.
- `api/erc8004/hydrate.js` — `GET /api/erc8004/hydrate` — server-side version that queries `erc8004_agents_index` filtered by the user's `user_wallets` addresses. Returns `{ agents: [{ chainId, agentId, tokenURI, owner, alreadyImported: bool }] }`.
- `api/erc8004/import.js` — `POST /api/erc8004/import` with `{ chainId, agentId }` — creates a local `agent_identities` row pointing at the on-chain record. Idempotent (409 if already imported for this user).
- `public/hydrate/index.html` — standalone page, reachable at `/hydrate/`. Lists discovered agents with avatar thumbnails (resolved from `tokenURI` via `resolveOnChainAgent`), each with an Import button. Connect-wallet prompt if no wallets are linked.

**Do not edit** the crawler, the existing `api/agents/*` endpoints, the dashboard sidebar, or `src/element.js`.

## API details

### `GET /api/erc8004/hydrate`

- Auth required.
- Read user's wallet addresses from `user_wallets`.
- Query `erc8004_agents_index WHERE lower(owner) IN (...)`.
- For each row, check if there's an `agent_identities` row with matching `(erc8004_agent_id, erc8004_agent_id_chain_id, user_id = self)`. Set `alreadyImported`.
- Return shape above.

### `POST /api/erc8004/import`

- Auth required.
- Validate `chainId` (integer, in the 15-chain allowlist) and `agentId` (integer).
- Look up the index row. Must exist. Must be owned by one of the caller's linked wallets.
- Resolve `tokenURI` → metadata (use the existing `resolveOnChainAgent` helper in [api/\_lib/onchain.js](../../api/_lib/onchain.js)).
- INSERT `agent_identities` with the resolved name, description, avatar (download and store via R2 if you want, or link directly — document which you chose).
- 409 if already imported.
- Output `{ agent: { id, erc8004_agent_id, erc8004_agent_id_chain_id, name, avatar_url } }`.

## Client (`public/hydrate/index.html`)

- Auth check on load.
- "Connect wallet" button if `/api/auth/wallets` returns empty (link the standalone `/dashboard/wallets.html` page if it exists in the deployment).
- List of discovered agents with thumbnail, name, chain badge, Import button.
- On Import success: replace the button with a "Go to agent" link.

## Conventions

- ESM, tabs, single quotes. Vanilla JS.
- `sql`/`json`/`error` helpers. Zod validation on the POST.
- Reuse `resolveOnChainAgent` — do not write a new one.

## Out of scope

- Do not build an "export all my local agents to chain" flow (reverse direction).
- Do not change the crawler schedule or schema.
- Do not integrate into the dashboard sidebar.
- Do not handle multi-chain mirror deduplication (same agentId on multiple chains — treat each (chainId, agentId) as distinct).

## Verification

```bash
node --check src/erc8004/hydrate.js
node --check api/erc8004/hydrate.js
node --check api/erc8004/import.js
npm run build
```

Manually: link a wallet that owns an ERC-8004 agent on Base, open `/hydrate/`, confirm the agent appears, click Import, confirm it lands in `/dashboard`.

## Report back

Files created, commands + output, whether you download+rehost thumbnails or link directly, any chain whose RPC was flaky in testing.
