# Task: List all agents owned by a wallet address

## Context

Repo: `/workspaces/3D`. Canonical ERC-8004 identity is already wired in [src/erc8004/abi.js](../../src/erc8004/abi.js). The ABI exposes `balanceOf(address)` and the `Registered` / `Transfer` events — but **does not** expose an ERC-721 enumerable `tokenOfOwnerByIndex`. The canonical identity contract is non-enumerable and **reverts on `totalSupply()`**.

The dashboard at [public/dashboard/](../../public/dashboard/) needs a "my agents" view that lists every agent a connected wallet owns, across the chains we support. Today there is no chain-side resolver for this; the dashboard only reads from our backend.

Task 01 ([01-hydrate-agent-from-chain.md](./01-hydrate-agent-from-chain.md)) provides `hydrateFromChain({ chainId, agentId })`. This task builds the list-of-ids step that feeds into it.

## Goal

Add a read-only function that takes `(walletAddress, chainId)` and returns an array of `agentId`s currently owned by that address. Must handle the non-enumerable contract, must use **event log scanning** (`Transfer` + `Registered`), must tolerate RPC log-range limits, and must be reasonably fast (< 2s cold on Base Sepolia).

## Deliverable

1. New file [src/erc8004/wallet-agents.js](../../src/erc8004/wallet-agents.js) exporting:
   - `async function listAgentsByOwner({ owner, chainId, rpcURL?, fromBlock? })` → `Promise<{ agentId: bigint, tokenURI: string | null }[]>`
   - `async function listAgentsAcrossChains({ owner, chainIds?, rpcURL? })` → `Promise<{ chainId, agents }[]>` — defaults to iterating every chain in `REGISTRY_DEPLOYMENTS`, concurrency cap of 4.
2. Strategy inside `listAgentsByOwner`:
   - First pass: call `balanceOf(owner)`. If it returns 0n → return `[]` early.
   - Second pass: scan `Transfer(from, to, tokenId)` where `to === owner` from `fromBlock` (default: chain deployment block if known, else `0`) to `latest`, in chunks of 10_000 blocks (configurable const `LOG_CHUNK = 10_000`), retrying halved on `-32005` / `range too large` errors down to `LOG_CHUNK_MIN = 500`.
   - Collect `tokenId`s where the most recent Transfer whose party is `owner` resulted in `owner` being the `to`. Verify final ownership with `ownerOf(tokenId)` and drop tokens that have since moved.
   - For each surviving token, call `tokenURI(tokenId)` in parallel with a 6-wide limit. Swallow `tokenURI` errors as `tokenURI: null` — a token with no URI is still owned.
3. Dashboard integration:
   - In [public/dashboard/](../../public/dashboard/), find the module that renders "my agents" (look for the fetch to `/api/agents/me`). Add a secondary list sourced from `listAgentsAcrossChains` for the currently connected wallet, merged with the backend list by `meta.onchain.agentId`. De-dupe: if an agent already shows in the backend list with a matching `(chainId, agentId)`, **don't add it twice**; decorate the backend card with an "on-chain" badge instead.
4. Expose the helper in [src/erc8004/index.js](../../src/erc8004/index.js) (create if missing) as a barrel export next to `registerAgent`.

## Audit checklist

- No `totalSupply()` anywhere.
- Works on any chain in `REGISTRY_DEPLOYMENTS`.
- Handles RPCs that cap `eth_getLogs` ranges: back off + chunk.
- Concurrency caps: 4 chains at a time, 6 `tokenURI` reads at a time. No unbounded `Promise.all`.
- Owner-address comparison is case-insensitive (`getAddress()` checksum both sides before comparing).
- Returns `bigint` agentIds. Downstream must `.toString()` before passing to `hydrateFromChain`.
- Does not require a signer.
- Cold path on an empty wallet completes in < 500ms (balance 0 → bail).
- Never throws on a single-chain failure in `listAgentsAcrossChains`; logs and returns `{ chainId, agents: [], error }` for that chain.

## Constraints

- No new dependencies.
- `ethers` only. `JsonRpcProvider` only — no signer.
- Use the RPCs in `DEFAULT_RPCS` from [src/manifest.js](../../src/manifest.js). Extend it if a chain you need is missing.
- Don't add this to `AgentIdentity`. This is a list utility, not an identity.
- Don't cache to localStorage in the util. Dashboard may cache at its own layer.
- The dashboard HTML/JS is vanilla — do not introduce a framework.

## Verification

1. `node --check src/erc8004/wallet-agents.js` plus any file you edited in `public/dashboard/`.
2. `npx vite build` — passes (ignore `@avaturn/sdk`).
3. In a browser console on dev server:
   ```js
   const { listAgentsByOwner, listAgentsAcrossChains } = await import('/src/erc8004/wallet-agents.js');
   const agents = await listAgentsByOwner({ owner: '0x...', chainId: 84532 });
   console.log(agents.length, agents.slice(0,3));
   const all = await listAgentsAcrossChains({ owner: '0x...' });
   console.log(all);
   ```
4. On the dashboard, connect a wallet that owns ≥ 1 on-chain agent (use the pre-registered CZ agent after [cz-demo/02](../cz-demo/02-cz-preregistered-agent.md) lands). Confirm it appears with the "on-chain" badge. Confirm backend agents still render.
5. Empty wallet: no crash, empty state shown.

## Scope boundaries — do NOT do these

- Do not build a new dashboard UI from scratch — integrate with the existing one.
- Do not add a backend endpoint for this — it's a client-side chain read.
- Do not query a third-party indexer (Alchemy, The Graph). RPC + logs only.
- Do not write the hydration logic (that's 01). Just return ids + tokenURIs.
- Do not paginate across `Registered` events as the source of truth; `Registered` fires at mint time but tokens may have been transferred since. `Transfer` is authoritative.

## Reporting

- Files created / edited.
- Observed wall-clock on a wallet with 3–5 on-chain agents on Base Sepolia.
- Any chain whose default RPC choked on log range limits — note the fallback you used.
- Any dashboard wiring surprises.
- `npx vite build` status.
