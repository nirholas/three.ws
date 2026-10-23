# Owner-funded agent budgets

An agent budget enforced by the chain, not by our database. The owner keeps the funds in their own wallet and signs one transaction that creates an allowance (token, cap, expiry) naming the agent's wallet as the only spender. The agent can pull up to what is left of that allowance and not a unit more. The owner can revoke it at any time with one signature.

It sits next to the existing custodial controls (spend limits, destination allowlist, signed spend delegations) and is the right choice when you do not want to pre-fund the agent wallet at all.

## How it works

1. **Create.** In the agent wallet hub, open the **Budget** tab, choose a token mint, a cap and an expiry, and approve the transaction in your browser wallet. The server builds the transaction and returns it unsigned. It never holds your key.
2. **Pull.** When the agent needs funds it calls the pull operation. The platform reads the live allowance from the chain first and refuses a request the program would reject. Otherwise the agent signs a pull with its own custodial key. The funds land in the agent wallet's own token account, so everything the agent does next still passes the existing spend guards.
3. **Watch.** The tab shows cap, spent, remaining and expiry, read from the chain on every load.
4. **Revoke.** One click prepares an unsigned revoke transaction. After you sign it the delegation account is closed and every later pull fails.

## The program and client (primary sources)

| | |
|---|---|
| Program | Solana Subscriptions and Allowances, `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` |
| Source | https://github.com/solana-foundation/subscriptions (Solana Foundation, MIT) |
| Client | `@solana/subscriptions` 0.5.0 on npm (generated TypeScript client, MIT) |
| Peer | `@solana/kit`. The package declares `^7`; this repo runs `^8.5.0` and the full lifecycle was verified against it |

We use the generated client's overlay builders. No instruction is hand-encoded.

Instruction set used by the platform:

| Purpose | Instruction |
|---|---|
| First-time setup of the owner's authority | `initSubscriptionAuthority` |
| Fixed cap | `createFixedDelegation`, `transferFixed`, `revokeDelegation` |
| Recurring cap (feature flag) | `createRecurringDelegation`, `transferRecurring`, `revokeDelegation` |

The program also defines plans and subscriptions (`createPlan`, `subscribe`, `transferSubscription`, `cancelSubscription` and others). Subscription plans are out of scope for this feature.

### What the program stores

A fixed delegation stores the **remaining** amount, not the original cap. We record the cap at creation (table `agent_onchain_allowances`) so the UI can show cap, spent and remaining. The chain stays the source of truth for what is left.

A delegation is a standard SPL-token-style approval by the owner to the program, then pulled by the delegatee. The owner's token account must still hold the funds at pull time, so the ceiling also checks the owner's live balance.

## Guard integration

`api/agent/guard.js` treats a call named `allowance_pull` with `{ mint, amountRaw }` as a pull and folds the live on-chain allowance into the verdict as a hard ceiling. The verdict `blockedBy` is `onchain_allowance` and the codes are:

| Code | Meaning |
|---|---|
| `allowance_exceeded` | Request is above the remaining allowance |
| `allowance_expired` | The expiry has passed |
| `no_allowance` | Revoked, closed, or never created |
| `owner_balance_low` | The owner's token account holds less than requested |
| `invalid_amount` | Zero or negative |

An unreadable chain is reported as a blind spot rather than silently allowing. An agent with no allowance for the token is not gated; the feature is owner opt-in like every other cap. The pull endpoint runs the same check, so a refused request never reaches transaction building.

## API

All under `/api/agents/:id/solana/allowance`, owner only, CSRF protected.

| Call | Purpose |
|---|---|
| `GET ?network=` | Allowances with live status, cap, spent, remaining, expiry, token decimals |
| `POST {op:"prepare", owner, mint, amount, expiresInDays, kind?}` | Unsigned create transaction (base64) |
| `POST {op:"confirm", signature, delegationPda, nonce, kind?}` | Verify the account on chain (delegatee is this agent, delegator is a wallet linked to your account) and record it |
| `POST {op:"revoke", id}` | Unsigned revoke transaction |
| `POST {op:"revoked", id, signature}` | Verify the account is closed and record the revoke |
| `POST {op:"pull", id, amountRaw}` | Agent pulls within the cap; simulated, sent, logged as an `allowance_pull` custody event |

## Recurring delegations

`createRecurringDelegation` (an amount per period, resetting each period) is built and read by the same module but ships behind `ALLOWANCE_RECURRING_ENABLED=1`. With the flag off, `prepare` with `kind: "recurring"` is refused with `feature_disabled`.

## Verifying it yourself (devnet only)

```bash
node scripts/allowance-devnet-proof.mjs
```

The script generates throwaway keys and a throwaway mint, then runs create, pull within the cap, an over-cap pull (refused by our guard and by the program), revoke, and a post-revoke pull (refused by both). It prints every signature and exits non-zero if any assertion fails. It refuses to run against any cluster whose genesis is not devnet. It signs nothing on mainnet.

Unit and guard tests: `tests/onchain-allowance.test.js` and the allowance block in `tests/agent-guard-endpoint.test.js`.

## Creating a mainnet allowance

Nothing here signs a mainnet transaction on your behalf. The create transaction is signed in your own wallet from the Budget tab, after your wallet shows you the program, the token, the cap and the expiry.
