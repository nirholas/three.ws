# Operating an x402 facilitator

`@three-ws/x402-server/facilitator` is the verify and settle engine three.ws runs in
production for Solana, packaged so you can run your own. This guide takes you from
nothing to a facilitator you have attacked and can monitor.

Read this first, honestly: the facilitator has been battle-tested on one workload,
three.ws's own closed-loop agent economy (see `docs/x402-ring-economy.md` in the
repo). That volume is the platform paying itself, a canary, not third-party
adoption. `GET /api/x402-facilitator/metrics` publishes the split between canary
and external payers so the numbers cannot be misread. The attack suite below is how
you verify a deployment yourself rather than trusting that history.

## What it does

A sponsored facilitator takes a transaction the buyer already signed, adds its own
signature as fee payer, broadcasts it, and waits for confirmation. Because the
operator pays the SOL, the facilitator must refuse any transaction that could move
the operator's funds or burn fees for the attacker. The gate allows exactly one
shape: an optional pair of compute-budget instructions, an optional idempotent ATA
create funded by the fee payer, one `TransferChecked` of an allowlisted mint to an
allowlisted recipient, and a bounded number of wallet-guard instructions.

## Install

```bash
npm install @three-ws/x402-server @solana/web3.js @solana/spl-token bs58 @noble/curves
```

The Solana libraries are peer dependencies, so the merchant half of the package
stays dependency-free for people who only sell.

## Generate and fund the fee payer

```bash
node -e "const {Keypair}=require('@solana/web3.js');const b=require('bs58');const k=Keypair.generate();console.log(k.publicKey.toBase58());console.log(b.encode(k.secretKey))"
```

The first line is the public address you fund and advertise. The second is the
secret: keep it in a secret manager, never in the repo. Fund the address with SOL.
On devnet use `solana airdrop 2 <address> --url devnet`. Use a dedicated key that
holds only operating SOL.

## Run it

```js
import { createFacilitator, createFacilitatorHandler } from '@three-ws/x402-server/facilitator';
```

A complete one-file server and a Dockerfile are in `examples/facilitator/`.

Options that matter:

| Option | Meaning |
| --- | --- |
| `rpcUrls` or `connection` | One or several RPC endpoints. With several, reads and sends fail over. |
| `feePayer` | A `Keypair`, a `{publicKey, signTransaction}` signer (KMS, HSM), or a function returning one. |
| `payToAllowlist` | The only recipients it will settle to. Everything else is refused. |
| `settleableMints` | The only mints it will settle. |
| `guards.sponsorSolFloorLamports` | Below this SOL balance, sponsored settles are refused. Default 0.02 SOL. |
| `guards.minSponsoredSettleAtomic` | Smallest transfer a sponsored settle may move. Each settle burns about 5000 lamports, so dust is a fee-burn grief. Default 1000. |
| `guards.feeBudget` | `{lamports, windowMs}` rolling cap on total sponsor burn. |
| `guards.maxCuLimit`, `maxCuPriceMicroLamports`, `maxPriorityLamports` | Ceilings on compute-budget instructions. |
| `guards.confirmTimeoutMs` | How long to wait for confirmation before answering `settlement_pending`. |
| `store` | Where pending settlements are recorded. In-memory by default. Use a shared store (a database) when you run more than one instance. |
| `decisionLog` | Receives every verify and settle outcome. In-memory by default. |
| `onDecision` | Callback per decision, for your own logs. |

Run more than one instance only with a shared `store`. Otherwise a retry that lands
on another instance cannot see the first broadcast and would send a second
transaction.

## Floors, budgets and the order they apply

1. The static gate (shape, allowlists, ceilings) runs first and touches no RPC.
2. Minimum settle size, for sponsored transactions.
3. Sponsor SOL floor, including the rent of any ATA the settle would create.
4. Rolling fee budget.
5. Simulation, then broadcast, then confirmation.

Refusals before step 5 cost nothing.

## Settlement states

`/settle` answers `success`, `failure`, or `settlement_pending`. Pending means the
transaction was broadcast but its confirmation is unknown. It is not a failure. The
recorded signature is reconciled on the next retry of the same payload, so a
lost confirmation never produces a second broadcast. If the store cannot record the
signature, the answer is the terminal `settlement_pending_unrecordable`, so the
facilitator never promises a retry it cannot honor.

## Monitoring

`GET /healthz` reports `sponsorBelowFloor`. `GET /metrics` returns verifies,
settles, pending, refusals by reason and lamports burned, plus fee-budget usage.
Alert on `sponsorBelowFloor`, on fee-budget usage above 80 percent, and on a rising
`settlement_pending` count.

## Attack your deployment

Point the suite at a devnet or local facilitator:

```bash
npx @three-ws/x402-server attack --facilitator http://localhost:8080
```

It posts hostile transactions and fails if any is accepted. It refuses to run
against a mainnet network id, and you should never aim it at a facilitator you do
not operate.

## Refusal reasons

| Reason | Attack it stops |
| --- | --- |
| `system_instruction_forbidden` | Draining the fee payer with a System transfer or createAccount |
| `cu_price_too_high`, `cu_limit_too_high`, `priority_fee_too_high` | Priority-fee inflation |
| `amount_below_min_settle` | Dust griefing |
| `pay_to_not_allowlisted`, `transfer_wrong_destination` | Recipient substitution |
| `mint_not_settleable`, `transfer_wrong_mint` | Mint substitution |
| `program_not_allowed` | Instructions from unlisted programs |
| `multiple_transfers`, `token_ix_not_transfer_checked`, `no_usdc_transfer` | Wrong transfer shape |
| `amount_below_required` | Underpayment |
| `fee_payer_not_sponsor` | Wrong fee payer |
| `ata_create_wrong_account`, `ata_create_wrong_funder` | ATA rent abuse |
| `address_table_lookups_forbidden` | Accounts hidden in a lookup table |
| `invalid_signature`, `missing_signature` | Forged or absent buyer signature |
| `wrong_token_program` | Token-program confusion |
| `guard_instruction_references_sponsor`, `too_many_guard_instructions` | Wallet-guard padding |
| `transfer_source_not_authority_ata`, `authority_not_signer` | Spending someone else's tokens |
| `deserialize_failed` | Garbage input |
| `fee_wallet_below_floor`, `fee_wallet_cannot_cover_settle` | Sponsor SOL protection |
| `fee_budget_exhausted` | Burn-rate cap |
