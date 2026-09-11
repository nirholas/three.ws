---
title: "Budgets, entitlements, and the $THREE token layer: how we authorize autonomous agent spending | three.ws on AWS"
venue: AWS Builder Center
account: three.ws (official organization account, byline "three.ws")
status: draft, owner approval required before publishing (external-channel gate in CLAUDE.md)
description: "An agent that can pay is an agent that can be exploited. This is the authorization spine we shipped underneath one: AWS Marketplace entitlements under Concurrent Agreements, budgets instead of private keys, the budget check written as a predicate in the UPDATE, the SSRF guard around an LLM-chosen URL, the payment outcome nobody designs for, and the $THREE token layer that routes the platform's own money."
tags: [agentic-ai, security, aws-marketplace, blockchain, open-source]
index: docs/aws-builder-center.md
---

# Budgets, entitlements, and the $THREE token layer: how we authorize autonomous agent spending

Most writing about agent payments stops at the payment. A wallet signs, a transaction confirms, the demo ends, and the hard half never gets discussed.

The hard half is everything that has to be true *before* the signature, and none of it fits in a payments library. Who is this caller, and what is it entitled to? Is the spend inside the budget its owner set, and is that check still correct when four of the owner's agents spend at once? Is the URL it wants to pay safe for our servers to fetch at all? What happens when we submit a payment and the connection dies before we learn whether it landed? And what proves, a year later, that the exchange actually happened?

We shipped answers to all of those at [three.ws](https://three.ws), an open-source (Apache-2.0) platform where AI agents have 3D bodies, wallets, and the ability to buy services from each other. This is the authorization spine underneath it, in the order a request actually travels it. Every claim points at readable source in [the repository](https://github.com/nirholas/three.ws), because the useful version of an article like this is the one a reader can check in the same sitting.

**Status, plainly, because AWS builders check.** three.ws is a verified AWS Partner. The Marketplace SaaS integration below is built, deployed, and conformant with the Concurrent Agreements requirements AWS made mandatory for new SaaS products on 2026-06-01; the product record is awaiting publication, so there is nothing to subscribe to on the AWS side today. A dedicated AWS account in `us-east-1` hosts it: the IAM user for the metering APIs, the EventBridge relay, and the EULA. Storage goes through the AWS SDK for JavaScript v3. The platform's own runtime is on Google Cloud Run, and I would rather say that than let a partner article imply a hosting story that is not ours. Everything else here is live and callable without an AWS account.

**Contents**

1. Two front doors, one authorization check
2. The Marketplace half, and the part of it that is now wrong on the internet
3. Custody, authority, execution: the three things a private key fuses
4. The data model, and the three details that are load-bearing
5. The invariant belongs in the write
6. The URL is attacker-influenced. Treat it that way
7. A payment has three outcomes, not two
8. A budget that expires has to give the money back
9. The platform's own money: $THREE
10. What we would build differently
11. What to lift from this
12. Try it without an AWS account

---

## 1. Two front doors, one authorization check

We have two kinds of buyer, and they have nothing in common.

An **enterprise buyer** wants procurement through the channel it already has: subscribe on AWS Marketplace, consolidate on the AWS invoice, let security review one vendor record. It wants an API key and a contract.

An **agent buyer** can do none of that. It cannot sign up, accept terms, or wait for a human to provision a key, and frequently does not exist as an entity that could hold a contract. It has a wallet and a task, and it needs an answer in the next few hundred milliseconds.

The mistake we avoided, barely, was building two access-control systems:

```
AWS Marketplace subscription
        |  ResolveCustomer (AWS SDK for JavaScript v3)
        v
  license row  -->  account link  -->  API key  --+
                                                  +-->  authorize()  -->  the tool runs
agent wallet  -->  402 challenge  -->  settled  --+                        |
                                                                           v
                                                                   signed receipt
```

Both paths terminate in the same function. Downstream code never asks how a caller was authorized, only whether it was. That single decision is why adding a marketplace front door did not fork the product, and it is the one recommendation I would give anyone adding a Marketplace listing to an existing usage-priced API: **resolve both identities to one internal principal as early as possible, and let nothing downstream know the difference.**

The billing model is unusual and worth stating. The AWS Marketplace subscription is a **free front door**: no AWS pricing dimensions, no AWS-side metering. Subscribing links an AWS account to a three.ws account and issues an access key, and usage is then paid per call in USDC over HTTP 402, exactly as a non-AWS caller pays. We still implemented `MeterUsage`, `BatchMeterUsage` and `GetEntitlements` against the SDK v3 clients, because adding a usage-priced dimension should be a listing change rather than a re-architecture, and that code path should exist before the day you need it.

## 2. The Marketplace half, and the part of it that is now wrong on the internet

If you implement a SaaS listing today by following the highest-ranked tutorials, you will implement the deprecated shape.

### `ResolveCustomer` no longer returns what those tutorials say

For a **new** SaaS integration, `ResolveCustomer` does not populate `CustomerIdentifier`. It returns `LicenseArn` and `CustomerAWSAccountId` ([API reference](https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_ResolveCustomer.html)), and the license ARN is the per-grant identity.

That matters more than a field rename. Under **Concurrent Agreements**, one AWS account can hold several simultaneous agreements for the same product, so the buyer's AWS account id does not identify a subscription. Keying on it produces a bug that appears only for your largest customers, which is the worst possible distribution for a bug. Our customer row keys on `license_arn` and carries `agreement_id` and `customer_aws_account_id` beside it, with the legacy `customer_identifier` nullable and kept only for older rows. Migrating an existing integration is columns and a backfill, not a rewrite, but the *new* rows have to be keyed correctly from day one.

### Lifecycle events moved to EventBridge, and the old path still has to verify

Agreement and license notifications now arrive as EventBridge events. Our webhook still accepts legacy SNS and still verifies its signatures properly, because "we stopped checking the signature on the deprecated path" is how a deprecated path becomes an incident. Support both with one handler and two adapters, not two handlers, so the authorization consequences of an event cannot diverge.

### What refuses what

Four endpoints carry the integration: `register` (the registration URL AWS posts the token to), `subscription` (the lifecycle webhook), `link` (attaches a resolved subscription to a signed-in account), and `issue-key` (mints or returns the access key). The last two require an active session and both refuse a subscription belonging to somebody else, so one AWS subscription can only ever attach to one account: `403 customer_linked_to_other_account` when it is already taken, `409 subscription_inactive` when it is cancelled or expired.

"The plaintext key is returned once, on first issue" is a deliberate constraint worth holding even under support pressure. A key you can re-read is a key your support process can leak.

Source: [`api/aws-marketplace/`](https://github.com/nirholas/three.ws/tree/main/api/aws-marketplace), the helper in [`api/_lib/aws-marketplace.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/aws-marketplace.js), the store in `api/_lib/aws-marketplace-store.js`, and the bridge into the shared authorization path in [`api/_lib/aws-marketplace-bridge.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/aws-marketplace-bridge.js). The SDK v3 clients in use are `@aws-sdk/client-marketplace-metering`, `@aws-sdk/client-marketplace-entitlement-service`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner`.

## 3. Custody, authority, execution: the three things a private key fuses

Now the other front door, where the caller is a machine.

There is a moment in every agentic build where the agent needs to buy something: a paid data feed mid-reasoning, another agent's tool, a rendering job it decided to queue. It hits a `402 Payment Required` and the loop stops, because the one thing it does not have is spending power.

So you give it some, and this is where most designs quietly go wrong. The obvious move is to put a wallet key in the agent's environment. It works immediately, which is the problem: you have now placed an unbounded bearer credential inside a system whose entire job is to read untrusted text and decide what to do next. Prompt injection is not a hypothetical against that design. It is the design's specification.

| Approach | What the agent holds | What a compromise costs | Why teams pick it |
|---|---|---|---|
| Hand the agent a wallet key | Full signing authority, forever | Everything in the wallet, plus everything the key can authorize later | It takes four minutes |
| Give it a funded burner wallet | Full authority over a smaller pot | The burner's balance, plus a refill treadmill and dust stranded across dozens of addresses | It feels bounded |
| Human approval on every payment | Nothing | Nothing, but the agent is no longer autonomous | It is defensible in a review |

The burner wallet is the interesting failure, because it looks like the right answer. It is bounded, so a compromise is capped. But you have traded a security problem for an operations problem: every agent needs funding, refunding and sweeping, and capital disperses one way, into wallets that never send it back. We ran a fleet like that, and the dispersion, not the theft, is what hurt.

All three share one category error. They conflate three concerns that only look like one:

- **Custody**: who holds the key that signs.
- **Authority**: who decides how much may be spent, on what, and until when.
- **Execution**: who initiates a given payment.

A private key fuses all three into one secret. Split them and the design improves immediately.

The developer creates a **payment session**: a budget envelope with a total, a per-transaction ceiling, a host allowlist, a network and an expiry. In return they get a bearer token, once, which they hand to the agent. The agent can now call paid endpoints. It cannot exceed the budget, pay a host outside the allowlist, spend after the expiry, or sign anything itself, because the platform's wallet signs and the agent never sees a key.

Custody sits with the platform, authority with the developer, execution with the agent. Compromising the agent gets an attacker exactly one thing: the remaining budget, spendable only at hosts you approved, only until the session expires. That is not zero. It is a number you chose in advance, which is the entire point.

## 4. The data model, and the three details that are load-bearing

Two tables. The session is the policy plus the counter; the execution log is the immutable audit trail.

```sql
create table if not exists payment_sessions (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references users(id) on delete cascade,

    budget_usdc         bigint not null check (budget_usdc > 0),
    spent_usdc          bigint not null default 0 check (spent_usdc >= 0),
    max_per_tx_usdc     bigint check (max_per_tx_usdc > 0),
    allowed_hosts       text[] not null default '{}',
    network             text not null default 'solana' check (network in ('solana', 'base')),

    status              text not null default 'active'
                            check (status in ('active', 'exhausted', 'expired', 'cancelled')),
    expires_at          timestamptz not null,
    token_hash          text not null
);
```

**Money is `bigint`, never `float`.** USDC has six decimals, so every amount is stored in atomic units and converted at the edges. A rounding error in a budget check is a security bug, not a display bug.

**`spent_usdc` lives on the session row and is not derived from the log.** It is tempting to compute spend with `SELECT sum(amount) FROM executions`. Do not. That number has to be checked and incremented in the same atomic operation as the authorization decision, and a sum over a second table cannot give you that without a lock you will regret. The log reconciles the counter; it does not replace it.

**The token is never stored.** Only its HMAC is:

```js
const TOKEN_PREFIX = 'pss_';

export function generateSessionToken(sessionId) {
  const rand = randomBytes(16).toString('hex');
  return `${TOKEN_PREFIX}${sessionId}_${rand}`;
}

export function hashToken(token) {
  return createHmac('sha256', hmacKey()).update(String(token)).digest('hex');
}
```

The session id is embedded in the token, so lookup is a primary-key hit rather than a scan over hashes, and verification is `WHERE id = $1 AND token_hash = $2`. A dumped database row is inert without the HMAC key, and a leaked token is bounded by the policy on the row it points at.

## 5. The invariant belongs in the write

The agent makes one call: `POST /api/pay/execute` with a session token and a URL. The token is verified before anything touches the network. The target is probed for its `402` challenge, and if it answers without one it was free, so we return the response without touching the session, because an agent should not burn budget discovering that something was free. Then the policy runs, cheapest and most decisive first: status, expiry, allowlist, per-transaction ceiling, budget.

The allowlist check is worth showing, because the subdomain rule is where these go wrong:

```js
export function hostMatches(targetHost, entry) {
  if (!targetHost || !entry) return false;
  return targetHost === entry || targetHost.endsWith(`.${entry}`);
}
```

`targetHost.endsWith('.' + entry)`, not `targetHost.endsWith(entry)`. Without the dot, an allowlist entry of `example.com` also authorizes `evil-example.com`, and an attacker who can steer your agent to a URL only needs to register the right domain. That is why this is a named function with a test behind it instead of an inline `endsWith`. Hosts are normalized through the URL parser first, so `HTTPS://Example.COM:443/x` and `example.com` compare equal. The predicates live in [`api/_lib/pay/policy.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/pay/policy.js) and are shared with the dry-run simulator, so a simulated verdict and an enforced one cannot disagree.

Then the budget, and here is the concurrency bug. It is not theoretical. Agents are concurrent by nature: a single run can have three tool calls in flight, and an orchestrator can have thirty.

Read-then-write does not work:

```
Session budget: $1.00 remaining

Request A: SELECT remaining -> $1.00. Enough for $0.80? Yes.
Request B: SELECT remaining -> $1.00. Enough for $0.80? Yes.
Request A: UPDATE spent = spent + 0.80
Request B: UPDATE spent = spent + 0.80

Spent: $1.60 against a $1.00 budget.
```

The fix is to make the check and the increment the same statement, and let the database resolve the race:

```js
const [updated] = await sql`
  UPDATE payment_sessions
  SET spent_usdc = spent_usdc + ${amount.toString()},
      updated_at = now()
  WHERE id = ${session.id}
    AND status = 'active'
    AND (budget_usdc - spent_usdc) >= ${amount.toString()}
  RETURNING id, spent_usdc, budget_usdc
`;
```

Row-level locking means the second `UPDATE` re-evaluates its `WHERE` clause against the first one's committed result. It matches zero rows, `updated` is undefined, and the caller gets a precise error instead of an overdraft. No advisory locks, no retry loop, no distributed lock service. One statement whose `WHERE` clause *is* the invariant.

If you take one thing from this article, take this: **write the budget check as a predicate in the `UPDATE`, not as a `SELECT` before it.** Note that it is a *reservation*, taken before the payment is attempted, because the alternative is holding budget open across a network call to a third party.

## 6. The URL is attacker-influenced. Treat it that way

Step back and look at what this endpoint does: it takes a URL chosen, at least partly, by an LLM, and makes a server-side request to it from inside your infrastructure. That is a server-side request forgery primitive with a payment attached.

So the fetch is guarded, and the guard runs before the payment is signed:

```js
async function guardedFetch(rawUrl, { method = 'GET', headers = {}, body } = {}) {
  const url = validatePublicUrl(rawUrl);
  const addrs = await resolvePublicHost(url.hostname);
  const agent = pinnedAgent(url.hostname, addrs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      dispatcher: agent,
```

Four controls, each closing one hole:

- `validatePublicUrl` rejects non-public schemes and address ranges: link-local, loopback, private space, and the cloud metadata endpoint at `169.254.169.254` that turns an SSRF into credential theft on every major cloud.
- `resolvePublicHost` resolves DNS and validates the answers, so a hostname that resolves into private space is caught.
- `pinnedAgent` pins the connection to the addresses that were validated. Without it you have a DNS rebinding window between the check and the connect.
- `redirect: 'manual'` stops a public URL from bouncing you to an internal one after validation has already passed.

The allowlist is policy. This is the floor underneath it, and it applies even when a session sets no allowlist at all. If you are building any agent feature that fetches a model-chosen URL, this section is the one to copy first, whether or not money is involved.

## 7. A payment has three outcomes, not two

This is the section most write-ups skip, and it decides whether you can run any of this in production.

**Rejected before settlement.** The service answers `402` again, usually because it re-quoted between the probe and the replay. Because the protocol verifies before it settles, no funds moved, so the reservation is safe to release and the budget goes back:

```js
if (paid.status === 402) {
  await rollbackReservation(sessionRecord.id, amountAtomics).catch(() => {});
  return error(res, 402, 'payment_rejected',
    'Service rejected the payment before settlement. Budget has been restored.');
}
```

**Settled.** Log the transaction hash, return the result, done.

**Unknown.** The request was submitted and the connection died before an answer came back. The transaction may have landed on-chain. It may not have. We cannot know from here.

```js
} catch (err) {
  // Network failure AFTER signing: chain state unknown, do NOT roll back.
  await recordExecution({
    status: 'failed',
    errorCode: 'settle_uncertain',
    errorMessage: err?.message,
  }).catch(() => {});
  return error(res, 502, 'settle_uncertain',
    'Payment was submitted but confirmation was not received. Do not retry immediately.');
}
```

The comment carries the whole decision: **do not roll back**. Restoring the budget after a payment that may have settled means the next call can spend money that is already gone. So the session stays debited, the execution is logged as `settle_uncertain`, and the error tells the caller not to retry blindly.

That is worse for the user than an automatic refund and better than a silent double-spend. When you cannot know the truth, bias the accounting toward the conservative answer and make the uncertainty legible instead of hiding it. Every payment system reaches this fork. Most pretend they do not.

Idempotency is the companion control: every execution can carry a caller-supplied key with a `unique` constraint behind it, so a retried agent run cannot bill twice.

Three more rules earned by losing money. **Preflight the seller**: is the challenge well-formed, is the receiving address real, do the declared chain and asset match, does the settlement path respond. We shipped that as [`@three-ws/x402-preflight`](https://www.npmjs.com/package/@three-ws/x402-preflight) after losing calls to sellers that answered a challenge, took the proof, then failed on their own settlement. **Bound the re-quote retry at exactly one**, re-applying the spend cap and allowlist to the fresh quote, because unbounded retries against a re-quoting seller is a slow drain. And **cap spend daily across the whole loop**, not per call: per-call caps feel safe and compose into an unbounded total.

## 8. A budget that expires has to give the money back

A budget is debited from the developer's balance the moment the session is created, so an expiry that merely marks a row `expired` quietly keeps their money. A sweep runs every five minutes and refunds the difference:

```js
const expiredRows = await sql`
  WITH due AS (
    SELECT id FROM payment_sessions
    WHERE status = 'active'
      AND expires_at < now()
    ORDER BY expires_at ASC
    LIMIT ${BATCH_LIMIT}
    FOR UPDATE SKIP LOCKED
  )
  UPDATE payment_sessions s
  SET status = 'expired', updated_at = now()
  FROM due
  WHERE s.id = due.id
  RETURNING s.id, s.user_id, s.budget_usdc, s.spent_usdc
`;
```

The batch limit lives inside the `UPDATE` rather than in a JavaScript slice of the result, and that is not a detail. An unbounded `UPDATE` flips every due session to `expired` while only the sliced head is ever refunded, and the remainder is then invisible to the next tick, which only looks at `status = 'active'`. Whatever this tick does not claim stays active and is swept next time. `FOR UPDATE SKIP LOCKED` keeps concurrent ticks on disjoint rows.

Each refund then carries an idempotency key derived from the session id, so overlapping ticks cannot double-refund. The same path runs on manual cancellation.

Short-lived sessions are the security posture we want people to adopt, so expiring one has to be free. If it costs the user money, they will set the TTL to a year and the control is gone.

One rule that governs every table here, and cost us a rewrite to learn: **decide what a ledger row means before you put a number on a page.** Our public volume roll-up filters on `completed` in every aggregate, so "volume" means "money actually moved, signature on file". The version where it quietly counts attempts is a number you cannot walk back once people have quoted it. The receipts that make a settled row checkable a year later are their own spec, [`three-inference-receipt/v1`](https://github.com/nirholas/three.ws/blob/main/specs/inference-receipts.md), which commits to the SHA-256 of the exact prompt and completion rather than to a timestamp.

## 9. The platform's own money: $THREE

Everything above is the platform authorizing somebody else's spend. This is the platform authorizing its own, where the discipline gets tested hardest because there is no counterparty to complain when we get it wrong.

three.ws has a token on Solana, `$THREE` (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`). It prices paid actions, gates holder-only content, and routes platform revenue back to the people who hold it. It is also, from an engineering standpoint, a config file that decides where real money goes, which is exactly the kind of thing that is wrong in production before anyone notices.

### The split is a policy, not a fork of logic

Every paid surface names a split policy: an ordered list of legs in basis points, with roles resolved to addresses at call time. Adding a paid surface is a policy name, not a new payment path.

| Policy | Legs |
|---|---|
| `consumption` (pay-per-use compute: generation tiers, voice clone, selfie to avatar) | treasury 70%, holder rewards 30% |
| `marketplace_sale` (skills, animations, avatars, resales) | seller or creator 90%, treasury 5%, holder rewards 5% |
| `scarcity_mint` (drops, rare-name auctions, pay-to-mint) | treasury 80%, holder rewards 20% |
| `spin` (paid in-app actions) | treasury 50%, holder rewards 50% |
| `copy_performance_fee` (on a copier's realized profit only) | leader 80%, treasury 15%, holder rewards 5% |

Two defensive details are why a mis-edited policy cannot silently mis-pay. Legs that do not sum to exactly 10,000 bps throw, so a bad edit fails at the first call instead of leaking a remainder for a month. And the rounding remainder from the atomics distribution goes to the highest-bps leg, so per-leg amounts always sum to exactly the total. Money math is BigInt on atomics throughout, per section 4.

### The economy policy is a restraint, written where it is enforced

The top of the config module carries the policy in capitals: no platform burns. Every `$THREE` the platform charges routes to the treasury, to a holder-rewards pool, and on a sale to the seller or creator. Supply is never destroyed by the platform; the treasury funds buybacks instead, which creates buy pressure without deflation, and the role resolver has no branch that routes a platform policy to burn at all.

A policy like that in a README is a wish. In the module that resolves every destination address, beside a resolver with no branch for it, it is a constraint: adding a burn leg means deleting the note explaining its absence, in the same diff, in front of a reviewer.

### Fail closed on the address itself

```js
export function treasuryWallet() {
  const w = env.THREE_TREASURY_WALLET;
  if (w) return w;
  if (process.env.NODE_ENV === 'production') {
    const e = new Error('[token] THREE_TREASURY_WALLET is required in production.');
    e.status = 503;
    e.code = 'treasury_unavailable';
    throw e;
  }
```

Fund-moving paths use that strict lookup; read-only paths (public config, status displays) use a non-throwing variant returning `null`, because a missing treasury is a misconfiguration of the *fund-routing* path and must not take down a status page. The failure is a typed `503` rather than a generic `500`, so the caller renders "temporarily unavailable", which is the honest description of a deploy-time misconfiguration.

The guard is not hypothetical, and you can check it from outside. `GET /api/token/config` on production reports `"treasury_configured": false`, because the fund-routing wallets are deliberately not set on the running service. The read paths are live (the price lane answers from Jupiter with a real quote and an `as_of` stamp) while every fund-routing call refuses rather than paying an unset address. Two curls verify both halves, which is the only kind of claim worth making about somebody else's money handling.

### The buyback engine, and the two numbers it will not conflate

The buyback lane turns accumulated platform revenue into on-chain buy pressure: market-buy `$THREE` on Jupiter, route the tokens to the treasury, publish the result. One decision there transfers to any system that both spends and reports: **custody and accounting are decoupled.** What the engine may spend is driven by the buyback wallet's live USDC balance, capped per run. What we publish as revenue earned reads the fee ledger. Separating them means a bad accounting read cannot cause a bad trade, while the public ratio stays honest: earned against deployed, not one number doing both jobs.

### Gating across a trust boundary without shipping the truth

`$THREE` also gates content, and that is the cleanest authorization problem on the platform. Our multiplayer server is a standalone process with no Solana RPC and no price feed, and it has to decide whether a visitor may enter a holder-only world. Both naive answers are bad: give the game server a chain client and a pricing dependency, or let the client report its own balance.

Instead the truth is computed once on the API side, where the RPC and price feed already live. The user's linked wallet is read *from their authenticated session, never from the request*, so a pass cannot be minted for someone else's wallet. The balance is priced, checked against a shared floor, and sealed into an HMAC-signed token carrying mint, wallet, USD value, tier, issued-at and expiry. The game server verifies it with a shared secret and nothing else. The pass lives ten minutes: long enough to load into a world, short enough that a wallet that sold cannot linger on an old one. The secret fails closed exactly like the treasury address.

That generalizes to any system where the component making an access decision cannot see the truth: **compute the fact once where it is cheap and trustworthy, sign it, give it a short life, and let the far side verify with a secret instead of a dependency.** The same gate powers token-gated 3D embeds: a scene public by URL that renders only for a wallet clearing a balance the creator set. It accepts any SPL mint at runtime; `$THREE` is the default.

### The token as an agent primitive, with the bounds on the server

Finally, `$THREE` as something an agent can use, through an MCP server with three tools: read the live price, read a wallet's balance, and burn.

The burn tool is the article's argument in one function: irreversible, on-chain, exposed to an autonomous caller, with every control assuming the client is not trustworthy. The tools ship MCP annotations, so the reads advertise `readOnlyHint`, burn is flagged `destructiveHint`, and annotation-aware clients prompt first. Those hints are advisory, which is exactly why they are not the control. Server-side, every burn is bounded by a maximum USD value (default $100) and gated by a confirm flag that is on by default. And destinations resolve at runtime from the public token config rather than being hardcoded, then, before signing, the resolved mint is asserted to equal the canonical `$THREE` address. A misconfigured or compromised config endpoint cannot redirect a burn into another token.

That assertion rhymes with `hostMatches` in section 5 and `validatePublicUrl` in section 6: **the final check before an irreversible action must not trust the configuration that got you there, nor the client that asked for it.**

The burn looks like it contradicts the no-burn policy above. It does not: the platform never burns, and a holder may choose to burn tokens they already hold. Platform revenue creates buy pressure through the treasury; destroying supply belongs to whoever owns the tokens.

## 10. What we would build differently

Three things, plainly, because partner articles that contain only wins are not useful to anyone.

**Model the counterparty, not just the call.** For a long time our spend policies constrained amounts and rates but not *who*. Recipient allowlists arrived after we needed them, which is the wrong order.

**Write the refusal before the interface.** For every capability that touches money or matter, write the server-side refusal first and the interface second. A guard that lives in prompt text or a hidden button is not a guard. And where a model sits in front of an irreversible action, settle precedence before you ship: in our fabrication gate, which stands between a prompt and a physical printed object, the deterministic denylist always wins and the LLM may only ADD refusals, never overturn one. The alternative is a safety property a prompt can argue with.

**Separate free and paid at the server boundary, not with a flag.** Our free generation dispatcher carries the comment "there is no scope check and no payment path here", and that is verifiable in a minute by a reviewer, a customer, or us. A disabled payment path and an absent one look identical in a demo and nothing alike in an audit.

## 11. What to lift from this

All Apache-2.0, and none of it requires the rest of the platform or our hosting:

1. `@three-ws/x402-server` to be a seller, `@three-ws/x402-fetch` to be a buyer (a drop-in `fetch` wrapper that pays challenges automatically).
2. `@three-ws/x402-preflight` so you never pay a seller that cannot settle.
3. `@three-ws/agent-guards` and `@three-ws/agentcore-payments-mcp` for budgets instead of credentials. The second is an MCP server, so it drops into an Amazon Bedrock AgentCore agent, a Strands agent, or your own loop without caring where the agent runs.
4. `@three-ws/agent-vitals` to tell whether a fleet can act at all, which is not what a liveness check measures.
5. `@three-ws/witness`, which records what a user actually did and compiles it into a test that is red while the bug exists and green once it is fixed.

There are 91 packages in the repository and 72 MCP servers under one namespace in the official registry. Those five are where I would start.

## 12. Try it without an AWS account

Everything free below is keyless. Paste and run.

```bash
# a free, keyless dry run: the printability report that precedes any paid print
curl -s -X POST https://three.ws/api/print/quote \
  -H 'content-type: application/json' \
  -d '{"glbUrl":"https://three.ws/avatars/cesium-man.glb"}'

# the $THREE token layer: live price, and the split policy every paid surface names
curl -s https://three.ws/api/token/price
curl -s https://three.ws/api/token/config

# the public catalog of priced endpoints an agent can discover
curl -s https://three.ws/.well-known/x402.json | head -c 600

# the exact commit and revision production is running
curl -s https://three.ws/api/version
```

Source: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), Apache-2.0.

The parts I would most like other builders to argue with are section 3 (a policy instead of a credential) and section 7 (the outcome that has no clean answer). Both started as opinions and only later turned out to be load-bearing.

---

*three.ws is a verified AWS Partner and an open-source platform for 3D AI agents and on-chain communities, with an AWS Marketplace listing built and awaiting publication. Previously from us here: [how we metered a SaaS product through AWS Marketplace with the AWS SDK for JavaScript v3](https://builder.aws.com/content/3ESpll50BdSp9eiCEIxcfG9pGUN/how-we-metered-a-saas-product-through-aws-marketplace-with-the-aws-sdk-for-javascript-v3).*
