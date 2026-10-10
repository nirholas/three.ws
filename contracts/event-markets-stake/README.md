# event-markets-stake

Minimal Anchor program (0.31) for staked Event Markets: a parimutuel pool per market. Spec and decisions: [docs/event-markets-staking.md](../../docs/event-markets-staking.md). **Unaudited. Not deployed to any cluster.**

## Instructions

| Instruction | Who | Effect |
| --- | --- | --- |
| `initialize` | authority | Creates the config: resolver, fee destinations, fee bps, buyback share. |
| `set_config` | authority | Changes any config field, pauses or resumes, rotates the authority. |
| `create_pool` | resolver | New pool for a 32-byte id, with outcome count, min, max, pool cap, lock and void deadlines. Snapshots fee and destinations. |
| `stake` | anyone | Stakes on one outcome. A wallet can back one outcome per pool. |
| `lock` | resolver | Closes staking early. |
| `resolve` | resolver | Records the winner and pays the fee to the treasury and buyback accounts. |
| `void_pool` | resolver | Voids; every staker refunds in full. |
| `void_expired` | anyone | Voids an unresolved pool after `void_after_ts`. |
| `claim` | winner | Pays `floor(stake * (total - fee) / winning_total)`. One shot. |
| `refund` | staker | Returns the full stake from a void pool. One shot. |

`pause` stops `create_pool` and `stake` only. Claims, refunds and `void_expired` are never blocked.

PDAs: `["config"]`, `["pool", pool_id]`, `["position", pool, owner]`; the vault is the pool's associated token account. Supports SPL Token and Token-2022.

## Test

`npm run test:stake-program` builds the program, boots `solana-test-validator` with it loaded, runs [tests/event-markets-staking.chain.test.js](../../tests/event-markets-staking.chain.test.js) (full cycle, every error path, double claim, wrong authority, payout parity with the JS math, Token-2022), and stops the validator by PID. Needs the Solana CLI (`cargo-build-sbf`).

## Deploy

Owner-gated, see the step list in the decision record. Never commit `target/deploy/*-keypair.json`; `contracts/*/target/` is gitignored.
