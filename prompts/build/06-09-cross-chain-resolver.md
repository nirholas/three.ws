# 06-09 — Onchain: cross-chain agent resolver

**Branch:** `feat/cross-chain-resolver`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-06 (indexer)

## Why it matters

An agent identifier in the wild looks like `did:erc8004:<chainId>:<tokenId>` or a bare `tokenId@chainName`. Today our resolver only looks at one chain. Hosts pasting an agent URL from a different chain see "agent not found." A unified resolver that probes the indexer (and falls back to RPC) makes IDs portable across the 14 mainnets.

## Read these first

| File                                                                                       | Why                                             |
| :----------------------------------------------------------------------------------------- | :---------------------------------------------- |
| [src/agent-resolver.js](../../src/agent-resolver.js)                                       | Today's resolver.                               |
| [src/erc8004/abi.js](../../src/erc8004/abi.js)                                             | Address map per chain.                          |
| [api/onchain/agent/[chainId]/[tokenId].js](../../api/onchain/agent/[chainId]/[tokenId].js) | Indexer read endpoint from 06-06.               |
| [src/manifest.js](../../src/manifest.js)                                                   | Manifest loader — adapt to chain-specific URIs. |

## Build this

1. Define the canonical agent ID format and document it in `specs/AGENT_ID.md` (single new file allowed for this prompt):
    - Preferred: `did:erc8004:<chainId>:<tokenId>` (CAIP-style)
    - Aliases accepted: `<chainName>:<tokenId>`, `<tokenId>@<chainName>`
    - Names: `mainnet, sepolia, base, optimism, arbitrum, polygon, bnb, avalanche, fantom, gnosis, scroll, linea, blast, mode`
2. Add `src/agent-id.js`:
    ```js
    export function parseAgentId(input)  // → { chainId, tokenId } | null
    export function formatAgentId(chainId, tokenId)
    export function chainNameToId(name)
    ```
3. Extend [src/agent-resolver.js](../../src/agent-resolver.js):
    - If input parses as a chain-qualified ID, hit `/api/onchain/agent/:chain/:token` first.
    - On miss, fall back to live RPC read of `tokenURI(tokenId)` from IdentityRegistry on that chain.
    - Cache hits in `sessionStorage` for 5 minutes.
4. Update `<agent-three.ws-id="…">` to accept the qualified format.
5. Bare numeric IDs (no chain) default to the production primary chain (configurable via env, default `1`).

## Out of scope

- Do not implement on-chain ENS-style name resolution (later).
- Do not touch SIWE chain logic — independent.
- Do not migrate existing agents' off-chain id format.

## Acceptance

- [ ] `parseAgentId('did:erc8004:1:42')` → `{ chainId: 1, tokenId: 42n }`.
- [ ] `parseAgentId('base:7')` → `{ chainId: 8453, tokenId: 7n }`.
- [ ] `<agent-three.ws-id="did:erc8004:11155111:1">` resolves via indexer.
- [ ] Indexer miss falls back to RPC and caches.
- [ ] `npm run build` passes.

## Test plan

1. Boot anvil; mint a test agent on chain 31337; index it.
2. `<agent-three.ws-id="did:erc8004:31337:1">` resolves.
3. Visit a hardcoded `did:erc8004:1:99999` (does not exist) — graceful "not found" UI.
4. Confirm cache hit on a second resolution within 5 min.
