# Open Solana agent registry (8004)

three.ws enrols agents in the open Solana agent registry, the Solana port of ERC-8004, and reads other agents' trust tiers when one agent hires another. It sits beside the Metaplex agent identity three.ws already writes, and beside the Trader Passport.

## What was verified

| Item | Value |
|---|---|
| SDK | `8004-solana` 0.8.5, MIT licence, adopted as a dependency |
| Registry program (mainnet) | resolved at runtime from the SDK (`getProgramIds('mainnet-beta')`) |
| Registry program (devnet) | `8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C` |
| ATOM engine (trust tiers) | `AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF` |
| Tiers | Unrated, Bronze, Silver, Gold, Platinum |

The SDK imports `@noble/curves/ed25519`, which curves 2.x only exports with a `.js` suffix. `scripts/fix-8004-solana-esm.mjs` patches that import on install (idempotent, wired into `postinstall`).

## Registration

`api/_lib/solana-8004.js` `register8004Agent` calls the SDK `registerAgent` with the agent's registration document (`/api/agents/<id>/registration`) and ATOM enabled. The platform authority key signs and pays, so owners never sign and need no SOL, the same custody as the mint and `registerIdentityV1`. `registerAgentOnce` in `api/_lib/onchain-deploy.js` runs it right after the Metaplex registration. A failure there never fails the mint.

The result is stored on the agent row:

| Network | Location |
|---|---|
| mainnet | `agent_identities.meta.registry_8004` |
| devnet | `agent_identities.meta.devnet.registry_8004` |

Fields: `standard`, `program`, `asset`, `registration_uri`, `authority`, `network`, `tx_hash`, `registered_at`, and a cached `standing` snapshot (`tier`, `tier_rank`, `average_score`, `total_feedbacks`, `checked_at`).

Devnet registration is always on. Mainnet registration spends authority SOL (about 0.012 SOL per agent) and is opt-in: set `SOLANA_8004_REGISTER_MAINNET=1`.

## Reading trust tiers

- `GET /api/agents/offers` and the slug lookup carry `provider.registry_8004` (asset, program, tier, score, feedback count, explorer link) for providers registered on mainnet, or `null`.
- The catalog ranks by completed hires, then by registry tier, then by recency.
- `POST /api/agents/a2a-hire` reads the provider's standing live from the chain before spending, falling back to the stored snapshot flagged `stale: true` when the RPC is unreachable. An outage is never reported as Unrated.
- Optional body field `minRegistryTier` (`Bronze`, `Silver`, `Gold`, `Platinum`) rejects a hire with `409 provider_below_tier` before any spend reservation.
- The agent page shows an `8004 <Tier>` pill next to the trust pills when the agent is registered (a devnet registration is labelled "devnet"), and nothing otherwise.

ATOM scores ramp slowly by design (anti-sybil), so a freshly registered agent reads Unrated until it has feedback from distinct clients.

## Back-fill

```
node --env-file=.env scripts/register-8004-agents.mjs --network devnet --limit 5 --dry-run
node --env-file=.env scripts/register-8004-agents.mjs --network devnet --limit 5 --confirm
SOLANA_8004_REGISTER_MAINNET=1 node --env-file=.env scripts/register-8004-agents.mjs --network mainnet --limit 5 --confirm
```

It registers minted agents that have no registry asset (sequentially, 750 ms apart) and refreshes cached standings older than six hours. `--refresh-only` skips registration. Re-runs are safe.

## Proof and tests

- `node scripts/prove-8004-registry.mjs` registers an agent with throwaway devnet keys, leaves feedback from a second wallet and reads the tier back. It refuses any non-devnet RPC.
- `tests/solana-8004.test.js` covers blocks, gating, reads, outage handling and idempotent registration with an injected SDK.
- `RUN_DEVNET_8004=1 npx vitest run tests/solana-8004.devnet.test.js` runs the live devnet round trip.
