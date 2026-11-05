# Agent wallets

Every three.ws agent owns a **custodial Solana wallet**. It is what lets an agent act on its own — pay for an API call, buy a coin, tip another agent, receive its earnings — without a human approving each transaction in a browser extension.

This is the reference for the wallet itself: how it's created, how its key is held, what may spend from it, and where the controls live. For the owner-facing safety story (limits, freeze, proof, recovery) read [Custody you can verify](custody.md). For the complete tour of everything the wallet can do, read [What agents can do → The Agent Wallet](agent-abilities/chapters/10-the-agent-wallet.md).

## What you get

The wallet is created automatically when an agent is created — there is no separate "enable wallet" step and no seed phrase for the owner to write down. Each agent gets:

- a **Solana keypair** (mainnet and devnet share one address)
- an **EVM keypair** for the chains where the agent registers its ERC-8004 identity
- a spot on the platform's custody ledger, which records every outbound movement

Nothing is shared between agents. Two agents owned by the same person hold two independent wallets.

## Key custody

The private key is generated on the server, never leaves it, and is **encrypted at rest with AES-256-GCM**.

The encryption key derives, via HKDF, from a dedicated secret (`WALLET_ENCRYPTION_KEY`) that exists only to protect wallets — deliberately *not* the platform's `JWT_SECRET`. Each ciphertext embeds its own random salt, so no two records share a derived key, and rotating session secrets never bricks a wallet. Ciphertexts written under the older scheme still decrypt (dual-read) and re-encrypt opportunistically on their next write.

This is the same secret box used for coin treasuries and the launcher, so every custodial secret on the platform is held the same way.

**What this means honestly:** the platform can sign for the agent. That is the point — an autonomous agent that needs you to approve each transaction is not autonomous. What the platform gives you in exchange is that everything it *can* do is capped by policy you set, halted by a freeze you control, recorded in an audit trail, and provable on-chain. See [custody.md](custody.md).

## Who can spend

Five paths move funds out of an agent wallet, and **all five pass through one policy module** before anything is signed:

| Path | Trigger |
|------|---------|
| Withdraw | The owner sweeps funds out |
| x402 pay | The agent pays for a paid API call. Also reachable from any paid checkout on the site: the [x402 payment modal](tutorials/pay-for-x402-service.md) lists a signed-in user's agents next to Phantom, and picking one settles from that agent's wallet with no popup |
| Trade | A discretionary buy/sell from the wallet hub, or from the in-world coin widget's **Pay with** selector (SOL-denominated coins) |
| Purchase | The agent buys a marketplace skill or asset for itself (see [Marketplace](marketplace.md)), under its own daily purchase cap |
| Snipe | The autonomous sniper worker executes a strategy |

Because enforcement lives at the signing boundary rather than in each feature, a new feature cannot accidentally introduce an unguarded spend path.

### The policy

Limits are stored per agent and are **opt-in** — an unset ceiling means "no global cap," so existing automated flows keep their own per-feature caps until an owner tightens the policy. Once set, they are hard limits applied uniformly:

- `daily_usd` — rolling 24-hour USD-equivalent outflow ceiling, summed from the custody ledger
- `per_tx_usd` — maximum USD-equivalent for a single outbound transaction
- `withdraw_allowlist`, the active addresses on the [destination whitelist](./destination-whitelist.md); new addresses serve a cooldown (24h default, 1h minimum) and need step-up before they can receive funds
- `frozen` — the kill switch: every **autonomous** path is refused
- `require_capabilities` — when on, every autonomous spend must present a valid [scoped session key](agent-abilities/wallet/21-access.md)

Two asymmetries are deliberate:

- **A freeze never blocks the owner's withdrawal.** Locking down a misbehaving agent must not trap your money; the safe direction stays open.
- **An SPL token that can't be priced in USD** is governed by the allowlist and rate limit rather than the USD cap — a price-feed outage can never strand your own withdrawal.

Coin-launch and bonding-curve activity carries an additional SOL-denominated policy (`max_sol_per_tx`, `daily_sol_cap`, an optional `allowed_mints` allowlist). A freshly provisioned agent that has never been configured defaults to **1 SOL per transaction and 5 SOL per rolling day**, so a stolen session token cannot drain it.

On top of the numeric caps sit three additive layers, each of which can only ever *narrow* a spend, never widen it: [natural-language spend rules](financial-controls.md) that an LLM authors and deterministic code enforces, a behavioral anomaly guard that freezes the wallet when a spend doesn't look like the agent's normal behavior, and an owner-signed, epoch-bounded [spend delegation](agent-wallet-api.md#signed-spend-delegation-a-portable-offline-verifiable-cap) that any outside counterparty can verify offline, enforced against the wallet's realized ledger spend rather than a self-reported amount.

### The audit trail

Every spend writes a row to the custody event ledger — amount, USD value, destination, path, timestamp. The rolling daily ceiling is enforced by summing that ledger, which means the cap and the audit trail can never disagree. The ledger is also what the [proof-of-custody](agent-abilities/wallet/20-proof-of-custody.md) Merkle attestation commits to.

## Where owners manage it

The **Agent Wallet Hub** lives at `/agent/:id/wallet`. Owners see all 26 sections; a visitor to a public agent page sees a read-only view: Balance, Deposit, Trust, Trade, and Pulse. Everything a visitor sees is public on-chain data, so the balance a visitor reads is the same live figure the owner reads. The transaction feed is the exception: it is owner-only server-side, so the visitor's Balance tab says so and links to the block explorer instead. A network selector switches every read and write between mainnet and devnet.

`/agent-wallet` is the same hub reached without naming an agent. It resolves the signed-in owner's agents: one agent opens its hub directly, several render a picker, none offers a route to create the first one, and a signed-out visitor is asked to sign in.

Key endpoints:

- `GET /api/agents/:id/solana`: address, live balance, and `deposits_enabled`
  safety verdict (public). Funding UIs must require `deposits_enabled === true`;
  a missing, false, or unreadable verdict is not safe to fund.
- `GET /api/agents/:id/solana/activity`: parsed transaction feed (owner only)
- `GET`/`PUT /api/agents/:id/solana/limits`: read and set the spend policy
- `POST /api/agents/:id/solana/withdraw`: sweep an asset out
- `GET /api/agents/:id/solana/guard` — anomaly guard state and flagged activity
- `GET`/`POST /api/agents/:id/solana/delegation`: read, or verify-and-store, an owner-signed [spend delegation](agent-wallet-api.md#signed-spend-delegation-a-portable-offline-verifiable-cap)

Full request/response shapes are in the [REST API reference](api-reference.md).

### Trading by hand and selling everything

An agent that trades on its own can fill its wallet with coins, so the owner can always step in from the **Trade** tab:

- **Buy or sell any coin by hand.** Paste a mint, or click a row under Holdings to load that coin on the sell side. Portfolio's Trade button does the same.
- **Sell all.** The button in the Holdings header opens a review of every token the wallet holds, highest value first. Untick anything you want to keep, pick a max slippage, and optionally pause the agent's sniper first so it does not buy again while you exit. Coins the sniper still holds as open positions close through `POST /api/sniper/close` (so realized P&L is booked on the position and the worker cannot double-sell). Everything else sells as a normal wallet trade. Sells run one at a time with live per-coin status. A rate limit is waited out, Stop finishes the current sell and skips the rest, and anything left unsold can be retried in one click. SOL and stablecoins are never sold.

Deep links: `/agents/:id/wallet#trade?mint=<mint>&side=sell` opens Trade with a coin loaded, and `/agents/:id/wallet#trade?sell=all` opens the Sell all review. The shared planner and runner live in [src/shared/liquidate.js](../src/shared/liquidate.js).

## Custody modes

The platform key above is the default, not the only option. Owners choose who signs an agent's fund-moving transactions from the **Custody** tab of the wallet hub (owner only):

| Mode | Who signs | Use it when |
|------|-----------|-------------|
| `platform` | The server, inside your spend policy | The agent must act unattended with no wallet open |
| `external` | Your own wallet, one transaction at a time | You never want the platform to sign. Build routes called with `signer: "external"` return an unsigned, simulated transaction and a `tx_id`; `POST /api/tx/submit` broadcasts the signed one and reconciles it to the custody ledger |
| `session` | A delegate key the platform holds, capped on-chain | The agent acts alone inside a limit you grant. Your wallet approves the delegate for a USDC cap and an expiry; a 2 USDC transfer on a 1 USDC cap is refused. Switching mode revokes the approval on-chain |

The confirm-flag rule applies to the custodial path only. The external path is confirmed by the signature itself.

### Exporting the key

The Custody tab can export the wallet's private key. The ceremony is: re-authenticate (password, emailed code or a wallet signature, single-use grant valid five minutes), the server seals the key to an ephemeral browser key, and the browser re-encrypts it to a passphrase you type (PBKDF2 and AES-GCM, `src/wallet/export.js`). The server never sees the passphrase or returns the plaintext, shows it once, and records a `kind=export` event in the custody ledger. Only a browser session can export, never an API key. **Rotate after export** previews, then moves every balance to a freshly generated platform key so the exported key controls an empty wallet. Decrypt an export offline with `scripts/decrypt-wallet-export.mjs`.

### Balance history

The `balance-snapshot` cron records each agent wallet's SOL, USDC and USD value every hour into `agent_balance_history`. The Custody tab draws the series for 24 hours, 7 days or 30 days, and `GET /api/agents/:id/wallet/history?range=24h|7d|30d` returns it. The `get_balance_history` MCP tool reads the same wallet value series.

| Endpoint | Purpose |
|----------|---------|
| `GET`/`PUT /api/agents/:id/signer` | Read or set the mode. `PUT` with `mode: "session"` returns the unsigned grant transaction |
| `DELETE /api/agents/:id/signer/session` | End the session and return the on-chain revoke to sign |
| `POST /api/tx/submit` | Settle a transaction you signed (`tx_id`, `signed_transaction`) |
| `POST /api/agents/:id/wallet/export/{challenge,grant}` then `/export` | Re-authenticate, then export the sealed key |
| `POST /api/agents/:id/wallet/export/rotate` | Preview, then confirm rotate-and-sweep |
| `GET /api/agents/:id/wallet/history` | Hourly balance series |
| `GET /api/me/wallet` | Your own linked wallet, next to the agent wallets |

## Paying by name

An agent can pay a human-readable name instead of a base58 address. `/api/x402/pay-by-name` resolves a recipient across three namespaces: a raw base58 address (passes straight through), a `.sol` SNS name resolved on-chain via Bonfida (subdomains included), or a `@username` (which resolves to that user's default agent's Solana address). `GET` resolves only, so you can show the user the address before spending; `POST` with `mode='send'` (authenticated, `agent_id` required) signs a USDC transfer as the caller's agent under the same spend policy as any other outbound path, and `mode='prep'` returns an unsigned transaction for a browser wallet to sign.

## Related

- [Custody you can verify](custody.md) — limits, freeze, Merkle proof-of-custody, social recovery and inheritance
- [Financial controls](financial-controls.md) — plain-English spend rules, compiled and enforced deterministically
- [What agents can do](agent-abilities.md) — the complete dossier, including a page per wallet ability
- [x402 protocol](x402.md) — how agents pay for services
- [Coin launches](coin-launches.md) — how the wallet signs a pump.fun launch

---

## Runnable example

[`examples/metamask-agent-wallet/`](https://github.com/nirholas/three.ws/tree/main/examples/metamask-agent-wallet) A localhost bridge plus a single page that gives an agent a real server-side wallet through the authenticated MetaMask Agentic CLI.

It is part of the curated set `npm run export:satellites` publishes as the public
three.ws examples repo, so it is installed, run, and link-checked before every release.
