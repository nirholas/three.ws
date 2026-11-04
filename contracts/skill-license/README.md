# skill_license — on-chain skill-ownership NFTs (Solana / Anchor)

Purchasing a skill on three.ws can mint the buyer an **on-chain access key**: a
1-of-1 SPL NFT held in their wallet, plus a deterministic `SkillLicense` account
that anyone can read to verify ownership **without trusting our database**.

```
buy skill ──▶ backend verifies payment ──▶ mint_skill_license (minter-signed)
                                              │
                                              ├─ SkillLicense PDA  (the queryable record)
                                              └─ 1/1 SPL NFT  ────▶  buyer's wallet
```

This is the trustless alternative to the database-backed
[`hasSkillAccess`](../../api/_lib/skill-access.js) check: a license PDA that
exists with `revoked_at == 0` means the wallet owns the skill. The platform's
read path is [`api/skills/license-onchain.js`](../../api/skills/license-onchain.js),
backed by [`api/_lib/skill-license-onchain.js`](../../api/_lib/skill-license-onchain.js).

Program id (same on every cluster): **`9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj`**

## State

| Account | Seeds | Holds |
|---|---|---|
| `Marketplace` | `["marketplace"]` (singleton) | `authority` (admin), `minter` (authorized minting wallet), `licenses_minted`, `bump` |
| `SkillLicense` | `["skill_license", owner, agent_mint, sha256(skill_name)]` | `authority` (owner), `agent_mint`, `nft_mint`, `skill_hash`, `purchase_date`, `revoked_at`, `bump`, `skill_name` |
| NFT mint (PDA) | `["skill_mint", owner, agent_mint, sha256(skill_name)]` | the 1/1 mint (0 decimals, supply locked at 1) |

`skill_name` can be up to 64 bytes — longer than Solana's 32-byte per-seed
limit — so it is hashed with SHA-256 to form the third seed. The JS client
([`skillSeed`](../../api/_lib/skill-license-onchain.js)) computes the identical
hash, so both sides derive the same license/mint/ATA addresses.

## Instructions

| Instruction | Signer | Effect |
|---|---|---|
| `initialize_marketplace(minter)` | admin | Create the singleton config. Signer becomes `authority`; `minter` is the wallet allowed to mint. One-time. |
| `set_minter(new_minter)` | admin | Rotate the authorized minter (key rotation). |
| `mint_skill_license(skill_name)` | `minter` | Create the `SkillLicense` PDA, mint 1 NFT to the owner's ATA, then remove the mint authority so supply is permanently 1. Owner does **not** sign — the backend mints on their behalf after payment is verified, so a user can't self-mint a free license. |
| `burn_skill_license()` | owner | Burn the NFT, close the token account, and close the license PDA — all rent back to the owner. For holder-initiated disposal / pre-transfer teardown. |
| `revoke_skill_license()` | `minter` | Refund path: freeze the holder's token account (via the freeze authority retained at mint) and stamp `revoked_at`. The PDA stays readable so verifiers see the revoked state. |

The `mint`/`license`/`ata` accounts are all PDAs derived from the same triple,
so a second mint for the same `(owner, agent_mint, skill_name)` fails — the
purchase is idempotent on-chain.

## Why both a PDA and an NFT?

- The **NFT** is what shows up in the user's wallet and is transferable — *true
  ownership* of the skill license.
- The **`SkillLicense` PDA** is the cheap, deterministic, strongly-typed record
  the platform reads to answer "does this wallet own skill X on agent Y?" in a
  single `getAccountInfo`, with no token-account enumeration.

## Build, test, deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md). In short:

```bash
anchor build                                  # compile + regenerate the IDL
anchor deploy --provider.cluster devnet       # deploy (program keypair = declare_id)
node scripts/skill-license-smoke.mjs          # end-to-end devnet smoke test
```

The hand-maintained IDL lives at [`../idl/skill_license.json`](../idl/skill_license.json)
(kept in sync with `src/lib.rs`, mirroring the `agent_invocation` convention).

## Relationship to the Metaplex Core skill collections

The existing [`api/_lib/skill-nft.js`](../../api/_lib/skill-nft.js) pipeline mints
a Metaplex **Core** asset into a per-agent collection as the purchase receipt.
This program is the **program-owned** alternative: a custom on-chain access key
the platform controls end-to-end (mint, lock, revoke) and verifies by PDA. The
`agent_mint` seed is the agent's on-chain grouping mint (its skill-collection
mint), so a license cleanly ties back to the agent that sold the skill.
