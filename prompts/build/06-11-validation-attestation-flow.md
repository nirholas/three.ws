# 06-11 — Onchain: validation attestation flow

**Branch:** `feat/validation-flow`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-05 (ValidationRegistry deployed), 06-10 (manifest spec)

## Why it matters

ValidationRegistry exists on testnets; the contract lets allow-listed validators attest to off-chain proofs about an agent (e.g. "model passes gltf-validator", "manifest signature verified", "skill output reproducible"). Without a flow that *uses* it, the registry is dead weight.

## Read these first

| File | Why |
|:---|:---|
| [contracts/src/ValidationRegistry.sol](../../contracts/src/ValidationRegistry.sol) | Contract surface. |
| [src/erc8004/validation-recorder.js](../../src/erc8004/validation-recorder.js) | `recordValidation`, `hashReport`. |
| [api/mcp.js](../../api/mcp.js) | `validate_model` tool — produces a report we can attest. |
| [api/_lib/](../../api/_lib/) | Auth + db helpers. |

## Build this

1. **Schema** — new table `validations` mirroring on-chain attestations: `(chain_id, token_id, kind, report_hash, validator, tx_hash, recorded_at)`.
2. **Validator service**: a single allow-listed validator key (env `VALIDATOR_PK`) that runs `validate_model` on every newly minted agent's GLB. If it passes, generate a signed report and call `recordValidation(chainId, tokenId, kind='gltf-valid', reportHash)`.
3. **Trigger**: cron at `api/cron/run-validations.js` polls `onchain_agents` for rows without a validation record and processes them (rate-limited).
4. **UI**: extend the reputation card from 06-07 with a "Validations" row showing kinds passed (gltf-valid, manifest-signed, etc.) with check marks. Click → opens explorer link to the on-chain attestation.
5. **Open submission**: provide a `POST /api/validations/submit` endpoint where any user with a verified wallet can submit their own validation report; we never write it on-chain (only allow-listed validator does), but we surface user-submitted reports on the agent page with a clear "unverified" tag.

## Out of scope

- Do not deploy ValidationRegistry to mainnets in this PR.
- Do not auto-validate skill execution — too expensive.
- Do not allow arbitrary keys to attest (single allow-listed validator is the v1 model).

## Acceptance

- [ ] On-chain attestations recorded for new mints within one cron cycle.
- [ ] Validations row appears on agent page with check marks and links.
- [ ] User-submitted reports show with "unverified" badge.
- [ ] No double-attestation (idempotent on `kind` per token).

## Test plan

1. Local anvil with all three registries deployed and indexed.
2. Mint a valid GLB-backed agent. Wait one cron tick. Confirm row in `validations` and on-chain tx.
3. Mint an agent with a malformed GLB. Confirm it does *not* get a `gltf-valid` attestation.
4. POST a user-submitted report; verify it appears with unverified tag.
