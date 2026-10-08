---
venue: AWS Builder Center
account: three.ws (official organization account, byline "three.ws")
suggested_title: "The agent bought a physical object: building an authorization spine for autonomous commerce"
suggested_description: "How we wired AWS Marketplace entitlements, agent spend policies, a self-hosted x402 facilitator, and per-call settlement into one authorization path, and what that path looks like when the thing at the end of it is a printed object in a box."
suggested_tags: [agentic-ai, agent-toolkit, aws-marketplace, generative-ai, blockchain]
suggested_canonical: https://three.ws/docs/materialize
status: draft, not yet submitted
---

# The agent bought a physical object: building an authorization spine for autonomous commerce

Imagine asking an AI agent to design a small desk figurine, and a little over a week later a nylon print of it arrives at your door, with a certificate in the box that says exactly which generation produced it. The agent found the model, checked that it could be printed, got a price, paid for it, and tracked the order, all on its own, inside a budget you set.

That is a real flow at [three.ws](https://three.ws) today, and this article is about the part of it you do not see: the authorization layer that makes it safe to hand an agent that much autonomy.

If you are new to agent commerce, here is the friendly version. When a person buys something online, a lot of quiet checks happen around the payment: who you are, what you are allowed to buy, whether it fits your budget, whether the seller can deliver, and a receipt at the end. An agent needs every one of those checks too, and it needs them to run in milliseconds, without a human clicking through a form. We call the chain of those checks the **authorization spine**, and every purchase on three.ws travels along it.

The questions it answers, in order: Who is this caller? What is it entitled to? Is this within the budget its owner set, and does that check hold when four of the owner's agents spend at once? Can the seller on the other end settle? What proves, afterwards, that the exchange happened? And when the thing being bought is a physical object that gets manufactured and shipped, what screens the order before production begins?

three.ws is an open-source platform (Apache-2.0) where AI agents have 3D bodies, wallets, and the ability to buy services from each other. This article walks through the spine underneath it: the AWS Marketplace entitlement path with the AWS SDK for JavaScript v3, the spend policy that sits between an agent and a credential, the preflight check that confirms a seller can settle, the receipt layer that makes it auditable, the partners whose infrastructure carries it, and the physical fulfillment lane at the end. Every claim points at readable source in [our repository](https://github.com/nirholas/three.ws).

**Where things stand.** three.ws is an AWS Partner, and the AWS Marketplace SaaS integration described below is built, deployed, and conformant with the Concurrent Agreements requirements AWS made mandatory for new SaaS products on 2026-06-01. The Marketplace listing is coming: creating the product record in the AWS Marketplace Management Portal is the next step. Every other surface in this article is live today and callable without an AWS account. The AWS account `155407237916` (`us-east-1`) hosts the Marketplace integration: the IAM user for the metering APIs, the EventBridge relay, and the EULA. The platform's own runtime runs on Google Cloud Run, under our membership in Google Cloud for Web3 Startups, so the two clouds each do what they do best for us.

**Contents**

1. Two economies, one authorization path
2. The AWS Marketplace half, built on the current SaaS contract
3. The agent half: a budget, not a credential
4. Payment sessions: what "budget" looks like as an API
5. Preflight, re-quotes, and settlement assurance
6. Receipts: the part that makes it auditable a year later
7. Can this agent act? A health check built for agents
8. The end of the chain is an object in a box
9. The partners underneath the spine
10. What is open, and what you can lift from it
11. Design principles we carry forward
12. Try it without an AWS account

---

## 1. Two economies, one authorization path

We serve two very different kinds of buyer, and both are a pleasure to design for.

An **enterprise buyer** wants procurement through the channel they already have: subscribe on AWS Marketplace, keep the vendor relationship in their AWS account, let security review one vendor record. They want an API key and a clear agreement.

An **agent buyer** works differently. It has a wallet and a task, and it needs the answer in the next few hundred milliseconds. It does not sign up, accept terms, or wait for a key to be provisioned by a human, so its access has to be granted by protocol rather than by paperwork.

We built one authorization check with two front doors:

```
AWS Marketplace subscription
        │  ResolveCustomer (SDK v3)
        ▼
  license row  ──▶  account link  ──▶  API key  ──┐
                                                   ├──▶  authorize()  ──▶  the tool runs
agent wallet  ──▶  402 challenge  ──▶  settled  ──┘                          │
                                                                             ▼
                                                                     signed receipt
```

Both paths terminate in the same function. Downstream code never asks how the caller was authorized, only whether it was. That single decision is why adding the Marketplace front door kept the product as one codebase, and it is the recommendation I would make to anyone adding a marketplace listing to an existing usage-priced API: **resolve both identities to one internal principal as early as possible, and let nothing downstream know the difference.**

The billing model is worth describing precisely, because it is a little unusual: the AWS Marketplace subscription is a **free front door**. There are no AWS pricing dimensions and no AWS-side metering. Subscribing links an AWS account to a three.ws account and issues an x402 access key; usage is then paid per call in USDC over HTTP 402, exactly as a non-AWS caller pays, so there is nothing to reconcile on the AWS invoice. We still implemented `MeterUsage`, `BatchMeterUsage`, and `GetEntitlements` against the SDK v3 clients, so a usage-priced dimension is a listing change rather than a re-architecture. Two environment switches already exist for that day: `AWS_MP_METERING_DIMENSION` reports `BatchMeterUsage` per granted call on a usage-based listing, and `AWS_MP_ENTITLEMENT_REQUIRED` gates key issuance on a live `GetEntitlements` check for a contract listing. Issued keys carry a rate limit (600 per minute by default), adjustable per offer.

---

## 2. The AWS Marketplace half, built on the current SaaS contract

AWS refreshed the SaaS integration contract for new products, and building to the current shape from day one is the cleanest path. Here is what that shape looks like in practice.

### `ResolveCustomer` returns a license ARN

For a **new** SaaS integration, `ResolveCustomer` returns `LicenseArn` and `CustomerAWSAccountId` ([API reference](https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_ResolveCustomer.html)), and the license ARN is the per-grant identity.

This is a genuinely good change, because under **Concurrent Agreements** one AWS account can hold several simultaneous agreements for the same product. Keying every subscription on its license ARN is what lets one AWS account hold several agreements cleanly, which is exactly how larger organisations buy.

Our customer row carries all of it: `license_arn` (unique), `agreement_id`, `customer_aws_account_id`, and a nullable legacy `customer_identifier` kept for lookups of older rows. If you are extending an existing integration, the move is additive: new columns and a backfill, with new rows keyed on the license ARN from day one.

### The handle in the redirect URL is the row's own id

After the buyer clicks **Set up your account**, AWS POSTs a short-lived registration token to our registration URL. We exchange it, then redirect the browser to a welcome page carrying a handle, and that handle is **the row's own id**. The license ARN stays on the server, so a grant identifier never appears in browser history, referrer headers, proxy logs, or analytics.

### Lifecycle events arrive on EventBridge, and every path verifies

Agreement and license lifecycle notifications arrive as EventBridge events with `source: aws.agreement-marketplace`. Because EventBridge delivers to a seller account's event bus, an EventBridge rule targets an **API destination** that relays to our webhook, and `scripts/aws-marketplace-provision.sh` creates the connection, destination, IAM role, dead-letter queue, and rule in one go. EventBridge retries with backoff and dead-letters to SQS, so every delivery is recoverable.

| Event | Effect |
|---|---|
| `Purchase Agreement Created` / `Amended` | Record the agreement; open a pending record if the buyer has not registered yet |
| `License Updated` | Attach the license ARN to the buyer's record |
| `Purchase Agreement Ended` | Revoke the x402 key and mark the record cancelled |
| `License Deprovisioned` | Revoke the x402 key and mark the record cancelled |

The relay authenticates with a shared secret the API destination attaches as a header, compared in constant time. Our webhook also accepts the legacy SNS notifications (`subscribe-success`, `unsubscribe-success`, `subscribe-fail`, `entitlement-updated`) with full signature verification that follows the message's `SignatureVersion`, and binds them to the AWS-issued topic for this product by pinning its ARN. Every path that can change authorization gets the same rigour. If you support both transports, write one handler with two adapters rather than two handlers, so the authorization consequences of an event are identical whichever way it arrives.

One design detail we are particularly happy with: when an end event identifies only an AWS account, and that account holds more than one live agreement for the product, the webhook records the event precisely and revokes nothing, so a buyer's paid access always stays exactly as they bought it.

### The endpoints, and what each one answers

| Endpoint | Purpose |
|---|---|
| `POST /api/aws-marketplace/register` | Registration URL. Receives the token, resolves the license, starts onboarding. Called by AWS. |
| `POST /api/aws-marketplace/subscription` | Lifecycle webhook. EventBridge agreement and license events, plus legacy signature-verified SNS. Called by AWS. |
| `POST /api/aws-marketplace/link` | Attaches a resolved subscription to the signed-in account. Requires a session. |
| `POST /api/aws-marketplace/issue-key` | Mints or returns the x402 API key. Plaintext is returned once, on first issue. |

`link` and `issue-key` both require an active session and both keep a subscription with the account it belongs to, so a given AWS subscription is attached to exactly one account:

| Status | Meaning |
|---|---|
| `401 unauthenticated` | No valid session. Sign in and retry. |
| `403 customer_linked_to_other_account` | Already attached to a different account. |
| `404 customer_not_found` | Unknown subscription record. Re-open the setup link from Marketplace. |
| `409 subscription_inactive` | Cancelled or expired. Re-subscribe first. |

Returning the plaintext key once is a deliberate choice: it keeps the only readable copy of the key with its owner, where it belongs.

Code: [`api/aws-marketplace/`](https://github.com/nirholas/three.ws/tree/main/api/aws-marketplace), [`api/_lib/aws-marketplace.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/aws-marketplace.js), the store in `api/_lib/aws-marketplace-store.js`, and the bridge into the shared authorization path in [`api/_lib/aws-marketplace-bridge.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/aws-marketplace-bridge.js). The SDK v3 clients in use are `@aws-sdk/client-marketplace-metering`, `@aws-sdk/client-marketplace-entitlement-service`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner`.

---

## 3. The agent half: a budget, not a credential

When you give an agent buying power, the primitive we reach for is a **policy**, not a credential: a budget, a set of allowed counterparties, a per-call ceiling, and an expiry. A policy is bounded from the moment it exists. The agent acts under it on every spend, and the ceiling is enforced where concurrency cannot get around it.

Three implementation details make it hold.

**Reserve, then settle, then complete.** Our agent-to-agent hire ledger writes the row as `pending` and reserves the spend against the owner's policy in the same statement that checks it. The payment then runs over the real rails. Because the protocol verifies before it settles, an unsuccessful attempt moves no funds: we release the reservation and mark the row accordingly. After settlement we mark it `completed` and attach the settlement signature, payer address, and result summary.

**Put the guard in the same statement as the state change.** Each budget check is a single statement with its condition inline, so the check and the reservation are one atomic operation. That makes the budget race-free by construction, even with many agents spending from it at once.

**Only settled rows count.** Our public volume roll-up filters on `completed` in every aggregate, so "volume" means "money actually moved, signature on file", and that definition is applied identically to totals, counts, averages, leaderboards, and the feed. When the ledger has no rows yet, the endpoint returns a real zero shape and the page renders a designed empty state. If you are building a dashboard over an agent economy, deciding what a row means **before** you put a number on a page means every number you publish is one you can stand behind.

The framing we design against: **an autonomous spend has the same three properties as a database transaction.** Atomic (the check and the reservation are one operation), consistent (the ledger and the policy always agree), durable (every attempt is logged, whatever its outcome, so the whole history is auditable).

---

## 4. Payment sessions: what "budget" looks like as an API

A policy is most useful when it is easy to hand out, so we published it as a session primitive: [`@three-ws/agentcore-payments-mcp`](https://www.npmjs.com/package/@three-ws/agentcore-payments-mcp) creates a **budgeted payment session** and lets an agent pay any priced endpoint from it without ever holding a key. Its one-line summary is the whole philosophy: the agent does not hold a wallet; it proposes spend, and governance enforces policy.

An owner creates a session with a total budget, a per-transaction ceiling, an allowlist of hosts, and an expiry:

```json
{
  "budget_usd": 10.00,
  "label": "Research agent, June sprint",
  "expiry_seconds": 86400,
  "max_per_tx_usd": 0.50,
  "allowed_hosts": ["api.example.com", "data.provider.io"],
  "network": "solana"
}
```

The session token is shown once. The agent then calls `pay_with_session` with a URL and an `idempotency_key`, the platform wallet signs, and every call debits the session atomically on the server. The response carries the transaction hash, an explorer link, and the updated budget. When the budget is spent, the session declines further calls, and that is a normal, well-typed outcome the agent handles like any other result. `check_payment_session` and `list_payment_sessions` give the owner the full picture at any time.

Because the interface is an MCP server, any client that speaks the Model Context Protocol gets these as ordinary tools. It drops into an Amazon Bedrock AgentCore agent, a Strands agent, a Claude Code session, or your own loop, without caring where the agent runs.

Related packages, because different consumers want different ergonomics:

- [`@three-ws/x402-fetch`](https://www.npmjs.com/package/@three-ws/x402-fetch), a drop-in `fetch` wrapper that pays challenges automatically. If your code already speaks `fetch`, this is a two-line adoption.
- [`@three-ws/agent-guards`](https://www.npmjs.com/package/@three-ws/agent-guards), per-agent spend policies and trade guards as a standalone library, if you want the enforcement on its own.
- [`@three-ws/onchain-agent-wallets`](https://www.npmjs.com/package/@three-ws/onchain-agent-wallets), which frames the same idea at the chain level: give an agent a spending allowance rather than a private key.

And the merchant side, since half of any economy is the seller: [`@three-ws/x402-server`](https://www.npmjs.com/package/@three-ws/x402-server) turns any HTTP endpoint into a paid one, building the 402 challenge and running the verify, dispatch, settle flow, with zero dependencies.

---

## 5. Preflight, re-quotes, and settlement assurance

HTTP 402 as a protocol is elegant: a caller requests, gets a structured challenge with payment requirements, pays, and retries with proof. Around that core, we invested heavily in settlement assurance, the set of checks that keeps an agent economy predictable at scale.

**Preflight.** Before paying anyone, an agent can confirm that the seller can settle: the challenge is well-formed, the receiving address is real, the declared chain and asset match what is being asked for, and the settlement path responds. We shipped this as a surface ([three.ws/preflight](https://three.ws/preflight)) and a package ([`@three-ws/x402-preflight`](https://www.npmjs.com/package/@three-ws/x402-preflight)), so every paid call can start from a confirmed seller.

**Re-quote handling, bounded at exactly one retry.** If a paid replay itself answers `402`, the seller has usually re-quoted between probe and replay. In that case the signed transfer is never broadcast, so no money has moved and one retry is safe. Our buyer re-fetches the challenge once, settles against the **fresh** requirements, re-applies both the spend cap and the recipient allowlist to the new quote, and records the retry distinctly in its logs so the pattern is visible. One bounded retry keeps spend predictable.

**A daily spend cap across the whole loop**, in addition to the per-call ceiling, so the total across a working day has a ceiling as well as each call.

**Log every decision with the same care.** Every autonomous call we make is recorded, with the challenge, the decision, and the outcome, so declined calls are as well documented as completed ones and the whole history reads cleanly.

---

## 6. Receipts: the part that makes it auditable a year later

An entitlement answers "may this caller do this". A receipt answers "did this exchange actually happen, and can a third party check". Enterprise buyers value the second question, and we built the answer in from the start.

Our receipt layer stores signed Offer and Receipt artifacts and keeps them retrievable: at the last footprint audit (2026-08-25) the vault held **58,907 signed artifacts**. Alongside it we run our own settlement facilitator: **110,416 on-chain settlements and 803,483 verifications** at that same audit, with the implementation in the repo under `api/_lib/x402/`. USDC is the default settlement asset, and the smallest payment the facilitator settles is $0.001, which is what makes genuine per-call pricing practical. Discovery is a static, public catalog at `/.well-known/x402.json` listing **4,519 priced endpoints**, which is how an agent finds a seller in the first place.

Two principles that transfer to any metered API, marketplace-billed or not:

**Self-hosting the settlement path gives end-to-end visibility.** Every step from verification to on-chain settlement is code we run and can read, so we can trace any payment from challenge to signature, and our latency is ours to tune. Solana is our home chain and settlement runs on our own rail there.

**Discovery works best as a static document.** Ours is a file on our own domain: cacheable, diffable, readable by anything, and always available, which is exactly what you want sitting in the middle of a payment flow.

---

## 7. Can this agent act? A health check built for agents

Liveness checks answer "is the process up?", and they do it well. An autonomous agent also needs a second question answered: "can it act right now, and if not, what is the one thing to fix?" Acting depends on preconditions that live outside the process: a current model chain, provider credit, a funded wallet, a reachable RPC, a live data feed.

So we built [agent vitals](https://three.ws/docs/agent-vitals): preconditions as **vitals** with `needs` edges, actions as **capabilities** that AND over them, and attestation that returns the *root* blocker rather than a symptom.

```
deploy-fresh ──> cognition ──┐
                             ├──> [enter]
armed, solvency, feed, rpc ──┘

rpc ─────────────────────────────> [exit]
```

Each vital reads a real source. `armed` reads the owner's settings, `solvency` asks the executor's own sizing rule whether the wallet can fund one action, `rpc` calls `getSlot` on a Solana RPC, `feed` watches the live data stream, `deploy-fresh` reads the running image's create time, and `cognition` makes a real completion through the model chain. Two properties come straight out of the graph: `exit` depends on neither the feed nor a model, so an agent that can close a position is always reported as able to; and `deploy-fresh` feeds `cognition` only for agents that actually use a model, so every capability depends on exactly what it needs.

The engine is framework-agnostic with zero dependencies ([`packages/agent-vitals`](https://github.com/nirholas/three.ws/tree/main/packages/agent-vitals), on npm as [`@three-ws/agent-vitals`](https://www.npmjs.com/package/@three-ws/agent-vitals)), and there is an operator CLI (`npm run agent:vitals`) and an ops-gated HTTP endpoint on our side. If you operate a fleet of agents on AWS, it slots in beside your existing dashboards, whatever you build them with, and gives you a direct answer to "can it act?" for every agent the moment it depends on external credit, external models, and funded wallets.

Two siblings from the same line of thinking:

- [Brownout](https://three.ws/brownout): every response says where its data came from and how fresh it is, and every fallback in the registry has been executed for real, with the provider it protects against genuinely refusing, inside the same request path a user hits. The proof receipts are public on the page, and the client library is [`@three-ws/brownout`](https://www.npmjs.com/package/@three-ws/brownout).
- [`@three-ws/witness`](https://www.npmjs.com/package/@three-ws/witness): record what a user actually did and compile it into a Playwright spec that goes from red to green as the issue is fixed, so a report becomes a runnable experiment automatically.

---

## 8. The end of the chain is an object in a box

Here is the part that makes all of the above so rewarding to build.

[Materialize](https://three.ws/materialize) turns a generated 3D model into a real object: printed in resin, nylon, colour sandstone, or steel, and shipped to an address. It is a page for humans, and it is an API, which means an agent can order a physical object of a model it just generated, end to end.

The pipeline, and why each stage exists when the buyer might be a machine:

1. **Free, keyless analysis.** A printability report before any price: closed solid or not, how many separate bodies, where the holes are, thinnest wall, exact volume, and a 0 to 100 score with named deductions in plain language. Free on purpose: an agent that can check printability before paying to generate spends less overall, and a free check runs everywhere it is useful.
2. **Preparation.** `POST /api/print/prepare` reconstructs the mesh as a solid, fills holes, scales it to the chosen height, optionally hollows it with drain holes, and exports binary STL, 3MF, and the repaired GLB, with per-vertex colour sampled from the source texture for full-colour prints.
3. **A signed quote token**, valid 24 hours, carrying every priced parameter inside its signature, so the quoted price is the paid price. Every line is itemized: build setup, material with the exact volume it was computed from, finish, quantity break, shipping.
4. **Two checkouts, one pipeline.** A human pays in the browser in USDC on Solana; an agent pays over 402 at `POST /api/x402/print-order`. Same order record, same statuses, same fulfillment.
5. **Safety screening before production.** Weapons, functional key duplicates, and third-party brand marks are declined. A print bureau puts a person at that checkpoint; when the buyer is an agent, the checkpoint is code that is empowered to say no.
6. **Provenance in the box.** A certificate of authenticity, attested publicly on Solana, with a QR code, so the object shows which generation produced it. Creators can cap how many copies of a model will ever exist.
7. **Order tracking at every step**: `screening`, `submitted`, `printing`, `quality_check`, `shipped`, `delivered`, each appended to a timeline at `GET /api/print/orders/:id`, so the owner always knows exactly where the order is.

The live catalog (`GET /api/print/catalog`) offers standard and tough resin, SLS nylon (PA12), full-colour sandstone, a PLA draft option, and 316L stainless steel, each with its own minimum wall, height range, and lead time. The size range offered for a model comes from the mesh itself: the low end is where its thinnest wall reaches the material's minimum, the high end is where its widest axis fills the print bed. A **See it at true size** button places the object on your floor in AR at the exact height being ordered.

Printability is its own property of a model, separate from how it renders, which is why the report measures it directly. We publish a separate free grade for the neighbouring question of whether an asset is usable in a **physics engine** ([simulation readiness](https://three.ws/docs/sim-readiness), CC0 spec), for the same reason. **Generative pipelines produce artifacts whose fitness for a downstream physical process is best stated explicitly.** If your agent pipeline ends in manufacturing, robotics, or simulation, a mechanical claim about fitness, made once and checkable by anyone, is a wonderful thing to have.

The architectural principle I would take to any team building agent commerce: **irreversibility should be preceded by a free, honest dry run.** Quote is free, detailed, and refusable. Order is the only call that costs anything, and by the time it is made, every question has been asked and answered by a machine that could still change its mind.

---

## 9. The partners underneath the spine

Each stage of the spine leans on a partner programme, and it is a pleasure to credit them. Every designation here is stated exactly as it is.

- **Amazon Web Services.** three.ws is an **AWS Partner**. The Marketplace SaaS integration in section 2 is built, deployed, and conformant with Concurrent Agreements, and the Marketplace listing is coming. The AWS account `155407237916` (`us-east-1`) runs the metering IAM user, the EventBridge relay with its dead-letter queue, and the EULA. For enterprise buyers, that is the front door that brings three.ws into an existing AWS procurement relationship.
- **Google Cloud.** three.ws is a member of **Google Cloud for Web3 Startups**. Production runs on Google Cloud: one Cloud Run service serves the frontend, the route table, and every API handler in this article, the crons run on Cloud Scheduler, the GPU model workers run on their own Cloud Run services, and Vertex AI provides the Gemini and image lanes in our model chain.
- **Quicknode.** Accepted into the **Quicknode Startup Program** (July 2026) with approved infrastructure credits. Quicknode's distributed RPC endpoints are a rung in our Solana RPC failover chain, adding capacity and redundancy behind agent wallets, x402 settlement verification, and the `rpc` vital in section 7.
- **NVIDIA.** three.ws is a member of **NVIDIA Inception** (since July 2026), NVIDIA's programme for startups building on accelerated computing; it is a startup programme, not a partnership, an investment, or an endorsement. The models that Materialize prints come from generation lanes that all run on NVIDIA silicon: a self-hosted Cloud Run GPU fleet (L4 plus an RTX PRO 6000 Blackwell) behind text-to-3D, rigging, and motion, and a free hosted lane behind chat, vision, embeddings, safety, and speech.
- **IBM.** three.ws is an **IBM Business Partner**. Agents can think on IBM Granite models through watsonx.ai, and Granite Guardian runs as a governance gate in front of autonomous value actions, with every verdict written to a hash-chained ledger: a natural companion to the receipts in section 6. Our public Granite-backed endpoints are independent developer tools built on IBM's publicly available Granite models: not IBM products, not partnership deliverables, and not endorsed by IBM.
- **OpenAI.** three.ws is an **OpenAI Select Partner** in the OpenAI Partner Network, an independent member at the Select tier: not an OpenAI product, and not endorsed by OpenAI beyond the partner designation. Our free 3D Studio connector puts the generation lanes behind Materialize directly inside ChatGPT, keyless.
- **Alibaba Cloud.** three.ws is **live on the Alibaba Cloud International Marketplace**, with a product listing, a storefront, and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in our multi-model brain router.
- **HackerNoon.** Our **media partner**: three.ws announcements flow automatically from our RSS feed into HackerNoon's drafts queue, and pieces that publish there carry canonical URLs back to three.ws.

The public map of all eight is at [three.ws/partners](https://three.ws/partners), and partnership enquiries go to partners@three.ws.

---

## 10. What is open, and what you can lift from it

Everything in this article is Apache-2.0 and installable. As of a footprint audit on 2026-08-25:

| | |
|---|---|
| npm packages under `@three-ws` | 91 in this repo (101 across the wider scope at audit time) |
| MCP servers in the official registry | 72, under one namespace |
| GPU and service workers | 32, most as Docker images you can build and run |
| Specs (wire formats other code depends on) | 31, several CC0 |
| Public pages | 795 |

The pieces most worth lifting if you are building agent commerce on AWS, in the order I would reach for them:

1. `@three-ws/x402-server` (be a seller) and `@three-ws/x402-fetch` (be a buyer).
2. `@three-ws/x402-preflight` (confirm a seller can settle before paying).
3. `@three-ws/agent-guards` and `@three-ws/agentcore-payments-mcp` (budgets instead of credentials; the second drops straight into an Amazon Bedrock AgentCore agent).
4. `@three-ws/agent-vitals` (know whether your fleet can act).
5. `@three-ws/brownout` (publish proven fallbacks).
6. `@three-ws/witness` (turn user sessions into regression tests).

Each one stands on its own: none requires the rest of the platform, and none requires our hosting.

---

## 11. Design principles we carry forward

Four principles that shaped everything above, and that I would bring to any agent-commerce project.

**Model the counterparty, not just the call.** Spend policies constrain amounts, rates, and recipients, and the recipient allowlist is re-applied to every fresh quote, including a re-quoted challenge. Who gets paid is as much a part of the policy as how much.

**Decide what a ledger row means before you publish a number.** Our volume counts completed, settled rows only, identically in every aggregate, so every published figure is backed by a signature on file.

**Write the refusal before the interface.** For every capability that touches money or matter, the server-side rule comes first and the interface second. The server is the one place a guard holds for every client, including ones you did not write.

**Separate free and paid at the server boundary.** Our free generation server contains no payment code at all. Not disabled: absent. That is verifiable in a minute by a reviewer, a customer, or us.

---

## 12. Try it without an AWS account

Everything free below is keyless. Paste and run.

```bash
# grade a 3D asset for physics use
curl "https://three.ws/api/sim-readiness?src=https://three.ws/avatars/cesium-man.glb"

# printability report and an itemized quote for a real print
curl -s -X POST https://three.ws/api/print/quote \
  -H 'content-type: application/json' \
  -d '{"glbUrl":"https://three.ws/avatars/cesium-man.glb","materialId":"nylon-sls","targetHeightMm":120,"quantity":1,"country":"US"}'

# the live print material catalog
curl -s https://three.ws/api/print/catalog

# the free 3D generation MCP server, 14 tools, no auth
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# the public catalog of priced endpoints an agent can discover
curl -s https://three.ws/.well-known/x402.json | head -c 600

# the exact commit and revision production is running
curl -s https://three.ws/api/version
```

- **Source:** [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws) (Apache-2.0)
- **Docs:** [three.ws/docs](https://three.ws/docs), including [Materialize](https://three.ws/docs/materialize), [agent vitals](https://three.ws/docs/agent-vitals), [simulation readiness](https://three.ws/docs/sim-readiness), the [AWS Marketplace integration](https://three.ws/docs/aws-marketplace), and the [partner ecosystem](https://three.ws/docs/partners)
- **Previously from us here:** the AWS Marketplace SaaS metering walkthrough with the SDK for JavaScript v3, and the platform overview for AWS builders

Questions are welcome. The parts I would most love other builders to dig into are section 3 (policy instead of credential) and section 8 (the free dry run in front of the irreversible call), because both started as opinions and grew into the parts of the system everything else stands on.
