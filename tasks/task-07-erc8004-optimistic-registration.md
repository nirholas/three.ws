# Task: Eliminate the 15-Minute ERC-8004 Registration Delay

## Context

This is the `three.ws` 3D agent platform. When a user registers an agent on-chain via the ERC-8004 contract, the agent doesn't appear in the discovery index until the next cron job run (every 15 minutes). This is a poor UX — the user expects to see their agent immediately after paying gas and confirming the transaction.

The cron job (`api/cron/[name].js`, function `handleErc8004Crawl`) polls the chain for `Registered` events in block ranges and inserts them into the `erc8004_registrations` Postgres table. The frontend registration happens in `src/erc8004/agent-registry.js` via `registerAgent()`.

## Goal

After a successful on-chain registration, immediately write the registration to the `erc8004_registrations` table via an API call — don't wait for the crawler.

## Approach

### Step 1 — Add a backend endpoint

Create `api/erc8004/register-confirm.js` (new file):

- Method: `POST /api/erc8004/register-confirm`
- Auth: session cookie or bearer with `avatars:write` scope
- Body: `{ chainId, txHash, agentId, metadataUri, ownerAddress }`
- Verify the transaction: call the chain's RPC (`eth_getTransactionReceipt`) to confirm the tx was mined and emitted a `Registered` event from the expected contract address
- If confirmed: upsert the row into `erc8004_registrations` (use `ON CONFLICT DO NOTHING` so the crawler never overwrites it)
- Return `{ success: true }` or an error if the tx isn't mined yet

You can find chain RPC URLs and registry contract addresses in `api/_lib/erc8004-chains.js`. The `Registered` event topic hash is `keccak256("Registered(uint256,string,address)")` — you can hardcode this.

### Step 2 — Call the endpoint from the frontend

In `src/erc8004/agent-registry.js`, after the transaction is confirmed (the code already waits for receipt), add a call to `POST /api/erc8004/register-confirm` with the tx details.

### Step 3 — Trigger metadata enrichment immediately

The crawler has a second phase: `erc8004EnrichMetadata()` which fetches `metadata_uri` and populates the agent's name/description/image. After inserting the row in step 1, immediately fetch and upsert the metadata in the same request handler (reuse whatever logic `erc8004EnrichMetadata` uses, or inline a simple version).

## Constraints

- Do not modify the crawler — it should continue to work as a safety net for any registrations that slip through
- The `ON CONFLICT DO NOTHING` upsert in the endpoint means the crawler never causes duplicates
- Keep the endpoint lightweight — if the tx isn't mined yet, return a clear error (don't poll)

## Success Criteria

- After calling `registerAgent()` in the frontend, the agent appears in the discovery index within ~5 seconds (one tx confirmation)
- No duplicate rows when the crawler later processes the same registration
- The `api/erc8004/register-confirm.js` file is ≤ 100 lines
