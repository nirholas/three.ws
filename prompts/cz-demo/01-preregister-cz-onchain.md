# Task 01 — Pre-register the CZ agent onchain

## Why this exists

Before the demo, the CZ agent must already exist as an onchain record on Base Sepolia (or mainnet, depending on the call made in this task). "Existing onchain" = a row in `IdentityRegistry.agents` with a known `agentId`, a metadata URI pointing to the registration JSON (IPFS), and either `owner = 0x0` (claimable) or `owner = us` (transferable). This is the anchor every other CZ-demo task depends on.

## Shared context

- Contracts: [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol), deploy script [contracts/script/Deploy.s.sol](../../contracts/script/Deploy.s.sol). Foundry project.
- Registration helpers (client-side, used today for user flows): [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — functions `registerAgent`, `buildRegistrationJSON`, `pinToIPFS`.
- Canonical CZ avatar: [public/avatars/cz.glb](../../public/avatars/cz.glb) — already in repo. Do **not** regenerate.
- Known addresses in [src/erc8004/abi.js](../../src/erc8004/abi.js) under `REGISTRY_DEPLOYMENTS`. If Base Sepolia is not in there, [onchain/01-deploy-identityregistry-base-sepolia.md](../onchain/01-deploy-identityregistry-base-sepolia.md) deploys it — run that task first.
- IPFS: [src/ipfs.js](../../src/ipfs.js) handles gateway resolution. Pinning uses web3.storage / Filebase tokens from env.

## What to build

### 1. Registration JSON for the CZ agent

Create `scripts/cz-demo/registration-cz.json` (committed, not generated). Shape:

```json
{
  "type": "agent-registration/0.1",
  "name": "CZ",
  "description": "Test agent for the CZ demo — the canonical embodied agent for demonstrating portable onchain identity.",
  "body": {
    "uri": "https://3d.irish/avatars/cz.glb",
    "format": "glb"
  },
  "brain": { "provider": "anthropic", "model": "claude-opus-4-6" },
  "skills": ["greet", "present-model", "validate-model", "remember", "think", "sign-action"],
  "owner": "0x0000000000000000000000000000000000000000",
  "createdAt": "2026-04-15T00:00:00Z",
  "demo": { "slug": "cz" }
}
```

`owner: 0x0` signals "claimable." If the contract requires a non-zero owner at register-time, set it to a disposable ops-owned EOA and have task 03 do a `transferOwner` call instead.

### 2. Pin to IPFS script

Create `scripts/cz-demo/pin-registration.mjs`:

- Read `registration-cz.json`.
- Read `WEB3_STORAGE_TOKEN` (or `FILEBASE_TOKEN`) from env.
- Pin via `src/ipfs.js` helpers or a minimal in-script HTTP call. Output the returned CID to stdout.
- Verify by fetching `https://ipfs.io/ipfs/{cid}` and diffing against the source JSON.
- Save `{ cid, pinned_at }` into `scripts/cz-demo/.state.json` (gitignored) so follow-up scripts can read it.

### 3. Register onchain script

Create `scripts/cz-demo/register-onchain.mjs`:

- Read `CHAIN_ID` (default `84532` for Base Sepolia) and `DEPLOYER_PRIVATE_KEY` from env. Document both in `scripts/cz-demo/README.md`.
- Use `viem` (`createWalletClient`, `http` transport with `Base Sepolia` chain from `viem/chains`).
- Read CID from `.state.json`.
- Call `IdentityRegistry.registerAgent(owner, metadataURI)` with `metadataURI = "ipfs://{cid}"` and `owner` per step 1's decision.
- Wait for receipt. Extract the emitted `AgentRegistered(agentId, owner, metadataURI)` event. Parse `agentId`.
- Append `{ chainId, agentId, txHash, registeredAt }` into `.state.json`.
- Print the human-facing URL: `https://3d.irish/agent/chain/{chainId}/{agentId}` (this route ships in [onchain/04-chain-hydrate-route.md](../onchain/04-chain-hydrate-route.md)).

### 4. Publish the CZ identity locally

Add an `agent_identities` row with `erc8004_agent_id = {agentId}`, `erc8004_registry = {address}`, `registration_cid = {cid}`, `avatar_id` pointing to the `cz` avatar record, `meta.demo = "cz"`. Do this via a one-shot SQL file `scripts/cz-demo/insert-local-row.sql` that the operator runs explicitly.

This local row lets `/api/agents/me` resolve a server-side record for the demo even before the chain-hydrate path ships.

## Files you own

- Create: `scripts/cz-demo/registration-cz.json`, `scripts/cz-demo/pin-registration.mjs`, `scripts/cz-demo/register-onchain.mjs`, `scripts/cz-demo/insert-local-row.sql`, `scripts/cz-demo/README.md` (operator runbook), `.gitignore` addition for `scripts/cz-demo/.state.json`

## Files off-limits

- The contracts themselves — do not edit. If the contract interface doesn't match the `registerAgent(owner, metadataURI)` call, stop and report.
- `src/erc8004/*` — may be used as libraries from your scripts, but don't modify.
- Any deployment of contracts — that's [onchain/01-deploy-identityregistry-base-sepolia.md](../onchain/01-deploy-identityregistry-base-sepolia.md).

## Acceptance test

1. Run `node scripts/cz-demo/pin-registration.mjs` — prints a CID, `.state.json` updated.
2. Run `node scripts/cz-demo/register-onchain.mjs` — prints agentId + tx hash, `.state.json` updated with them.
3. Check the tx on Basescan — event `AgentRegistered` emitted with the expected metadata URI.
4. Fetch `ipfs://{cid}` via any public gateway — contents match `registration-cz.json` byte-for-byte (ordering may differ if pinning re-serializes — normalize both with `JSON.stringify(JSON.parse(...))` before diff).
5. Load [onchain/04-chain-hydrate-route.md](../onchain/04-chain-hydrate-route.md)'s route (if shipped) at `/agent/chain/84532/{agentId}` — avatar loads.

## Reporting

Report: `agentId` minted, `txHash`, CID, gas used, chain + contract address used, whether `owner` ended up as `0x0` or an EOA (and why), operator-runbook summary.
