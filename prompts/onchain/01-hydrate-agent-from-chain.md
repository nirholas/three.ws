# Task: Hydrate an AgentIdentity from (chainId, agentId) — read-only

## Context

Repo: `/workspaces/3D`. Canonical ERC-8004 identity contracts are already deployed and wired in [src/erc8004/abi.js](../../src/erc8004/abi.js) — you do **not** need to deploy anything.

Today, [src/agent-identity.js](../../src/agent-identity.js) loads an agent from localStorage or the backend (`/api/agents/:id`). It has no path to hydrate directly **from chain** when all you have is `(chainId, agentId)`. [src/manifest.js](../../src/manifest.js) knows how to resolve `agent://chain/id` into a normalized manifest via `loadFromAgentURI`, but that output is a manifest, not an `AgentIdentity`, and the resolver is not wired from the identity layer.

## Goal

Add a read-only hydration path so any caller with `(chainId, agentId)` can build an `AgentIdentity` — no wallet, no signer required. This unblocks the `/agent/:id` page when the agent exists on-chain but not in our backend, and it is the foundation for 02 (wallet → agents) and 05 (reputation display).

## Deliverable

1. New file [src/erc8004/hydrate.js](../../src/erc8004/hydrate.js) exporting:
   - `async function hydrateFromChain({ chainId, agentId, rpcURL? })` → returns a **plain record** shaped like `AgentRecord` in [agent-identity.js](../../src/agent-identity.js) (`id`, `name`, `description`, `avatarId` — leave `null` if only a body URI is known, `homeUrl`, `walletAddress`, `chainId`, `skills: []`, `meta`, `createdAt`, `isRegistered: true`). Must also set a `meta.onchain = { chainId, agentId, registryAddr, tokenURI, ownerAddress, agentRegistry }` block.
   - Internally:
     - Resolve registry address via `REGISTRY_DEPLOYMENTS[chainId].identityRegistry`. Throw a typed error (`new Error('unknown-chain')` etc.) if missing.
     - Use `JsonRpcProvider` from `ethers` with the given `rpcURL` or fall back to a known default (extend `DEFAULT_RPCS` in [manifest.js](../../src/manifest.js) if new chains are needed, do **not** fork it — import and reuse).
     - Read `tokenURI(agentId)` and `ownerOf(agentId)` via the identity registry.
     - Resolve the `tokenURI` through [src/ipfs.js](../../src/ipfs.js) `resolveURI` / `fetchWithFallback`, then parse the registration JSON.
     - Pass the JSON through `normalize()` in [src/manifest.js](../../src/manifest.js) to reuse the ERC-8004 adapter (preferred) OR read the relevant fields directly — but if you read directly, cover the ERC-8004 `registrations[]` shape and the nested `image` / `body.uri` fallback.
     - Shape the return value so `AgentIdentity` can consume it without further translation.
2. Extend [src/agent-identity.js](../../src/agent-identity.js):
   - Add constructor option `{ onchain: { chainId, agentId, rpcURL? } }`.
   - When `onchain` is set and `autoLoad` is true, the internal `_loadAsync` **tries chain first**, falls back to localStorage/backend if chain hydration throws.
   - Add a new method `async hydrateOnchain({ chainId, agentId, rpcURL? })` that callers can invoke later to merge on-chain fields into the current record (merging only non-empty fields — never overwrite a user-set local name/description with an empty on-chain one).
3. Minimal unit-ish smoke in a REPL (document in the verification block below) — no new test file required.

## Audit checklist

- `hydrateFromChain` works with **no signer** — uses `JsonRpcProvider` only.
- Handles `tokenURI` that returns `''` → throw `Error('no-token-uri')`.
- Handles `tokenURI` that returns a non-JSON body (e.g. the initial placeholder `ipfs://<glbCID>` before `setAgentURI` is called) → return a partial record with `meta.onchain.tokenURI` set and `name: 'Agent #' + agentId`; do not throw.
- Handles `ownerOf` revert (burned / never minted) → throw `Error('not-found')`.
- Handles the ERC-8004 JSON's `registrations[0].agentRegistry` field shape `"eip155:<chainId>:<addr>"` — parse and expose in `meta.onchain.agentRegistry`. Does **not** assume chain from the requested `chainId` arg alone; if the JSON disagrees, prefer the JSON's chain and log a warning.
- Idempotent: calling it twice returns equivalent records.
- Never writes to localStorage from `hydrate.js` directly — that's `AgentIdentity`'s job.
- No `totalSupply()` call — the canonical contract reverts it (see [README](./README.md)).

## Constraints

- No new dependencies.
- Do **not** change `REGISTRY_DEPLOYMENTS` contract addresses. You may add new `DEFAULT_RPCS` entries if a task reviewer asks.
- Stay read-only: do not import `connectWallet`, do not touch `_signer`.
- Keep `hydrate.js` under ~150 lines. It's a thin adapter.
- Do not break the existing `new AgentIdentity({ userId, agentId, autoLoad })` call sites in [app.js](../../src/app.js) and [element.js](../../src/element.js).

## Verification

1. `node --check src/erc8004/hydrate.js src/agent-identity.js`.
2. `npx vite build` — passes (ignore `@avaturn/sdk` warning).
3. In a browser console on a running dev server:
   ```js
   const { hydrateFromChain } = await import('/src/erc8004/hydrate.js');
   const rec = await hydrateFromChain({ chainId: 84532, agentId: 1 });
   console.log(rec);
   // Expect: { id: '84532:1', meta: { onchain: { registryAddr: '0x8004A818...', tokenURI: 'ipfs://...', ownerAddress: '0x...' } }, ... }
   ```
4. Use `new AgentIdentity({ agentId: null, autoLoad: false, onchain: { chainId: 84532, agentId: 1 } }); await ident.load();` and confirm the loaded record has `isRegistered === true` and `meta.onchain.tokenURI` set.
5. Negative case: pass `agentId: 99999999` on a testnet and confirm `Error('not-found')`.

## Scope boundaries — do NOT do these

- Do not add a UI for this (05 handles reputation display; the dashboard/profile pages will consume this later).
- Do not wire signer-requiring calls — this task is strictly read-only.
- Do not add reputation queries here (that's 05).
- Do not add wallet enumeration (that's 02).
- Do not change the backend `/api/agents/:id` contract.
- Do not redeploy or change any contract addresses.

## Reporting

- Files created / edited (name the exported symbols added).
- Any `DEFAULT_RPCS` entries added and why.
- Any ERC-8004 registration JSONs you encountered in the wild that didn't fit the normalized shape — note them, do not "fix" them.
- Verification console output (paste the record shape you observed).
- Any unrelated bug noticed (report only — do not fix).
