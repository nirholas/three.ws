---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Payments
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is plain lines. Cover art: 640x360 or that
  proportion, under 10 MB. The file path keeps its original slug for continuity; the
  postable title and body are framed around reliability, safety and verifiability.
accuracy_notes: |
  Discovery catalog figures (4,522 entries, 4,499 distinct resource URLs, 4,521 entries
  carrying a Solana mainnet USDC accept listed first, the one EVM-only demonstration
  route, and the $0.0005 to $12 Solana USDC price range) were read live from
  https://three.ws/.well-known/x402.json on 2026-10-08. The registered agent count
  (4,356) was read live from https://three.ws/api/three-token/stats on 2026-10-08.
  Settlement, verification and receipt totals (110,416 / 803,483 / 58,907) come from the
  open-source audit dated 2026-08-25 and are labelled with that date. The 12 second
  confirmation wait and 800 ms poll come from api/_lib/x402/self-facilitator.js
  (settleConfirmTimeoutMs, CONFIRM_POLL_MS). The $THREE second accept on the Solana rail
  is X402_ACCEPT_THREE_SOLANA, default true (api/_lib/env.js, api/_lib/x402-spec.js,
  docs/x402-endpoints.md). Preflight behaviour, TTLs, back-off hints, exit codes and the
  free MCP tool come from docs/x402-preflight.md and api/_mcp3d/tools/preflight.js.
  Settlement-pending behaviour, the two-minute reconcile, the 180 second write-off, the
  30 day prune and the /api/x402-status settlements block come from
  docs/x402-settlement-pending.md. The one-signature-one-payment gate, the roughly
  4.08 million fee and compute-limit slots and the hourly audit come from
  docs/x402-ring-economy.md. Customer admission ahead of internal pacing, intraday
  pacing, the retryable 503 for a governed throttle, the debit classifier and the
  surplus-only treasury split come from docs/x402-ring-economy.md. Buyer caps
  (reserve, commit, rollback) come from docs/x402-buyer.md. The agent-to-agent gates,
  kill switch, per-counterparty ceiling, receipts and the eight-way concurrency proof
  come from docs/a2a-payments.md. Sell-an-agent-as-an-API terms (2.5% default platform
  fee, $0.001 floor, 4,000 character message, 20 history turns, 32 KB) come from
  docs/x402.md. Direct payTo payouts come from docs/x402-endpoints.md. The free echo,
  debug and verify-receipt tools come from docs/x402-dev-tools.md. Partner designations
  are quoted exactly as docs/partners.md and docs/listings.md record them on
  2026-10-08: OpenAI Select Partner; IBM Business Partner (the IBM Granite x402 MCP is
  an independent developer tool on publicly available Granite models, not a partnership
  deliverable, and the article says so); AWS Partner with the Marketplace listing
  coming; member of Google Cloud for Web3 Startups; Alibaba Cloud International
  Marketplace listing live; NVIDIA Inception member; HackerNoon publishing partnership;
  accepted into the Quicknode Startup Program with approved free infrastructure credits.
  No partner is presented as an endorser. Mechanisms are described from the code paths
  those docs name (api/_lib/x402/pay.js, api/_lib/x402-paid-endpoint.js,
  api/_lib/x402-spec.js, api/_lib/x402/self-facilitator.js,
  api/_lib/x402/spent-payments.js, api/_lib/x402/offer-receipt-issuer.js,
  api/x402/my-receipts.js, api/_lib/x402/preflight.js). Historical incidents recorded
  in those docs are deliberately not narrated; only the resulting design is described.
  No paid endpoint was called and no payment was made while writing this. The live
  preflight attestation is not quoted because it changes minute to minute. No
  third-party facilitator, explorer, wallet vendor or aggregator is named.
---

# CoinMarketCap article: how three.ws makes agent payments on Solana reliable

Paste-ready for the CoinMarketCap form.

## Title (139 characters)

```
Built to Settle: How three.ws Makes AI Agent Payments on Solana Reliable, Safe and Verifiable, From the First Price Quote to Signed Receipt
```

## Meta description (189 characters)

```
A friendly tour of how three.ws lets AI agents pay on Solana with confidence: a signed preflight, careful retries, verify before settle, a clear pending state and receipts anyone can check.
```

## Body

---

Imagine you hire an assistant who runs errands for you around the clock. Some errands cost money: a weather report here, a research summary there, a 3D model for a project, a quick translation. You would want a few things from that assistant. You would want them to check that a shop is open before handing over cash. You would want them never to pay twice for the same thing. You would want them to pay only when they actually get what they asked for. And you would want a receipt every time.

That is exactly the bar three.ws holds itself to for AI agents that pay for things on the internet. Agents on three.ws have their own wallets, and they can buy services from other websites and from each other, in small amounts, automatically, at any hour. This article is a tour of how we make those payments reliable, safe and verifiable on Solana, written so a newcomer can follow the first half and a developer can go deep in the second.

A quick introduction for anyone new here. three.ws is an open-source platform for 3D AI agents: characters with a face, a voice, a personality, a wallet and a public page. Its coin is $THREE on Solana, contract FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump. The payments in this article settle in USDC, a digital dollar, and none of them require holding anything else. As of 2026-10-08 the platform reports 4,356 registered agents, readable by anyone at https://three.ws/api/three-token/stats.

## The idea in plain words

The web has always had a status code reserved for payment. It is number 402, "Payment Required", and for decades it sat unused because there was no simple way for a website to ask for a few cents and get paid instantly. A protocol called x402 finally puts it to work.

Here is the whole idea in four steps. A program asks a website for something. The website answers, in effect, "that costs one tenth of a cent, here is where to send it." The program sends the money in USDC. The program asks again with proof of payment attached, and the website hands over the result.

There is no account to create, no card to enter, no API key to request and no invoice to chase. That is why x402 suits AI agents so well. An agent can discover a service, pay for it and use it in a couple of seconds, without a human filling in forms.

three.ws runs this on Solana, our home chain, because Solana is fast and its network fees are tiny, which makes payments of a fraction of a cent practical. Our public catalog of paid services, read live on 2026-10-08, lists Solana prices from $0.0005 to $12 a call.

## Five promises a good payment system keeps

The four-step version above is the part everyone draws on a whiteboard. What makes a payment system something you can rely on is everything around it. We think about it as five promises, and the rest of this article shows how each one is kept.

You know before you pay. An agent can ask a seller, ahead of time, whether it is ready to complete a payment right now, and get a signed answer.

You never pay twice for one thing. Every payment is counted once, recorded once and honoured once, even when networks are busy and requests are retried.

You pay only for what you receive. The work is checked and completed before the money is collected, so a buyer is charged for a delivered result.

You always get a clear answer. A payment is either complete, closed, or clearly marked as still confirming, with the transaction signature attached so anyone can follow it.

You keep a receipt. Every settled payment can produce a signed receipt that a third party can check long after the conversation is over.

Each promise is a design decision in open-source code you can read at github.com/nirholas/three.ws. From here on we get more technical, one promise at a time.

## Who benefits

Three groups of people use this rail, and each gets something different.

Agent owners get autonomy with guard rails. They can let an agent spend on its own while setting daily ceilings, per-payment ceilings, per-recipient ceilings and a one-click freeze.

Builders and buyers get a predictable counterparty. A developer whose program pays three.ws, or pays anyone else who adopts the same open formats, can check readiness first, rely on a single bounded retry, and keep verifiable receipts.

Sellers, including creators and agents themselves, get paid directly. Many three.ws endpoints send the buyer's USDC straight to the wallet of the skill author, the asset creator or the agent being hired, so the platform never sits in the middle of their earnings.

## Reading a price quote precisely

When a program calls a three.ws paid endpoint without paying, it receives status 402 and a small JSON document. It contains the protocol version (2), the resource being sold, an accepts list of payment options, and optional extensions such as the input schema and a signed offer. The same document is mirrored, base64 encoded, in a PAYMENT-REQUIRED header for clients that only read headers.

A Solana entry in that accepts list reads, in plain words: scheme exact; network solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp, the standard identifier for Solana mainnet; amount as a string of USDC atomics with six decimals, so 1000 is a tenth of a cent; payTo, the receiving wallet; asset, the USDC mint; maxTimeoutSeconds of 60; and an extra object with the token name, its decimals and, when the seller covers network fees, a feePayer.

That feePayer field is a small kindness with a big effect. When it is present, three.ws sponsors the network fee: its fee wallet co-signs the transaction and pays the gas, so a buyer only needs USDC. When it is absent, the buyer pays its own fee, which is fractions of a cent on Solana.

On the Solana rail, three.ws also offers $THREE as a second accepted asset on the same quote, listed after USDC, and the browser checkout shows a token chooser whenever a resource quotes more than one asset. A buyer can pay in either.

Two construction choices keep quotes trustworthy. The resource URL in every quote is anchored on the platform's configured origin rather than on whatever host name a caller sent, so a quote always points where it should. And Solana is always listed first, because many clients pay the first option they understand. A test in the repo enforces that order for every handler.

A careful buyer reads every field: the asset is the one it budgeted for, payTo is the recipient it expects, and the amount fits its cap. The three.ws buyer code does all three on every quote, as you will see below.

## Preflight: ask before you sign

x402 tells you what something costs. three.ws adds a second, complementary question: can this seller complete the payment right now? The answer comes from an open format we call x402 Preflight.

Any seller can answer GET /.well-known/x402-preflight with a signed statement of whether it can settle, per network. three.ws publishes its own live attestation at that path, and the format, a reference server and a client package are all in the repo. The reference server and the format core are each under 300 lines.

The answer is designed around four properties.

payable is three-valued: true, false or "unknown". A seller that cannot determine its own state answers unknown, never true, and clients treat unknown as not payable for now. Because acting on true leads to a transfer, the format makes sure true is only ever said with confidence.

Every rate travels with its sample. A settlement rate is always reported with its attempt count, its time window and a confidence value derived from the sample size, so a buyer can tell a long track record from a short one.

Every not-payable answer carries a reason from a closed list (sponsor_below_floor, settlement_degraded, facilitator_unreachable, network_not_configured, rail_unavailable, unknown) and a back-off hint: 300 seconds when a fee wallet needs a top-up, 60 seconds when a rail is catching up. An alternates field names other networks on the same seller that are ready now, so an agent can re-route in a single round trip.

The envelope is ed25519-signed and short-lived: 60 seconds by default, 300 at most. Verification checks the signature, re-derives the digest from the report bytes, enforces expiry, rejects a future timestamp and pins the subject to the origin you asked about, all before any field is readable. A buyer who paid after reading true holds a statement signed by the seller's own key, which makes every claim attributable.

Because attestations verify offline against a public key, a registry or index can cache and relay them without becoming a trusted party. Discovery services can rank sellers by measured readiness rather than by self-description.

### Four ways to use it

From an agent, wrap your fetch with the npm package @three-ws/x402-preflight. Its guardedFetch reads the seller's attestation once, caches it for its own lifetime, verifies it offline, and either sends the request on a rail that is ready or stops before your agent signs anything. If you would rather have the verdict itself, assertPayable gives you the reason, the alternates and the retry delay.

From a terminal, run the same package with npx and an origin. The exit code is the answer, so it composes with scripts: 0 means payable, 1 means verified and not payable right now, 2 means unverifiable.

From a conversation, ask any agent connected to the three.ws MCP server. The x402_preflight tool is free, read-only and needs no wallet or account, and it can check any origin, not just ours.

From a browser, open three.ws/preflight, paste an origin, and the signature is verified in your own browser, so you can watch the check happen with developer tools open.

The format is open and unencumbered. A seller adopting it generates an ed25519 keypair, answers the well-known path with a signed envelope built from whatever settlement health it already measures, and keeps the lifetime short. A seller that measures nothing yet can still answer unknown, which is honest and useful.

### Keeping the rail open while the fee wallet refills

Sponsoring fees means three.ws keeps a SOL balance in a fee wallet, with a reserve floor beneath it. When that wallet is between top-ups, the quote keeps the Solana USDC option and simply leaves out feePayer. That switches the payment to self-pay mode: the buyer covers its own tiny network fee, and the endpoint keeps serving without interruption. Sponsored mode comes back on its own as soon as the wallet is topped up.

A sponsored payment that arrives during a top-up gets a retryable 503 settlement_unavailable, which every well-behaved client understands as "try again shortly". The preflight attestation reports the same state with its 300 second hint, so a buyer that checks first never needs to try at all.

## Re-quotes: one careful retry, fully re-checked

Sometimes a price changes between the moment a buyer reads a quote and the moment it pays. In x402, that shows up as a second 402 when the buyer replays with its payment attached. In that case the signed transfer is never broadcast, because the facilitator only settles after verification passes, so no money moved and one retry against the fresh quote is safe.

The three.ws autonomous buyer, payX402 in api/_lib/x402/pay.js, handles this with one retry, and every guard judges the new quote from scratch rather than trusting the old one.

The asset must be the configured USDC mint, or the payment is declined as unexpected_asset.

An optional recipient hook sees payTo, asset and amount before anything is signed. Platform ring agents use it to require that every counterparty is a platform-controlled wallet, and a hook that throws counts as a decline.

The amount must fit the remaining spend cap, or the payment is declined as cap_would_exceed with a clear message naming the endpoint, price and cap.

The worst-case network fee must sit under a per-transaction ceiling, 10,000 lamports by default.

The fee wallet's daily budget must have room, so any payment that could not complete is declined at the very start of the handshake, before any signature is spent.

The retry also draws a fresh nonce and a fresh blockhash, so the new transaction is distinct from the earlier attempt in every byte. After that single retry the buyer stops and reports the outcome, flagged retriedAfter402, so the re-quote is visible in the record.

One bounded, fully re-checked retry gives a buyer flexibility when prices move and complete predictability about how much it can ever spend.

## Spend controls that hold under pressure

A cap is only as good as its behaviour when many payments happen at once. three.ws builds every cap so it holds under concurrency.

### Caps for any buyer

The three.ws buyer client, buyerFetch, accepts a caps envelope with a wallet address and three ceilings in USDC atomics: per call, per hour and per day. Each call is counted before it fires, using a reserve, commit and rollback sequence, so a call that does not complete is rolled back and concurrent calls share one honest total. If a call would exceed any window, the client returns without paying. The same wrapper exists for axios.

### Agents paying agents

When one three.ws agent pays another, the payment starts from an Intent Mandate: a signed credential recording that the owner allowed a named agent to spend up to a total budget, with a per-call cap, on named networks, for up to 90 days. Every autonomous payment then passes seven gates in order, and nothing downstream happens until each one says yes: mandate signature and ownership, the subject agent, the freeze switch, the mandate's per-call policy, an optional peer reputation bar, the mandate's lifetime budget, and the agent's own spend policy.

That last gate is atomic. It enforces the ceilings and writes the payment's pending receipt row in one statement under a per-agent lock. A proof script runs this against a real Postgres database and asserts that eight concurrent reservations for the final dollar of headroom produce exactly one winner.

The owner sets the policy at any time: a per-transaction ceiling, a rolling daily ceiling, a per-counterparty daily ceiling, a withdraw allowlist and an option to require scoped capabilities. The per-counterparty ceiling exists so that a day's budget is spread the way the owner intends, never concentrated on a single payee. Every mainnet rail folds into one shared mainnet budget, so the daily ceiling means exactly what it says across chains.

### The freeze button

Setting frozen to true halts every autonomous category in one call: agent-to-agent payments, x402 payments, trades, snipes, scheduled orders, armed intents and autopilot rules. A frozen agent is declined at the third gate, before a peer is even contacted. The owner's own withdraw stays open, so a freeze always keeps the owner in full control of the balance. An anomaly guard can set the same flag automatically when an outbound movement looks far outside the wallet's learned pattern.

### Receipts for every agent payment

Every agent-initiated payment writes one row to the agent's custody ledger: pending at reservation, confirmed with the settlement signature once the peer's task completes, released if it does not settle. The owner reads them back from an owner-only endpoint, with the counterparty, the explorer link, the amount, the mandate and the peer's own receipts. The response to an agent-to-agent call also carries a portable signed cart mandate that anyone can verify through a public endpoint.

## Verify, deliver, then settle

On the seller side, the order of operations is the safety property, and three.ws follows it every time.

First, a durable replay guard checks that this proof of payment has not been honoured before. Second, the facilitator's /verify runs. Third, only if verification passes does the handler do the work. Fourth, only after the handler succeeds does settlement happen. Fifth, only after settlement does the response leave the server.

### Two layers of verification

The first layer is a strict static decode of the buyer's transaction, because in sponsored mode three.ws co-signs it. The transaction must contain exactly a compute-budget instruction, an optional token-account creation for an allowlisted recipient, and one USDC TransferChecked to an allowlisted payTo. There are no System instructions, so no SOL can move under the platform's signature. Address lookup tables are not accepted. Priority fee and compute limit are capped. The token program is derived from the mint itself. Each rule has its own precise code, such as system_instruction_forbidden, pay_to_not_allowlisted, transfer_wrong_mint or multiple_transfers, which makes every decision easy to diagnose.

The second layer confirms the payment can settle without broadcasting it: a simulation against current chain state, which checks the buyer's token balance, the token account's status and the fee payer's funding in a single round trip. If simulation is unavailable, the facilitator reads the buyer's token balance directly, and if neither check can run it declines with settle_precheck_unavailable rather than guessing. A sponsored settle must also be at least 1,000 atomics, so the sponsor's fees always go to meaningful payments.

### You pay for what you receive

By default, three.ws paid endpoints run deliver-then-settle. The handler produces its result, the wrapper settles the payment, and only then is the body sent. If the handler cannot complete, nothing is settled. An agent sold as an API whose model providers are all busy answers 503 llm_unavailable and charges nothing. The wrapper also enforces the order: a handler that tries to send its body before settlement is stopped. Routes that genuinely need to stream declare it and settle first.

The replay guard is a Postgres row per honoured proof, so a captured payment header can be used exactly once, across every server replica and for as long as the record exists. When a payment has settled but delivery could not finish downstream, the buyer is protected in the other direction too: the payment is recorded as failed_after_settle and the work may be re-run a bounded number of times with no second charge.

## Settlement pending: a clear third answer

A Solana transaction is broadcast and then confirmed, usually seconds apart. During that window the outcome is honestly still being decided. Since 2026-09-17 the three.ws facilitator gives a precise third answer for that moment, settlement_pending, together with the broadcast signature. It means: broadcast, outcome in progress, ask again.

The chain's verdict maps four ways. Landed with no error is success. Landed with an on-chain error is a final outcome. Dropped, with an expired blockhash and no trace, is a final outcome recorded as abandoned. Only a wait that ran out, or an RPC that could not answer, is pending. Keeping pending this narrow is what makes it trustworthy: it always means "in progress" and never stands in for a decision the chain has already made.

The facilitator waits up to 12 seconds, polling every 800 milliseconds, which clears the large majority of confirmations inline. Anything slower goes pending and finishes in the background, so a buyer's connection is never held open longer than a client library will comfortably wait. Operators can tune the window without a deploy.

### One authorization, one transaction

A pending answer is a promise, so the facilitator records the broadcast signature before answering, keyed by a hash of the signed transaction. A retry with the same payload skips co-signing and broadcast entirely and simply waits on that signature again. One authorization produces one transaction, always. The record lives in Postgres rather than process memory, because the API runs several replicas, and a shared store means every retry finds its record wherever it lands. If the record cannot be written, the answer becomes a clear final response that still carries the signature, so it can be reconciled.

### Delivered, and accounted for

The resource server retries a pending settle once with the identical body and idempotency key. If the outcome is still in progress, it delivers the result with status pending and the signature in the X-PAYMENT-RESPONSE header. The buyer's body is real and complete, and the signature is there to watch on any Solana explorer. The authorization is single-use, so the buyer never needs to pay again.

Pending payments are recorded with settlement_status pending, and revenue queries count only completed ones. A read-only reconciliation job runs every two minutes. A confirmed signature gets its credit claimed exactly once and enters the revenue figures. A closed one is marked as such, with an operator alert naming the signature, resource and payer whenever a result had already been delivered. A signature the chain has not yet seen is given 180 seconds, the lifetime of its blockhash, before it is written off. Resolved rows are pruned after 30 days, and an unresolved one is kept until it is accounted for.

Anyone can see the live picture at GET /api/x402-status, which reports pending, confirmed, failed and abandoned counts for the last 24 hours. Current x402 client libraries retry a pending settle automatically. A developer speaking the protocol by hand follows two rules: retry with the identical payload and key, and treat a response with status pending as delivered.

## One signature, one payment

Ed25519 signatures are deterministic, which is a strength for verification and a design consideration for payments: two payments with identical inputs built against one blockhash would produce the same transaction. three.ws guarantees one credit per signature with three layers.

A credit is claimed per signature, and only the first claim wins. Any other is declined as signature_already_settled.

A partial unique index on the signature column makes concurrent claims safe at the database level, so the guarantee holds no matter how many replicas are serving.

The payment builder makes every transaction distinct by drawing fee and compute-limit variation from roughly 4.08 million slots with a cryptographic random source. The compute-limit dimension costs nothing, because unused compute units are not billed.

When the database cannot confirm a claim, the settle is declined as retryable rather than credited, so the books only ever record payments that are confirmed unique. An hourly read-only audit confirms that every signature has been credited exactly once, and reports the gate's own declines so the team can see it working.

## A facilitator three.ws runs itself

On Solana, three.ws runs its own facilitator, open source in the repo, implementing the standard /verify and /settle contract. It validates the buyer-signed transfer, co-signs when sponsoring, broadcasts over the platform's own RPC lanes and logs the exact fee the chain charged. At the open-source audit dated 2026-08-25 it had processed 110,416 on-chain USDC settlements and 803,483 verifications. Because the rail is self-hosted, Solana payments need no third-party unlock to keep running.

Running it ourselves lets us tune it carefully.

The SOL floor is a reserve that must survive each settle. The estimated fee for the payment, including roughly 0.00204 SOL of rent when a recipient is receiving the mint for the first time, is subtracted first, so the reserve stays intact after every transaction.

The floor guard has two independent witnesses: the balance read and the chain's own simulation result. Either one can trip the guard, so it stays accurate even when an RPC lane is busy.

The verify gate names exactly whose fee needs funding: sponsor_fee_unfunded when it is the platform's sponsor, payer_fee_unfunded when it is the buyer's. Operators and buyers each know at a glance what, if anything, they need to do.

A read-only scanner reviews every debit from the platform's payment wallets every ten minutes and classifies it as internal, network fee, or for review. Ambiguous movements are always flagged for a human to look at, and every flag reaches the operations board with its signature, counterparty and amount.

## Discovery as a plain document

three.ws publishes everything it sells as one public JSON document at three.ws/.well-known/x402.json, following the open discovery schema. It is cacheable, diffable and readable by anything that can make a GET request, so finding a service is as simple and dependable as reading a file.

Read live on 2026-10-08, it lists 4,522 entries covering 4,499 distinct resource URLs, the difference being priced MCP tools that each get their own row. 4,521 entries carry a Solana mainnet USDC accept, listed first; the remaining entry is an EVM-only demonstration route. Every entry ships a complete input schema, so an agent can call a service from the catalog alone.

The catalog follows one simple rule: it advertises exactly the rails the live 402 serves. A buyer that trusts the catalog gets the same options it will see at the moment of payment. A verification script in the repo checks the live challenges against the discovery document to keep the two in parity. The same catalog is browsable by people at three.ws/x402.

## Offers and receipts: proof that lasts

An entitlement answers whether a caller may do something. A receipt answers whether an exchange happened, and lets a third party check. Between agents and strangers, receipts are what make commerce accountable.

three.ws implements the x402 Offer and Receipt extension. Offers are signed per accepted option with a 60-second validity, so the price an agent was shown is attributable to the seller. After settlement a signed receipt rides in the payment response. The receipt signing key is always separate from every receiving wallet, a rule the issuer checks, so payment keys and commitment keys each do one job.

Receipts are stored and can be fetched long after the response header is gone. A buyer calls /api/x402/my-receipts with a wallet signature, ed25519 for Solana, timestamped and valid for five minutes. The transaction hash is kept out of the receipt payload for privacy and returned only to the wallet that paid. Receipt signing runs alongside settlement and never stands between a buyer and a completed payment. At the 2026-08-25 audit the vault held 58,907 signed Offer and Receipt artifacts.

## Free tools for developers

Anyone building an x402 integration can test against three.ws for free, with no key, at 30 requests a minute per IP.

The echo tool, POST /api/x402/echo, shows exactly what a request looks like from the server's side. If a payment header is present, it is decoded and returned with every signature redacted to a short prefix, along with the same local verification verdict a real paid endpoint runs, without settling or charging anything. That makes it safe to paste into a support thread.

The debug tool, POST /api/x402/debug, takes any part of an exchange (the challenge, the payment, the response) and returns structured findings, each with a severity, the field, the problem and the fix. It catches common slips such as an old protocol version, a shorthand network name instead of the standard identifier, signing for a network the challenge did not offer, decimal amounts where integer atomics are required, and underpayment.

The verify-receipt tool, POST /api/x402/verify-receipt, recomputes an attestation digest to confirm a paid result was not altered, and confirms a settlement transaction on chain. The settlement check also works over a plain GET, so it fits in a browser address bar or an uptime probe. An unreachable RPC is reported as rpc_unavailable, never as a guessed confirmation.

## Where the money goes

Many three.ws endpoints name the real earner as payTo, so the buyer's USDC settles directly into that wallet. A paid skill call pays the skill's author. A 3D asset or animation download pays its creator. A paid service pays its provider. A hired agent is paid in its own payout wallet.

Any public agent with a brain and a Solana payout address can be sold as an API from the Earn tab of its wallet page at three.ws/agent-wallet. The owner sets a price per call in USD, with a floor of $0.001, and a one-line description. The agent gets a stable endpoint on the standard x402 v2 stack, appears in a free public list and in the discovery catalog, and answers before the payment settles, so a buyer is only charged for a reply it received. Requests can carry a message of up to 4,000 characters and up to 20 turns of history, within 32 KB. Every settled call is recorded net of the platform fee, 2.5% by default, and the Earn tab shows calls, all-time and seven-day earnings, and recent payers.

## Honest numbers by construction

three.ws runs a closed-loop payment ring: platform wallets pay the platform's own endpoints in real USDC, settled by the platform's facilitator, to prove continuously that every endpoint settles. It costs only network fees, because the principal recirculates, and it keeps every rail exercised around the clock.

To keep reporting accurate, every settled payment is classified mechanically by payer: internal (a wallet the platform controls), synthetic (not a plausible address at all, such as a test placeholder) or external (a real address the platform does not control). Only external payments count as revenue, and the ring's own settlement endpoint is never listed in the catalog. If the registry of controlled wallets is ever unavailable, the split reports itself as not confident, the readout script exits with an error, and an unavailable figure is shown as null rather than as a number.

The same care protects customers. Platform fee wallets have a daily fee budget that paces internal traffic, and an outside buyer is always admitted ahead of that pacing. Their fee is still recorded against the day, so internal traffic yields to customers.

## Running the rail calmly

A few operating tools keep the rail smooth and easy to read.

Intraday pacing releases each fee wallet's daily budget gradually across the UTC day, so the rail has steady capacity from morning to night. It grants no extra spend; it spreads the same total evenly.

A governed throttle is answered with a retryable 503, so buyers and monitors read it as the platform pacing itself on purpose.

Callers check admission before they pay, using the same math as the settle path, so a paced moment costs a skipped call instead of a full handshake.

The Runway Lab at three.ws/economy-lab runs the production admission-control code against live balances, so an operator can see at a glance whether a wallet needs SOL or is simply being paced.

An audit script reconciles agent wallets against the funding ledger, so capital held across many per-agent wallets is always accounted for and correctly described.

RPC lanes are health-checked with a metered call, so the checks reflect real capacity.

The ring's treasury routes a share of each sweep to the wallet that funds the wider economy, and that share is paid only from genuine surplus, so working capital stays in circulation.

## Our partners

three.ws is proud to take part in eight programmes with some of the most respected names in cloud, AI, hardware, infrastructure and media. Each is listed here exactly as our partners page describes it, and three.ws remains an independent company throughout. Several connect directly to the payment rail in this article.

Google Cloud. three.ws is a member of Google Cloud for Web3 Startups, and production runs on Google Cloud. One Cloud Run service serves the frontend, the route table and every API handler, including the paid endpoints, the facilitator, the preflight attestation and the receipts endpoint, while the scheduled jobs, such as the two-minute settlement reconciliation, run on Cloud Scheduler. Vertex AI provides the Gemini and image lanes.

Quicknode. three.ws is accepted into the Quicknode Startup Program with approved free infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind agent wallets, x402 settlement verification and live Solana market data. Server-side Solana calls run through a failover chain of providers, and Quicknode is a rung in that chain.

Amazon Web Services. three.ws is an AWS Partner. The AWS Marketplace SaaS integration is built and deployed: fulfillment, a signature-verified lifecycle webhook, account linking, and daily metering and entitlement checks. Subscribing links an AWS account to a three.ws account and issues an x402 access key, with usage paid per call over x402. The Marketplace listing is coming, and x402 works directly in the meantime with no AWS account needed.

IBM. three.ws is an IBM Business Partner. Separately, the platform publishes an independent developer tool, the IBM Granite x402 MCP server (@three-ws/ibm-x402-mcp), built on IBM's publicly available Granite models: an MCP client reaches Granite inference and settles per call in stablecoin from a wallet it already controls, with no IBM Cloud account of its own. It is a three.ws tool, separate from the formal partnership work, which is being built on the IBM platform.

OpenAI. three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free three.ws 3D Studio connector gives ChatGPT keyless 3D tools with no account, payment or key. Its paid sibling, the 3D Studio MCP server, adds rigging, animation, retexturing and analysis, and can be paid per call over x402 or used with OAuth.

NVIDIA. three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. Every 3D generation lane runs on NVIDIA silicon, including text to 3D, photo to avatar, auto-rigging and motion capture, and many of those generations are sold as paid endpoints on this rail.

Alibaba Cloud. three.ws is live on the Alibaba Cloud International Marketplace, with a product listing, a storefront and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in the platform's multi-model brain router.

HackerNoon. three.ws has a builder-focused publishing partnership with HackerNoon. Every three.ws announcement flows automatically from the platform's RSS feed into HackerNoon's drafts queue and, after editorial review, publishes with a canonical link back to three.ws.

You can see all eight on three.ws/partners, and partnership enquiries go to partners@three.ws.

## Why this is the part worth building

The x402 handshake is elegant, and it is only the beginning. What turns machine payments into dependable infrastructure is everything around it: a signed preflight so buyers know before they pay, a single bounded and re-checked retry, a verify that simulates before anyone is charged, delivery before collection, a clear pending state that always tells the truth, one credit per signature, receipts a stranger can check, and books that count real demand precisely. Each of those is a promise kept in open code.

Everything described here is open source at github.com/nirholas/three.ws. To check whether a seller is ready before you sign, use three.ws/preflight. To browse what agents can buy, open three.ws/x402. To watch the rail's admission control against live balances, open three.ws/economy-lab. To sell your own agent's skills, start from the Earn tab at three.ws/agent-wallet. To meet the companies we work with, visit three.ws/partners.

A note on other chains: the same endpoints also accept USDC on Base wherever a facilitator can settle it, always listed after Solana. Solana is the home rail and the one described here.

Nothing here is financial advice.
