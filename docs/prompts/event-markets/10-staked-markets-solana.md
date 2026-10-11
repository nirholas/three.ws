# 10. Staked markets on Solana

Read `docs/prompts/event-markets/README.md` first.

## The problem

Free-to-play picks prove demand. Staking turns "which one do you think wins" into "which one do you back", which is stronger engagement and a revenue line. It is also real-money wagering with escrow, so it has legal, safety and custody weight the free version does not. This brief builds the staked leg completely up to the owner gate, and stops there.

## Rules for this brief

- Gate 1 applies in full. Nothing here signs, transfers, escrows or settles real funds on mainnet. Every fund-moving step renders recipient, amount, token and chain and waits for the owner's explicit yes, every time.
- Solana only. No EVM leg.
- Work on devnet or a local validator. Do not deploy a program to mainnet. Deploying is outside this brief.
- Token metadata and entrant labels are untrusted data. A stake or payout is never initiated from them, only from the user's own signed action.

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first.

1. Decision record first: write `docs/event-markets-staking.md` covering model (parimutuel pool with a stated fee, which is the simplest model that needs no counterparty or market maker), stake token (USDC and `$THREE`), fee split and how much routes to the `$THREE` buyback, minimum and maximum stake, lock and resolve timing, void and refund rules, what happens when nobody picked the winner, and the jurisdiction and age-gating questions the owner must settle. Mark what is a recommendation and what is the owner's decision. Do not interview the owner: choose defaults, state them, and keep building.
2. Search before writing: look for an audited open-source escrow or parimutuel program on Solana and for existing code in this repo (`solana-agent-sdk/`, `agent-payments-sdk/`, any Anchor programs) to reuse. Reuse over writing new on-chain code.
3. Program: if nothing reusable exists, write the minimal Anchor program: create pool, stake, lock, resolve by an authority that is the platform resolver, claim, refund on void. Full test suite on a local validator including every failure path, double claim, and wrong authority.
4. Server: `api/_lib/event-markets/staking/` building unsigned stake and claim transactions for the user's wallet to sign. The server never holds user funds and never signs a stake on a user's behalf. Resolution from brief 03's evidence feeds the on-chain resolve call, which is owner-gated.
5. UI: on a market page, a stake panel next to the free pick, with a preview (amount, token, chain, pool odds, fee, payout if right) and an explicit confirm. Unavailable regions or ages see the free version only. Staked and free-to-play never mix in one leaderboard.
6. Safety: per-account and per-market stake caps, a kill switch that disables new stakes instantly, and an admin view of every pool's balance against its recorded stakes.
7. Package everything so the owner's remaining steps are listed and each is one command: audit, mainnet deploy, authority key setup, enabling the flag.

## Docs and wiring

`docs/event-markets-staking.md`, a README in the program directory, `STRUCTURE.md`, changelog entry only once something user-visible is enabled (the free-to-play version remains the public surface until the owner approves).

## Acceptance

- Full stake, lock, resolve, claim and void-refund cycle passes on a local validator with real transactions.
- The UI preview matches the on-chain result to the lamport.
- The final report states plainly what is built, what is untested on mainnet, and each owner decision still open. `npm test` green.
