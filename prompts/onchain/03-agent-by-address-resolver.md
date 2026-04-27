# Task 03 — Resolve an agent by wallet address

## Why

Hosts (Claude, LobeHub) paste a wallet address. We must return the canonical agent record — fetched from chain if we haven't seen the address, cached if we have.

## Read first

- [src/agent-resolver.js](../../src/agent-resolver.js) — existing client resolver
- [src/erc8004/abi.js](../../src/erc8004/abi.js) — contract addresses
- [api/agents/[id].js](../../api/agents/[id].js) — existing single-agent endpoint
- Tasks 01 + 02 deliverables

## Build this

### 1. `GET /api/agents/by-address/:addr`

Public (no auth). Accepts:

- `0x…` address (EIP-55 or lowercased)
- Optional `?chain=base-sepolia` (default: try every deployed chain in order, first hit wins)

Flow:

1. Normalize address to lowercase.
2. Check `agents` cache: `select * from agent_identities where lower(wallet_address) = $1`. If hit and `chain_id` set, return.
3. Otherwise, for each chainId in `REGISTRY_DEPLOYMENTS`:
    - `IdentityRegistry.agentOf(address)` → `agentId` (or 0)
    - If nonzero, `IdentityRegistry.getAgent(agentId)` → `agentURI`
    - Fetch `agentURI` (IPFS → HTTPS gateway fallback, using the `ipfs.js` helper)
    - Build a cache row in `agent_identities` (mark `_source: 'chain'`). Use the metadata's `name`, `description`, `avatar.uri`, `skills`.
    - Return it.
4. If nothing on any chain, 404 with `{ ok: false, error: 'not_registered' }`.

### 2. Client resolver update

Extend [src/agent-resolver.js](../../src/agent-resolver.js):

```js
export async function resolveAgentByAddress(addr, opts) { … }
```

`<agent-three.ws-address="0x…">` — add support in [src/element.js](../../src/element.js). If present and no `agent-id` / `src`, resolve via address and render.

### 3. Caching

- In-memory (`Map`) LRU cache, 5-minute TTL, per chainId.
- Cache miss triggers chain read; cache hits never do.
- Purge cache for an address on `POST /api/agents/by-address/:addr/refresh` (auth: owner only).

### 4. ENS readback

If `addr` looks like an ENS name (`*.eth`), resolve to address first using `ethers.getDefaultProvider('mainnet').resolveName(ensName)`. Task 04 expands this; here just make the happy path work.

## Don't do this

- Do not require auth. This endpoint is the integration point for third-party hosts.
- Do not call the chain on every request. Cache aggressively.
- Do not try to reverse `address → ENS` name here. Out of scope.

## Acceptance

- [ ] `curl /api/agents/by-address/0xabc…` returns an agent record sourced from chain.
- [ ] Second call is served from cache (measure with server timing header `X-Cache: HIT`).
- [ ] `/refresh` forces a re-read.
- [ ] `<agent-three.ws-address="0x…">` in an HTML page renders the avatar.
- [ ] Unregistered address → 404 JSON.
- [ ] `npm run build` passes.

## Reporting

- curl transcripts: miss → hit → refresh → miss
- Server timing summary (avg ms cache hit vs miss)
- Any chain-RPC quirks
