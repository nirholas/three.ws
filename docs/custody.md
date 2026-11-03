# Custody you can verify: limits, freeze, proof, recovery

Every three.ws agent gets a custodial Solana wallet so it can act autonomously — trade, pay x402 endpoints, snipe — without you approving every transaction. Custodial is a strong word, so the platform's position is: **provable, not promised**. This doc is the public story of the controls: what limits you can set, what the freeze switch does, how you independently verify custody on-chain, and how a wallet survives a lost account — or its owner.

The four guarantees, each with a verification path:

1. **You cap it.** Opt-in spend limits are enforced server-side before anything is signed.
2. **You can stop it.** A one-tap freeze pauses every autonomous path — and never blocks your own withdrawal.
3. **You can check it.** Every wallet's balance is committed into a Merkle attestation on a schedule, and you can re-verify your leaf in your own browser.
4. **You can lose your keys, or die, without losing the wallet.** Social recovery and a dead-man's-switch inheritance flow transfer ownership — never the secret.

## Spend limits: caps enforced before signing

Limits live per agent and are owner-configurable from the wallet hub (API: `GET/PUT /api/agents/:id/solana/limits`):

- `daily_usd` — rolling 24-hour ceiling, summed over the custody event trail
- `per_tx_usd` — single-transaction ceiling
- `withdraw_allowlist`, destinations the wallet may send to, managed as the [destination whitelist](./destination-whitelist.md) (cooldown, step-up, instant removal)
- Plus a trade-side daily SOL budget for trading agents

Enforcement is uniform: the same policy module gates **every** outbound path — withdrawals, x402 payments, sniper buys, trades. A transaction that would breach a cap is refused with a structured `403` before signing; no funds move. Limits are opt-in (`null` means uncapped) — but they're hard once set. SPL tokens that can't be priced in USD are governed by the allowlist instead, so a price-feed outage can never strand your own withdrawal.

You can also write these rules in plain English — see [financial-controls](financial-controls.md) for the natural-language rules layer and the real-time defense behaviors built on top of this same enforcement point.

## Freeze: the kill switch that can't trap you

`frozen` is a one-tap owner control. When set, **all autonomous spending stops** — trading, sniping, x402 — at the same server-side gate as the limits. Two deliberate asymmetries:

- **Owner withdrawal is never blocked by a freeze.** Freezing a misbehaving agent must not take your funds hostage.
- During a recovery dispute (below), the wallet is auto-frozen — but that automatic freeze is tracked separately, so it lifts when the dispute resolves without overriding a freeze *you* set.

## Withdraw any time

`POST /api/agents/:id/solana/withdraw` — owner-authenticated, server-signed, idempotent. Destination addresses are validated on-curve (program-derived addresses are rejected), Max-sweeps hold back the rent and fee reserve, and every withdrawal lands in the custody trail and the platform audit log.

## The custody audit trail

Every key recovery, withdrawal, spend, limit change, and freeze toggle is written to the wallet's custody event trail — owner-viewable at `GET /api/agents/:id/solana/custody`. This trail isn't decorative: it's the ledger the rolling daily cap is computed from, and its head is committed into every proof-of-custody leaf (below), which means the attestation also commits to the *history* of the wallet, not just its balance.

## Proof of custody: verify it yourself

Every six hours, an attestation epoch runs:

1. Every custodial wallet's **live mainnet balance** is read.
2. Each wallet becomes a leaf: agent, address, balance, and the current head of its custody event trail, hashed together.
3. The leaves build a Merkle tree; the epoch and leaves are persisted.
4. The root is anchored on Solana as a signed SPL-Memo transaction, when an attester key is configured and funded (see **Honest limits** below).

Two public surfaces:

- **[/integrity](https://three.ws/integrity)** is the aggregate view, no sign-in: how many epochs are anchored of the total, the newest anchored epoch re-verified against the chain in your browser, the Merkle root, wallet count, total SOL and recent epochs. API: `GET /api/custody/integrity` and `GET /api/custody/anchor?epoch=latest`. When the latest epoch is not anchored the page says so in a banner instead of implying it is. The link from `/proof` only appears once at least one epoch is anchored.
- **[/proof](https://three.ws/proof)** is your wallet's inclusion proof (owner-only, since it reveals a per-wallet balance). The page fetches your proof and then **re-verifies it in your browser** with an independent verifier: it recomputes your leaf hash from the public fields, walks the Merkle path, and checks the result against the epoch's published root. The prover and verifier share one hashing module, so they cannot silently drift. Where the epoch is anchored, that same root is what the on-chain memo commits to.

Epochs also run a reconciliation pass: any balance drop since the previous epoch must be explained by authorized withdraw/spend events (plus fee tolerance), or it's flagged. "No unexplained outflows" is a checked property, not a slogan.

**Honest limits.** Anchoring is best-effort and is the one step in this pipeline that can fail on its own. Steps 1 to 3 (balance snapshot, leaf hashing, Merkle tree, persistence) always run; step 4 needs a configured, funded attester key. When it fails the epoch is still recorded with `anchor_status` set to `anchor_failed` and a null `anchor_sig`; that root is a real, reproducible commitment you can verify your inclusion against, but it is not timestamped on a public chain. A payer with no lamports on the anchor cluster is stored as `anchor_error = attester_unfunded:<network>`, and the custody cron pages ops (once per outage, signature `custody-anchor-failed:<network>`) with the attester's public key and live balance.

The root is anchored on **Solana mainnet** by default (`CUSTODY_ANCHOR_NETWORK`, default `mainnet`), the same cluster the balances are read from and the one where the attester is funded and auto-topped-up; a memo costs about 5,000 lamports, four epochs a day. Until 2026-11-03 the default was devnet, where the attester holds nothing, so the first 524 epochs were all `anchor_failed`.

**Backlog semantics.** Those earlier epochs are deliberately not re-anchored: a late timestamp on an old root would imply it was published then. `GET /api/custody/integrity` reports them as `backlog` (epochs recorded before the first anchor) with `first_anchored_at`, and the page says "anchoring began on <date>". `latest_anchored` is the newest epoch with a real on-chain transaction.

Check the epoch you are relying on rather than assuming: `epochs_total` against `epochs_anchored`, and `anchor_status`, `anchor_sig` and `anchor_network` per epoch. Read `anchor_network` before treating an anchor as mainnet-final. Balance reads are mainnet regardless of where the anchor lands.

## Social recovery & inheritance

A funded agent shouldn't die with a lost password — or with its owner. The model is **ownership transfer, never key export**: recovery re-points the agent (and its avatar) to a new owner account. The wallet secret is never decrypted, displayed, or moved; it stays encrypted at rest and the platform simply signs for the new owner afterward. There is nothing for an attacker to intercept.

**Setup (owner):** name up to 10 guardians (by username, @handle, email, or id), an approval threshold (default 2-of-N), and optionally a beneficiary — from the agent's wallet hub (`PUT /api/agents/:id/recovery`).

**Recovery:** a guardian or the beneficiary opens a request nominating the new owner. Safety rails, in order:

- The requester **cannot approve their own takeover** — at least one other guardian must approve.
- The wallet **auto-freezes for autonomous spend** the moment a request opens (owner withdrawal stays open, as always).
- Threshold approvals start a **48-hour time-lock** before the transfer can complete.
- The real owner can cancel instantly at any point — their presence defeats the request.
- Unmet requests expire after 14 days.

**Inheritance (dead-man's switch):** the owner enables it with an inactivity threshold (7–365 days) and a grace window. "Alive" is inferred from sessions, custody events, usage, or an explicit check-in. When inactivity crosses the line, an inheritance request opens to the beneficiary; it needs guardian confirmation (or the beneficiary's own, if no guardians are set) *and* the grace window; a daily sweep arms, reminds (about a week ahead), and completes; any owner check-in cancels the whole thing.

**The guardian console, [/guardian](https://three.ws/guardian)**, is the inbox for the *other* side: agents where you are the guardian or beneficiary, the active request's story, approval counts, countdowns, and the approve / decline / confirm actions. (Not to be confused with the Guardian *content-safety* model, `@three-ws/guardian`, which is an unrelated AI-moderation surface.)

Every step of recovery and inheritance writes to the custody trail and the audit log, and notifies everyone involved.

## Related

- [Financial controls](financial-controls.md) — plain-English spend rules and real-time wallet defense on these rails
- [Trading surfaces](trading-surfaces.md) — Mission Control executes through this same guarded path
- [The trading experiment](trading-experiment.md) — an autonomous agent operating inside these limits, journaled
- [x402](x402.md) — the payment protocol these wallets spend over
