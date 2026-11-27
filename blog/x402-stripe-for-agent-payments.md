# The Stripe of x402: How three.ws Turned Agent Payments Into One Line of Code

There is a status code that has been sitting in the HTTP specification, unused, for almost three decades. It is called **402 Payment Required**. When Tim Berners-Lee and the early web architects wrote the protocol, they left it reserved "for future use." The future never quite arrived. The web grew up on advertising, subscriptions, and credit card forms, and 402 stayed dormant, a placeholder waiting for a payment rail that the internet never standardized.

That is changing now, and it is changing because of agents.

This is the story of x402, why it is becoming the default money layer for the agent economy, and how three.ws built the piece that makes it usable by anyone: a drop in payment modal that does for x402 what Stripe Checkout did for credit cards. One line of code. No backend gymnastics. No wallet plumbing. The agent pays, the endpoint settles, and the result comes back.

## The backstory: a payment code the web forgot

HTTP 402 was specified as part of HTTP/1.1 and carried forward into every revision since. The text is almost poetic in its restraint: "This code is reserved for future use." For years it was a piece of internet trivia, the answer to a quiz question, a thing developers discovered once and filed away.

The reason it never shipped is simple. Money on the web has always needed a trusted third party. A card network. A processor. A bank. You cannot embed "pay me" into a raw HTTP response and expect the client to settle it, because the client has no native way to move value. So the web routed around 402. Payments became forms, redirects, hosted checkouts, and SDKs, all bolted on top of a protocol that had a payment code it was never allowed to use.

Then two things happened at once. Stablecoins gave the internet a unit of account that settles in seconds for fractions of a cent. And AI agents gave the internet a client that needs to pay for things without a human reaching for a wallet. An agent calling an API, buying a dataset, renting compute, or hiring another agent cannot fill out a checkout form. It needs to pay the way it does everything else: programmatically, over HTTP, in the same request.

x402 is the protocol that finally wires money into that dormant status code. It was revived and championed by Coinbase in 2025 as an open standard, and the shape of it is exactly what you would hope for. A client requests a resource. The server, if payment is required, responds with **402** and a machine readable description of what it costs and how to pay. The client signs a payment, retries the request with the proof attached, and the server returns the result. No redirect. No session. No human. Just HTTP, plus a header.

## Why x402 is the next big thing, not just a clever trick

The case for x402 is not aesthetic. It is structural. The agent economy needs a payment primitive, and every other option is a bad fit.

Credit cards assume a human, a billing address, and chargebacks. Subscriptions assume a relationship that predates the transaction. API keys assume an account, a signup, and a billing department. None of these survive contact with an agent that wants to call a service it discovered thirty seconds ago, use it once, and never return. The unit of agent commerce is the single call, priced in fractions of a dollar, settled instantly, with no account to create.

That is precisely the shape x402 fits. And the market is already voting. The Coinbase x402 Bazaar, the discovery surface where agents find paid services, reports on the order of 480,000 active agents, 100,000 services, and roughly 50 million dollars in volume. three.ws is a verified service provider on that Bazaar and listed on agentic.market alongside it. This is not a thought experiment. Agents are paying each other, today, in numbers that grow weekly.

The thesis is straightforward. If agents are going to transact, they need a payment standard that is open, instant, cheap, and HTTP native. x402 is the only candidate that is all four. The same way HTTPS became the assumed transport and JSON became the assumed format, x402 is becoming the assumed payment layer. The question stops being "will agents pay over x402" and becomes "how easy is it to accept and send x402 payments." That is a tooling problem. And tooling problems are won by whoever makes the hard thing feel trivial.

That is the gap three.ws set out to close.

## The hard part nobody talks about

Read the x402 specification and the flow looks clean. In practice, shipping a real payment experience on top of it is a pile of edge cases that most teams underestimate.

You have to detect the 402 and parse the accepts array. You have to connect a wallet, and there is more than one kind: Phantom and other Solana wallets sign transactions one way, while EVM wallets on Base sign EIP-3009 authorizations a completely different way. For Solana you need to build an unsigned transaction server side, have the wallet sign it, then encode the signed transaction into the payment envelope. For EVM you sign a typed message in the browser with no server round trip at all. You have to attach the payment to the retry as a base64 header, handle the settlement response, deal with throttling and idempotency so a network retry does not double charge, and present all of it as a coherent interface that a normal person, or a normal agent, can actually use.

Then you have the things that separate a demo from a product: spending caps so an agent cannot drain a wallet, sign in re entry so a wallet that already paid can skip the flow, theming so the modal matches the host site, and attribution so builders get credit for the volume they route. Every one of these is a small project. Together they are the reason most teams who want to accept agent payments simply do not.

Stripe's insight, years ago, was that the payment itself is not the product. The product is making the payment disappear into a single, beautiful, reliable drop in. We took the same view of x402.

## What we shipped: @three-ws/x402-payment-modal

`@three-ws/x402-payment-modal` is an open source npm package, Apache 2.0 licensed, currently at version 1.2.0. It is a single ES module with **zero runtime dependencies**. It handles wallet connect for both Phantom and Solana and EVM wallets, the full 402 to sign to settle flow, sign in re entry, client side spending caps, and a receipt at the end. It works as a plain script tag, as an ES import, and as a React component, and it ships server helpers for Express, Vercel, and any framework.

Here is the entire integration in its simplest form. Drop a script tag, add data attributes to a button, and listen for the result:

```html
<script type="module" src="https://unpkg.com/@three-ws/x402-payment-modal"></script>

<button
  data-x402-endpoint="/api/paid/summarize"
  data-x402-method="POST"
  data-x402-body='{"text":"hello"}'
  data-x402-merchant="Acme"
  data-x402-action="Summarize">
  Pay and Run
</button>

<script>
  document.querySelector('button').addEventListener('x402:result', (e) => {
    console.log('paid and got result:', e.detail.result);
  });
</script>
```

That is a fully working paid endpoint with wallet connect, payment, settlement, and a receipt. No build step. No bundler. No framework. The button finds the endpoint, gets the 402, opens the modal, walks the user through paying, retries with the payment attached, and fires an event with the result. There is nothing else to write.

If you prefer to drive it from code, the programmatic API is one function:

```javascript
import { pay } from '@three-ws/x402-payment-modal';

const { result, payment } = await pay({
  endpoint: '/api/paid/summarize',
  method: 'POST',
  body: { text: 'bonjour', to: 'en' },
  merchant: 'Acme Translate',
  action: 'Translate',
});

console.log(result, 'settled in tx:', payment?.transaction);
```

React developers get a hook and a button component:

```javascript
import { useX402, X402Button } from '@three-ws/x402-payment-modal/react';

function Demo() {
  const { pay, status, result, isPaying } = useX402();
  return (
    <X402Button
      endpoint="/api/paid/summarize"
      body={{ text: 'hello' }}
      merchant="Acme"
      action="Summarize"
      onResult={(r) => console.log(r)}
    />
  );
}
```

This is the Stripe Checkout moment for x402. The protocol is powerful but unforgiving. The package makes it a one liner.

## Under the hood: the 402 to sign to settle flow

The modal implements the full x402 version 2 lifecycle. It is worth walking through, because the simplicity above is earned by a lot of correct handling underneath.

The flow begins with a normal request to the endpoint. If payment is required, the server answers with HTTP 402 and a JSON body describing what it accepts:

```json
{
  "x402Version": 2,
  "error": "X-PAYMENT header is required",
  "resource": { "url": "/api/paid/summarize", "description": "Summarize text", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "amount": "10000",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "RECIPIENT_ADDRESS",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "decimals": 6, "feePayer": "SPONSOR_ADDRESS" }
    }
  ]
}
```

The modal parses the accepts array and shows the price and the network. The amount is in atomic units, so 10000 with 6 decimals is one cent of USDC. The user picks a wallet, and from here the path forks by chain.

On Solana, the modal posts the chosen accept entry to a checkout endpoint, which builds an unsigned version 0 transaction. Phantom signs it. The signed transaction is sent back to be encoded into the payment envelope. The checkout endpoint ships inside the package, so the server side is a single mounted route.

On EVM, the path is even shorter. The modal asks the wallet to sign an EIP-3009 `transferWithAuthorization` message. This is a typed signature, not an on chain transaction, and it happens entirely in the browser with no server round trip. The signature authorizes a USDC transfer that the facilitator will settle.

Either way, the modal retries the original request with the proof attached as a base64 encoded `X-PAYMENT` header, plus an idempotency key so a network retry can never double charge:

```
POST /api/paid/summarize HTTP/1.1
X-PAYMENT: <base64 payment payload>
Idempotency-Key: <uuid>
```

The server verifies and settles the payment through an x402 facilitator, does the work, and returns 200 with an `X-PAYMENT-RESPONSE` header carrying the settlement proof, which includes the on chain transaction signature and the payer address. The modal shows a receipt and fires the result event. If the server throttles with a 429, the modal automatically retries once.

The networks supported out of the box include Solana mainnet and devnet, Base mainnet and Base Sepolia, Arbitrum, and Optimism. Settlement assets include USDC on every supported chain, and on Solana the modal can also settle in $THREE. Facilitator support covers Coinbase CDP for the EVM chains and PayAI for Solana and EVM. The developer writes none of this. They write the button.

## The details that make it production grade

A payment modal that only handles the happy path is a demo. The pieces below are why this one runs in production.

**Spending caps.** Every payment can be bounded by per call, per hour, and per day limits, enforced client side and expressed in atomic micro USD. An agent operating autonomously cannot exceed what its owner set, no matter how many endpoints it discovers.

```javascript
await pay({
  endpoint: '/api/paid/expensive',
  caps: { maxPerCall: 50000, maxPerHour: 500000, maxPerDay: 2000000 },
});
```

**Sign in re entry.** Using the CAIP-122 sign in standard, a wallet that has already paid can re enter a paid context by signing a message instead of paying again. This turns x402 into a session aware experience without inventing a session protocol.

**Builder codes.** Following the ERC-8021 attribution standard, every payment can carry a builder code that credits the developer who routed the volume. Attribution is built into the envelope, not bolted on after.

**Theming.** The modal exposes more than forty CSS custom properties and an automatic light and dark mode that follows the operating system. You can match it to your brand with a few token overrides:

```javascript
import { configure } from '@three-ws/x402-payment-modal';

configure({
  brand: { name: 'Acme', url: 'https://acme.com' },
  theme: 'auto',
  cssVars: { '--x402-accent': '#ff5c00' },
});
```

**Idempotency and single shot semantics.** Payment intents are consumed once. A failed call does not silently refund, and a retried call does not double charge. The boundaries are handled so the developer's code can trust itself.

## Monetizing an endpoint is just as easy

Accepting payments is the mirror image of sending them, and the package makes the server side just as small. To turn any Express route into a paid x402 endpoint, you respond with a 402 challenge when there is no payment header, and mount the checkout router that ships in the box:

```javascript
import express from 'express';
import { x402CheckoutRouter } from '@three-ws/x402-payment-modal/server/express';
import { solanaAccept } from '@three-ws/x402-payment-modal/server';

const app = express();
app.use(express.json());

app.post('/api/paid/summarize', (req, res) => {
  if (!req.get('X-PAYMENT')) {
    return res.status(402).json({
      x402Version: 2,
      error: 'X-PAYMENT header is required',
      resource: { url: req.url, description: 'Summarize text', mimeType: 'application/json' },
      accepts: [
        solanaAccept({ token: 'usdc', uiAmount: 0.01, payTo: process.env.PAYOUT_ADDRESS, feePayer: process.env.FEE_PAYER }),
      ],
    });
  }
  // verify and settle the X-PAYMENT, then do the work
  res.json({ summary: `Summary of: ${req.body?.text}` });
});

app.use('/api/x402-checkout', x402CheckoutRouter({ rpcUrl: process.env.SOLANA_RPC_URL }));
app.listen(3000);
```

The `solanaAccept` helper takes human amounts and well known token names and produces a correct accept entry, converting to atomic units for you. There are matching handlers for Vercel and Next.js. The same package powers both sides of every transaction, which is exactly why the experience stays consistent whether you are paying or being paid.

## Beyond the modal: this is one piece of a full agent economy

The payment modal is the front door, but the reason three.ws built it is that it sits on top of a complete agent stack. A payment standard is only useful if the things doing the paying are real. On three.ws, they are.

### Agent wallets that actually hold and move money

Every agent on three.ws gets its own wallets, a Solana keypair and an EVM wallet, generated at creation and encrypted at rest with AES-256-GCM using a per record salt. These are not display addresses. Agents can send and receive SOL, USDC, and $THREE, pay for services over x402, and trade on Solana through Jupiter. Every outbound action passes through a spend policy that enforces per transaction, daily, and lifetime USD limits, so autonomy never means unbounded risk. An agent that pays an x402 endpoint is spending from a wallet it controls, inside guardrails its owner set.

### Wallet intents: programmable money in plain language

This is where it gets interesting. A wallet intent is an owner owned policy that makes an agent's wallet react to real events. The owner describes the rule in plain language. A language model compiles it into a strict, server validated structured intent. A cron engine executes it through the same spend policy gated, audited signing paths every manual transfer uses. An intent can never exceed the agent's spend policy.

The triggers cover the events an agent's money should react to: a tip arriving, any income arriving, a balance dropping below a floor, a daily or weekly schedule, a token launch matching criteria, or a money stream starting. The actions cover what it can do in response: tip, transfer, buy, snipe, withdraw, split income, freeze as a kill switch, or simply notify the owner.

So an owner can say "tip back half of whatever someone sends me," or "every Friday withdraw profit above 2 SOL to my main wallet," and the agent does it, forever, with real receipts written to an audit log. Each intent can carry its own caps for per action, daily, and total spend, always clamped under the master spend policy. This is what turns a wallet from a balance into a participant.

### Sniping: intents that react to launches

One of those triggers, launch matching, powers automated sniping. An owner arms an intent that watches the live pump.fun launch feed for new tokens matching a creator address and a market cap ceiling, then buys a set amount through a Jupiter swap with configurable slippage the moment a match appears. It is idempotent: one buy per launch, ever, even if the same launch matches twice. The launch feed is real, polled from pump.fun's public API and normalized, and the same feed surfaces the platform's public launches directory. Sniping is not a separate product. It is wallet intents pointed at the launch stream.

### Agent reputation, on chain and staked

Trust in an agent economy cannot be a star rating in someone's database. three.ws uses an ERC-8004 `ReputationRegistry` smart contract. Reviewers submit signed feedback scores from negative 100 to positive 100, optionally backed by an ETH stake held in escrow, with an optional link to off chain detail. Scores aggregate in place, so reading an agent's reputation is a single cheap call returning the average and the count. One review per reviewer per agent, no self review. Reputation lives on chain, where it cannot be quietly edited, and any application can read it as a trust signal before paying an agent to do work.

## $THREE: the coin that powers the platform

The one and only coin three.ws uses is **$THREE**. Its contract address on Solana is `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`. It is the native token of the ecosystem, and its utility is built into the runtime, not promised in a roadmap.

$THREE is a first class settlement asset in the payment modal: an x402 endpoint can price itself in $THREE on Solana, and the modal will settle it natively alongside USDC. Beyond payments, three.ws ships an MCP server, `@three-ws/three-token-mcp`, that gives any AI agent three direct tools: `three_price` returns the live price and a USD to $THREE quote, `three_balance` reads any wallet's $THREE and SOL holdings, and `three_burn` lets a wallet owner destroy $THREE they hold, as a verifiable Solana transaction. The platform itself does not burn $THREE and makes no promise about supply or price. $THREE is wired into wallet intents, into the token MCP, and into the settlement layer, which is what makes it utility rather than decoration.

## The whole stack converged, and it is open source

Put the pieces together and the picture is clear. Agents on three.ws have wallets they control. Those wallets follow plain language policies that react to real events. Their reputation lives on chain where it can be trusted. They can launch and snipe tokens and earn revenue. And when they want to pay for a service, or charge for one, they speak x402 through a modal that makes the hardest part of the agent economy feel like adding a button to a page.

x402 is going to be the payment layer for the agent internet for the same reason HTTPS won transport and JSON won data interchange: it is open, it is simple, and it fits the shape of how machines actually talk. The teams that win the next decade are the ones that make accepting and sending agent payments as easy as embedding a video. That is the bar we built to.

The package is open source and on npm as `@three-ws/x402-payment-modal`, Apache 2.0 licensed, with full docs, a fifteen minute tutorial, and runnable examples for plain HTML, React, and Express. three.ws is a verified provider on the Coinbase x402 Bazaar and listed on agentic.market. The payment code the web forgot for thirty years is finally being used, and we made it a one liner.

Start here:

- Package: `npm install @three-ws/x402-payment-modal`
- Platform: [three.ws](https://three.ws)
- x402 services and the paid agent marketplace: [three.ws/x402](https://three.ws/x402)
- Open source: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws)
- $THREE on Solana: `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`
