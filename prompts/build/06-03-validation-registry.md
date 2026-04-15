# 06-03 — Validation registry integration

## Why it matters

Reputation (06-02) is subjective. The ValidationRegistry complements it with *verifiable* claims — "this agent signed this output", "this agent delivered this tool call on this block". These are how hosts prove, without trusting us or the agent, that a given action happened. Critical for host-embed trust (Layer 5) and for the onchain-discovery flywheel (06-07).

## Context

- Validation contract: [contracts/src/ValidationRegistry.sol](../../contracts/src/ValidationRegistry.sol).
- ABI entries: [src/erc8004/abi.js](../../src/erc8004/abi.js).
- Agent actions table: `agent_actions` (reference [api/_lib/schema.sql](../../api/_lib/schema.sql)).
- Requires: 06-01 merged.

## What to build

### Event model

An agent "output" is any action we want to make verifiable. For v1, scope to three event types:

- `skill_invoked` — skill name, input hash, output hash, block timestamp.
- `speech_emitted` — text hash, context id.
- `tool_call_delivered` — tool id, args hash, result hash.

Each emits an `agent_actions` row today. This prompt layers an opt-in onchain anchor.

### Server-side batching — `scripts/anchor-actions.mjs`

- Runs as a periodic job (Vercel cron every 10 min or on-demand via an admin endpoint).
- Scans `agent_actions where anchored_at is null` for agents with `onchain_id` set AND `anchor_enabled = true` (new column).
- Builds a Merkle tree of `keccak256(action_id || event_type || content_hash)`.
- Submits the tree root + count to `ValidationRegistry.anchor(subject, root, count, period_start, period_end)` using a server-controlled signer (a dedicated relayer wallet — configured via env).
- Writes `action.anchored_at`, `action.anchor_root`, `action.anchor_tx_hash`, `action.anchor_proof` (the Merkle proof for this leaf).

Schema additions:

```sql
alter table agents add column if not exists anchor_enabled boolean not null default false;
alter table agent_actions add column if not exists content_hash text;
alter table agent_actions add column if not exists anchored_at timestamptz;
alter table agent_actions add column if not exists anchor_root text;
alter table agent_actions add column if not exists anchor_tx_hash text;
alter table agent_actions add column if not exists anchor_proof jsonb;
```

### Verification endpoint — `GET /api/agents/:id/actions/:action_id/proof`

Returns `{ content_hash, root, tx_hash, proof, leaf_index }` once anchored. A third party can independently reconstruct the leaf, verify the proof, and check the root matches what's onchain.

### Dashboard UI — "Verifiability"

On the agent detail page:

- Toggle: "Anchor actions onchain" (requires primary wallet connected; writes `anchor_enabled`).
- For each recent action, show: "pending | anchored (tx link)".

### Host surface

The postMessage protocol (05-04) gains an optional `verify` message: host sends `{ action_id }`, agent replies with the proof bundle from the endpoint above. Document in the spec.

## Out of scope

- Zero-knowledge proofs.
- Full-history anchoring (only actions from `anchor_enabled = true` onward).
- Anchoring non-action data (no manifests, no state snapshots).
- Running a full subgraph — use direct RPC event reads.

## Acceptance

1. Enable anchoring on a published agent. Trigger 5 skill invocations.
2. Run `scripts/anchor-actions.mjs` → one tx submits a root containing all 5 leaves.
3. Hit `/api/agents/:id/actions/:action_id/proof` → returns a valid Merkle proof.
4. Independently verify the proof against the onchain root (small standalone verifier script or one-liner in the acceptance notes).
5. Disable anchoring → next job run ignores new actions.
6. `node --check` passes on new files.
