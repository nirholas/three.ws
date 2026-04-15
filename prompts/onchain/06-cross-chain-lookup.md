# Task: Cross-chain resolver — read `agentRegistry` eip155 string, don't default to Base

## Context

Repo: `/workspaces/3D`. The ERC-8004 registration JSON identifies the agent's chain via the `registrations[0].agentRegistry` field, which uses the CAIP-10 form:

```json
{
  "registrations": [
    { "agentId": 42, "agentRegistry": "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e" }
  ]
}
```

See [agent-registry.js](../../src/erc8004/agent-registry.js) `buildRegistrationJSON` and [abi.js](../../src/erc8004/abi.js) `agentRegistryId()` which already constructs this string correctly.

**The problem:** today [src/manifest.js](../../src/manifest.js) `loadFromAgentURI` picks a chain based on the URI's `{chain}` segment, and [app.js](../../src/app.js) hash routing often defaults to Base (8453) when the chain isn't specified. Callers that only have a manifest CID (ipfs://...) or an `agentId` without knowing the chain will try Base and silently fail for any agent that lives on Ethereum, Optimism, Arbitrum, a testnet, etc.

This blocks multi-chain demos (including anything using Base Sepolia, which today is our default testnet but isn't what `app.js` chooses when no chain param is present).

## Goal

Make the resolver chain-aware. Any flow that has a registration JSON (directly or via IPFS) must read the `registrations[].agentRegistry` field and use **that** chain — not a hard-coded Base default. Any flow with only an `agentId` and no chain must probe supported chains (cheap, in parallel, early-exit) instead of guessing.

## Deliverable

1. New file [src/erc8004/resolver.js](../../src/erc8004/resolver.js) exporting:
   - `parseAgentRegistry(str)` → `{ chainId: number, registryAddr: string }` or throws. Accepts `"eip155:<n>:<0x…>"`; tolerates whitespace; rejects malformed input with a clear error.
   - `agentRegistryFromJSON(json)` → convenience that finds `json.registrations?.[0]?.agentRegistry` and parses it; returns `null` (not throws) if absent.
   - `async probeAgentAcrossChains({ agentId, chainIds?, rpcURL? })` → returns the first chain on which `ownerOf(agentId)` resolves to a non-zero address. Probes in parallel with concurrency cap 4, 3s per-chain timeout. If no chain has it → `null`. Order of probing: prefer chains whose `deployment.identityRegistry === '0x8004A169…'` (mainnet) first, then testnets. Consumers can pass `chainIds` to restrict.
2. Update [src/manifest.js](../../src/manifest.js):
   - In `loadFromAgentURI`, after parsing the URI's `{chain}` segment, still fetch the tokenURI. Then parse the resolved JSON's `agentRegistry` field. If it **disagrees** with the URI's chain, prefer the JSON's chain and log `console.warn('[manifest] URI chain', chainName, 'disagrees with registration agentRegistry, using JSON chain')`. Re-query `tokenURI` on the correct chain only if the original read failed (don't double-read when data is good).
   - In `normalize()`, stamp the parsed `chainId` / `registryAddr` onto `manifest.id` from the JSON's `agentRegistry` field whenever present, **overwriting** any chain info passed in via `baseURI` / caller hints. Do not silently downgrade existing non-empty fields.
3. Update [01-hydrate-agent-from-chain.md](./01-hydrate-agent-from-chain.md)'s `hydrate.js` (if that task has landed; otherwise note the dependency in your report):
   - After fetching `tokenURI` + parsing JSON, call `agentRegistryFromJSON`; if it yields a chainId different from the requested one, log a warning and **use the JSON's chain** for subsequent operations (reputation, ownerOf), stamping both into `meta.onchain`.
4. Update [src/app.js](../../src/app.js) hash routing:
   - Search for the hard-coded Base chainId fallback (`8453`) used when `agent=...` is present without `chain=...`. Replace with: first try the localStorage identity's `meta.onchain.chainId` if any, else call `probeAgentAcrossChains({ agentId })`. If the probe returns null, render an error banner ("Couldn't find agent on any supported chain. Try adding `&chain=<id>` to the URL.") with a list of supported chains.
5. Document the resolver contract in the top-of-file JSDoc of `resolver.js`: one short table of priority rules, for future readers.

## Audit checklist

- `parseAgentRegistry` rejects:
  - missing `eip155:` prefix
  - non-numeric chainId
  - malformed address (wrong length, non-hex)
- `agentRegistryFromJSON` returns `null` cleanly for registration JSONs that omit `registrations[]` (some minimal manifests do).
- `probeAgentAcrossChains` uses `Promise.any` semantics: the first successful `ownerOf` wins; other probes are cancelled via `AbortSignal` if the RPC client supports it (best-effort — document limitation if `ethers` does not).
- Probe skips chains whose `deployment.identityRegistry` is falsy.
- No unbounded concurrency.
- When probe returns null, error message is human-readable, not a promise rejection.
- Hard-coded `8453` no longer appears in [app.js](../../src/app.js) for this code path. A `grep '8453'` pass on the file shows only unrelated appearances.
- Warning log line when URI chain disagrees with JSON chain is **always** emitted; not swallowed silently.

## Constraints

- No new dependencies.
- `ethers` only.
- Do not change `REGISTRY_DEPLOYMENTS` entries.
- Do not break existing `agent://base/123` URL support. That path still works; Base just isn't the implicit default anymore when chain is absent.
- Keep [resolver.js](../../src/erc8004/resolver.js) under ~180 lines.

## Verification

1. `node --check src/erc8004/resolver.js src/manifest.js src/app.js`.
2. `npx vite build` passes.
3. Unit-ish sanity in a browser console:
   ```js
   const r = await import('/src/erc8004/resolver.js');
   r.parseAgentRegistry('eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e'); // ok
   r.parseAgentRegistry('bad'); // throws
   await r.probeAgentAcrossChains({ agentId: 1 }); // returns { chainId, registryAddr } or null
   ```
4. Manual URL tests:
   - `/#agent=<idOnBaseSepolia>` (no `chain=`) — loads without Base fallback error.
   - `/#agent=<idOnOptimism>&chain=10` — loads on Optimism.
   - `/#agent=<idOnBaseSepolia>&chain=8453` (wrong chain specified) — after fetching tokenURI, prefers the JSON's chain, with console warning.
   - `/#agent=999999999` — probe returns null, error banner shown.
5. Check that [src/manifest.js](../../src/manifest.js) `loadManifest('ipfs://<CID>')` correctly picks up the `agentRegistry` chain and stamps it on `manifest.id.chainId`.

## Scope boundaries — do NOT do these

- Do not add new chains to `REGISTRY_DEPLOYMENTS`.
- Do not introduce a user-facing chain selector. The resolver picks; UI just respects.
- Do not cache probe results — every page load can re-probe (it's cheap; cache later if needed).
- Do not change `buildRegistrationJSON` output — it's already correct.
- Do not touch the backend — this is purely client-side.

## Reporting

- Files created / edited.
- The exact `app.js` code path you replaced (quote the old chain fallback line).
- Probe wall-clock on a hit (< 500ms expected) and a full miss.
- Any RPCs that don't support AbortSignal cancellation — note and move on.
- `npx vite build` status.
