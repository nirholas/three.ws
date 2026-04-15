# 06-01 — Publish agent to ERC-8004 IdentityRegistry

## Why it matters

The novel unlock of Layer 6: an agent isn't "portable" until its identity lives on chain, independent of our database. Publishing writes the agent's canonical record (controller wallet, manifest CID, basic profile) to [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol), turning our centralized `agents.id` into a chain-anchored identifier any host or wallet can resolve without us.

## Context

- ERC-8004 contracts: [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol), [contracts/src/ReputationRegistry.sol](../../contracts/src/ReputationRegistry.sol), [contracts/src/ValidationRegistry.sol](../../contracts/src/ValidationRegistry.sol).
- Contract ABIs: [src/erc8004/abi.js](../../src/erc8004/abi.js).
- Identity runtime: [src/agent-identity.js](../../src/agent-identity.js).
- Primary wallet (from 01-03) is the controller.
- Manifest spec: [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md). IPFS helper: [src/ipfs.js](../../src/ipfs.js).

## What to build

### 1. Pin manifest to IPFS — `api/agents/[id]/publish.js`

- Owner-authed `POST` with `{ chain_id: 8453 | 1 | 11155111 }`.
- Serializes the agent's canonical manifest (avatar GLB URL as `ipfs://`, animation set, skills, identity card) per [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md).
- Pins to IPFS via [src/ipfs.js](../../src/ipfs.js) (existing adapter — Pinata/w3up). Records CID.
- Stores `agents.manifest_cid` and `agents.manifest_pinned_at`.

Schema additions:

```sql
alter table agents add column if not exists manifest_cid text;
alter table agents add column if not exists manifest_pinned_at timestamptz;
alter table agents add column if not exists onchain_id text;            -- registry-emitted id
alter table agents add column if not exists onchain_chain_id int;
alter table agents add column if not exists onchain_tx_hash text;
alter table agents add column if not exists onchain_published_at timestamptz;
```

### 2. Client-signed registration

Do **not** submit the transaction from the server. Return the unsigned calldata to the client:

- `POST /api/agents/:id/publish` → `{ manifest_cid, calldata: { to, data, chain_id }, instructions }`.
- Client signs + submits via the user's primary wallet (ethers / viem via [public/wallet-login.js](../../public/wallet-login.js) patterns).
- After confirmation, client POSTs `/api/agents/:id/publish/confirm { tx_hash, onchain_id }`.
- Server verifies the tx receipt via public RPC, parses the registry's `AgentRegistered` event for `onchain_id`, writes it to the row.

### 3. Dashboard UI

On the agent page in [public/dashboard/](../../public/dashboard/):

- A "Publish onchain" button, disabled until the user has a primary wallet (01-03) and a public avatar.
- Click → confirms the network (Base by default), previews gas, prompts wallet.
- After success, shows the onchain id and a link to the block explorer.
- Re-publishing when the manifest changes: button label flips to "Update onchain" — pins a new CID and calls the registry's `updateManifest(onchain_id, cid)`.

### 4. Registration idempotency

If `agents.onchain_id` is already set and the controller wallet matches, the publish endpoint returns the existing id with `{ already_published: true }` instead of triggering a new tx.

## Out of scope

- Gasless / meta-transactions (user pays gas).
- Non-EVM chains.
- Paying gas with credit (relay service).
- ENS / basename registration (separate prompt).

## Acceptance

1. Complete a selfie → agent flow (Layer 2). Primary wallet set (01-03).
2. Click "Publish onchain" on Base Sepolia (testnet). Wallet prompts, tx confirms in ~5s.
3. Block explorer shows the `AgentRegistered` event with the expected CID and controller.
4. `agents.onchain_id` and `onchain_tx_hash` are populated server-side.
5. Re-clicking "Publish onchain" without manifest changes is a no-op (`already_published: true`).
6. Updating the avatar (Layer 3) flips the button to "Update onchain"; clicking pins a new CID and calls `updateManifest`.
7. `node --check` passes on new files.
