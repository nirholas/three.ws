# Band 7 — MetaMask Advanced Permissions (ERC-7715 / ERC-7710)

## The end state

An agent deployed on-chain can be granted **scoped, time-bound, revocable permissions** by its owner via MetaMask. Once granted, the agent can execute transactions within that scope — from any host (Claude artifact, LobeHub plugin, embed iframe) — without the user needing to sign each transaction. Users can revoke at any time.

End-to-end flow:

1. User creates agent + deploys on-chain (band 6, already built).
2. User clicks **Grant permissions** → MetaMask opens → user sees human-readable scope (token, daily cap, expiry, target contracts) → approves once.
3. A signed ERC-7710 delegation is pinned, stamped into the agent manifest, and recorded in our DB.
4. When a skill running inside a Claude / LobeHub embed needs an on-chain action, the runtime calls `redeemDelegation(...)` against the ERC-7710 `DelegationManager` on-chain. The action executes. No popup.
5. User opens the manage panel → sees active delegations, usage counters, revoke button. Revoke is an on-chain write; the DB mirrors the state via the indexer cron.

## Why this is one coherent band

Scoped on-chain permissions are a primitive — the grant + storage + redemption + revoke loop must all work or none of it is useful. Each task in this band builds one slice; tasks are **independent** and can be done in parallel by 20 agents without blocking.

## Canonical shapes (all tasks converge on these)

> Every task references this section. Do not invent alternative shapes — consistency is why parallel work converges.

### DB — `agent_delegations` table

```sql
CREATE TABLE agent_delegations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    chain_id            INTEGER NOT NULL,
    delegator_address   TEXT NOT NULL,        -- EIP-55 checksummed user wallet
    delegate_address    TEXT NOT NULL,        -- EIP-55 checksummed agent smart account
    delegation_hash     TEXT NOT NULL UNIQUE, -- keccak256 of the delegation envelope
    delegation_json     JSONB NOT NULL,       -- full signed ERC-7710 delegation envelope
    scope               JSONB NOT NULL,       -- { token, maxAmount, targets[], expiry, period }
    status              TEXT NOT NULL DEFAULT 'active', -- active | revoked | expired
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ,
    tx_hash_revoke      TEXT,
    last_redeemed_at    TIMESTAMPTZ,
    redemption_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_delegations_agent ON agent_delegations(agent_id);
CREATE INDEX idx_delegations_status ON agent_delegations(status) WHERE status = 'active';
CREATE INDEX idx_delegations_delegator ON agent_delegations(delegator_address);
```

### API — endpoints under `/api/permissions/`

| Method | Path                               | Body / Query                                                   | Response                            |
| ------ | ---------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| POST   | `/api/permissions/grant`           | `{ agentId, chainId, delegation, scope }`                      | `{ ok, id, delegationHash }`        |
| GET    | `/api/permissions/list`            | `?agentId=X` or `?delegator=0x...`                             | `{ ok, delegations: [...] }`        |
| POST   | `/api/permissions/revoke`          | `{ id, txHash }`                                               | `{ ok, status: 'revoked' }`         |
| POST   | `/api/permissions/redeem`          | `{ id, calls: [{to,value,data}] }` (auth: agent bearer token)  | `{ ok, txHash, receipt }`           |
| GET    | `/api/permissions/metadata`        | `?agentId=X` (public, cached)                                  | `{ ok, delegations: [public view] }`|
| GET    | `/api/permissions/verify`          | `?hash=0x...&chainId=N`                                        | `{ ok, valid, reason? }`            |

All responses follow `{ ok: true, ... }` / `{ ok: false, error: 'code', message: '...' }` per [api/CLAUDE.md](../../api/CLAUDE.md).

### Manifest — `permissions` field on `manifest.json`

```jsonc
"permissions": {
    "spec": "erc-7715/0.1",
    "delegationManager": "0x...",  // DelegationManager address on the target chain
    "delegations": [
        {
            "chainId": 84532,
            "delegator": "0x...",   // EIP-55 checksummed
            "delegate":  "0x...",   // EIP-55 checksummed agent account
            "hash":      "0x...",   // delegation envelope keccak256
            "uri":       "ipfs://bafy...",  // pinned envelope (or inline under "envelope")
            "scope": {
                "token":     "0x...",       // ERC-20 address, or "native"
                "maxAmount": "10000000",    // base units, string
                "period":    "daily",       // daily|weekly|once
                "targets":   ["0x..."],     // allow-listed contracts
                "expiry":    1775250000     // unix seconds
            }
        }
    ]
}
```

### JS modules — canonical exports

```js
// src/erc7710/abi.js
export const DELEGATION_MANAGER_DEPLOYMENTS = { 84532: '0x...', 1: '0x...', ... };
export const DELEGATION_MANAGER_ABI = [ /* human-readable ethers v6 strings */ ];
export const EIP7710_TYPEHASH = '0x...';

// src/permissions/toolkit.js
export async function encodeScopedDelegation({ delegator, delegate, caveats, expiry, chainId }) { /* */ }
export async function signDelegation(delegation, signer) { /* */ }
export async function redeemDelegation({ delegation, calls, signer, chainId }) { /* */ }
export async function isDelegationValid({ hash, chainId }) { /* */ }
export function delegationToManifestEntry(signedDelegation) { /* */ }

// src/runtime/delegation-redeem.js
export async function redeemFromSkill({ agentId, chainId, calls, skillId }) { /* */ }
export async function getActiveDelegation({ agentId, chainId }) { /* */ }
```

### Error codes (string, OAuth-style)

`delegation_expired`, `delegation_revoked`, `scope_exceeded`, `target_not_allowed`, `delegation_not_found`, `signature_invalid`, `chain_not_supported`, `rate_limited`.

## Off-limits

- **No mainnet defaults.** Base Sepolia / Sepolia only unless the user explicitly opts in through the UI.
- **No mock signatures.** Delegations must be real EIP-712 signatures from the user's wallet, verifiable on-chain.
- **No custodial keys.** We never hold the delegator's key. The agent's smart account key may be held server-side only if the task explicitly says so (task 09 defines this trust boundary).
- **No bypassing scope.** The redeem path must call the real ERC-7710 `DelegationManager.redeemDelegations(...)`; never execute calls that fall outside the signed caveats.
- **No silent auto-grants.** Every delegation must be explicitly approved by the user in MetaMask. Scope must be human-readable before approval.

## Reference

- MetaMask docs: <https://docs.metamask.io/delegation-toolkit/> (verify package name + contract addresses there — do not guess; if the docs say `@metamask/delegation-toolkit`, use exactly that)
- EIP-7710: <https://eips.ethereum.org/EIPS/eip-7710>
- EIP-7715: <https://eips.ethereum.org/EIPS/eip-7715>
- Existing on-chain plumbing: [src/erc8004/](../../src/erc8004/)
- Existing auth: [api/\_lib/auth.js](../../api/_lib/auth.js)

## Tasks (independent — run in any order)

| #   | File                                                                  | Area                           |
| --- | --------------------------------------------------------------------- | ------------------------------ |
| 01  | [01-permissions-spec.md](./01-permissions-spec.md)                    | specs (new doc)                |
| 02  | [02-manifest-permissions-field.md](./02-manifest-permissions-field.md)| specs (append)                 |
| 03  | [03-erc7710-abi.md](./03-erc7710-abi.md)                              | src/erc7710/                   |
| 04  | [04-delegation-toolkit.md](./04-delegation-toolkit.md)                | src/permissions/toolkit.js     |
| 05  | [05-db-schema.md](./05-db-schema.md)                                  | schema + migration             |
| 06  | [06-api-grant.md](./06-api-grant.md)                                  | api/permissions/grant.js       |
| 07  | [07-api-list.md](./07-api-list.md)                                    | api/permissions/list.js        |
| 08  | [08-api-revoke.md](./08-api-revoke.md)                                | api/permissions/revoke.js      |
| 09  | [09-api-redeem.md](./09-api-redeem.md)                                | api/permissions/redeem.js      |
| 10  | [10-grant-ui.md](./10-grant-ui.md)                                    | src/permissions/grant-modal.js |
| 11  | [11-manage-ui.md](./11-manage-ui.md)                                  | src/permissions/manage-panel.js|
| 12  | [12-api-metadata.md](./12-api-metadata.md)                            | api/permissions/metadata.js    |
| 13  | [13-runtime-redeem-hook.md](./13-runtime-redeem-hook.md)              | src/runtime/                   |
| 14  | [14-skill-tip-jar.md](./14-skill-tip-jar.md)                          | public/skills/tip-jar/         |
| 15  | [15-skill-subscription.md](./15-skill-subscription.md)                | public/skills/subscription/    |
| 16  | [16-skill-dca.md](./16-skill-dca.md)                                  | public/skills/dca/             |
| 17  | [17-embed-spec-delegation.md](./17-embed-spec-delegation.md)          | specs (append)                 |
| 18  | [18-sdk-permissions.md](./18-sdk-permissions.md)                      | sdk/                           |
| 19  | [19-indexer-cron.md](./19-indexer-cron.md)                            | api/cron/                      |
| 20  | [20-verify-endpoint.md](./20-verify-endpoint.md)                      | api/permissions/verify.js      |

All tasks reference the Canonical Shapes section above. None depend on another task being done first — each ships its own slice. Collisions on existing files are limited to `specs/AGENT_MANIFEST.md` (task 02) and `specs/EMBED_SPEC.md` (task 17), which are different files.

## Done = merged when

- Owner opens their agent page → **Grant permissions** → MetaMask prompt shows the exact scope in plain English → they approve → the delegation is stored (DB + pinned) and appears in the manifest.
- A skill running inside the Claude artifact can call `redeemFromSkill(...)` and an on-chain transaction lands within the scope with no wallet popup.
- Revoke button calls `DelegationManager.disableDelegation(...)` on-chain; the indexer picks up the event; the UI marks the delegation as revoked.
- `forge test` (contracts), `npm run build`, and `npx prettier --write` all pass.
- Every endpoint is rate-limited + authenticated per `api/CLAUDE.md` patterns.

## Reporting (every task ends with this)

- Files changed (paths + line counts)
- Commands run + their output (node --check, npm run build, forge test if touched)
- A single screenshot or transcript of the happy path for your slice
- Anything skipped, any deviation from the canonical shapes (must justify)
- Unrelated bugs observed (don't fix them — note them)
