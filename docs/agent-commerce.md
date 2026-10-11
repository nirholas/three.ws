# Agent Commerce: invoices, sends, offers and spending rules

Agents on three.ws can already pay for things: `pay_quote` and `pay_and_call`
settle a paid endpoint from an agent's wallet, inside the owner's per-payment
and daily caps. Agent Commerce adds everything around that. An agent can
**bill** someone and know when it was paid, **send** money under the owner's
rules, **sell** something and **buy** from another agent with a quote and an
explicit confirm. It can also **read its own spending limits and propose
changes** that only the owner can approve.

Everything settles on Solana. Every payment is verified on-chain before
anything is marked paid, and paid invoices show up in the agent's earnings next
to skill sales and creator fees.

| Piece | Where | Source |
|---|---|---|
| Owner console | [/commerce](https://three.ws/commerce) (also `/invoices`): Invoices, Offers, Purchases and Limit requests tabs | [pages/commerce.html](../pages/commerce.html), [src/commerce-page.js](../src/commerce-page.js) |
| Public invoice and receipt page | `/invoices/<id>`: amount, Solana Pay QR and link, status timeline, "I've paid" check, receipt once paid | [pages/agent-invoice.html](../pages/agent-invoice.html), [src/agent-invoice-page.js](../src/agent-invoice-page.js) |
| REST API | `/api/agent-commerce/*` (v1 envelope, scopes, CSRF, Idempotency-Key) | [api/_lib/agent-commerce/routes.js](../api/_lib/agent-commerce/routes.js) |
| MCP tools | 13 tools on the agent wallet server, `https://three.ws/api/mcp-agent`, group `commerce` | [api/_mcpagent/commerce-tools.js](../api/_mcpagent/commerce-tools.js) |
| Invoice watcher | `/api/cron/agent-invoice-watch`, every minute | [api/cron/agent-invoice-watch.js](../api/cron/agent-invoice-watch.js) |
| Invoices, Solana Pay, verification | server | [invoices.js](../api/_lib/agent-commerce/invoices.js), [solana-pay.js](../api/_lib/agent-commerce/solana-pay.js) |
| Sends, offers, limit requests, step-up | server | [send.js](../api/_lib/agent-commerce/send.js), [offers.js](../api/_lib/agent-commerce/offers.js), [limit-requests.js](../api/_lib/agent-commerce/limit-requests.js), [step-up.js](../api/_lib/agent-commerce/step-up.js) |
| Schema | `agent_commerce_invoices`, offers, orders, quotes and limit requests | [api/_lib/migrations/20261010221500_agent_commerce.sql](../api/_lib/migrations/20261010221500_agent_commerce.sql) |
| Tests | amounts, Solana Pay links, payment matching, status rules, limit diffs, tool policy | [tests/agent-commerce-invoices.test.js](../tests/agent-commerce-invoices.test.js) |

## Invoices

An invoice is a request for a fixed amount of **USDC, SOL or $THREE**, paid
into the issuing agent's own Solana wallet.

| Field | Meaning |
|---|---|
| `amount`, `asset` | What is owed. `asset` is `USDC`, `SOL` or `THREE`. |
| `network` | `mainnet` (default) or `devnet` for testing. $THREE exists on mainnet only, so a devnet $THREE invoice is refused. |
| `memo` | What it is for, up to 140 characters. Shown to the payer, written on-chain with the payment. |
| `description` | Optional longer detail for the receipt page, up to 1000 characters. |
| `payer`, `payer_label` | Optional. A Solana address and a name for who should pay. Leave `payer` empty for an open invoice anyone can pay. The payer field is informational: the money is matched by the invoice's reference, so a payment from another wallet still counts. |
| `due_in_hours` or `due_at` | When it expires. Default 72 hours, at least 5 minutes away, at most 90 days. |
| `status` | `open`, `underpaid`, `paid`, `expired` or `cancelled`. |

Every invoice gets a short number such as `INV-7E1XFEQ6`, a share link
(`/invoices/<id>`), a Solana Pay link (`/api/agent-commerce/pay/<id>`, which
redirects to the `solana:` transfer URL) and a QR code
(`/api/agent-commerce/pay/<id>/qr.svg`). Any Solana wallet that supports
Solana Pay can scan the QR and pay in one step.

### How a payment is matched

Each invoice carries a unique **reference key**. The Solana Pay link puts that
key on the transfer, and the watcher finds payments by reading the
transactions that touch it. A transaction counts toward the invoice only when:

- it succeeded;
- it carries the invoice's memo;
- the right asset arrived at the issuing agent's wallet (the right mint and
  owner for USDC and $THREE, a native transfer for SOL).

Anything else is recorded as ignored with the reason (memo mismatch, wrong
mint, failed transaction), never counted. Partial payments add up: two
payments of half the amount make the invoice `paid`.

### Lifecycle

```
open ──▶ underpaid ──▶ paid
  │          │
  ├──────────┴──▶ expired   (the due date passed first)
  └──▶ cancelled            (the owner or the agent cancelled it)
```

- **underpaid**: a verified payment landed but the total is short. The pay
  link always asks for the *remaining* amount.
- **expired**: the due date passed before it was paid in full. A payment that
  arrives later still settles it and is marked paid late. The money has
  already moved, so an invoice that kept saying "expired" would be wrong. The
  watcher keeps reading expired invoices for 24 hours for that reason.
- **cancelled**: only an `open` invoice can be cancelled. Cancelling twice is
  harmless and returns the same invoice.

Every transition is a guarded update, so the watcher and a payer pressing
"I've paid" at the same moment fire each webhook and notification exactly once.

### Notifications and webhooks

The owner gets an inbox notification (with a deep link to the invoice) when an
invoice is paid, underpaid or expired. Webhook subscribers receive
`invoice.created`, `invoice.paid`, `invoice.underpaid`, `invoice.expired` and
`invoice.cancelled`, with the invoice in the payload. Subscribe from the
webhooks panel, as with every other three.ws event.

### Earnings

When an invoice becomes `paid`, its USD value is fixed from the amount actually
received at the live price of that moment. Paid **mainnet** invoices appear in
the agent's earnings ledger as invoice income, next to skill sales and creator
fees. Devnet invoices are test traffic and never count as earnings.

## Sends

`agent_send` moves money out of an agent's wallet to someone else, and it is
always two steps:

1. `agent_send_preview` pins the recipient, amount, asset and chain, and
   reports how the send will be gated. The agent shows its user that table.
2. `agent_send` consumes the preview with `confirm_send: true`. The destination
   is re-checked at that moment:
   - **on the owner's destination allowlist** (active and past its cooldown):
     the agent signs it now, inside every spend cap;
   - **not on it while the allowlist is off**: it becomes an approval request
     in the owner's approvals inbox (push and Telegram). It is not sent until
     the owner approves;
   - **refused** by an enforced allowlist, a frozen wallet or a cap: it stops
     with the reason. Approval cannot lift any of those.

A preview runs once, expires, and only works for the agent that asked for it.

## Offers and purchases

An agent lists something for sale with `agent_sell`: a title, a price in USDC,
SOL or $THREE, optional stock, and the **fulfillment** the buyer receives once
paid (a download link, a code, instructions). Other agents find it with
`offer_list`. Anyone can see the active ones at `GET /api/agent-commerce/offers`.

Buying is quote, then confirm:

1. `agent_buy` returns a quote with the seller's wallet, the amount, the asset
   and the chain. Nothing is reserved or signed.
2. `agent_buy_confirm` with that `preview_id` and `confirm_payment: true`
   re-reads the offer (price, stock, still active) and opens an invoice from
   the seller to the buyer. It pays that invoice from the buyer's wallet inside
   the buyer's caps, then verifies it on-chain. When the invoice reads `paid`,
   the order is delivered, the stock goes down, and the fulfillment is returned.

A purchase is an ordinary invoice under the hood, so a sale lands in the
seller's invoices, webhooks and earnings like any other income. If the
payment lands before the RPC has indexed it, the order stays `submitted` and
the watcher finishes it; confirming the same preview again returns the order
and, once paid, the fulfillment. The owner manages offers (pause, reactivate,
close) and sees every purchase on the Offers and Purchases tabs of
[/commerce](https://three.ws/commerce).

## Spending rules

`spending_check` reads an agent's limits and today's usage: per-payment cap,
daily cap, per-counterparty daily cap, whether the wallet is frozen, and
whether capabilities are required.

`spending_setup` lets the agent **propose** a change to those keys
(`daily_usd`, `per_tx_usd`, `per_counterparty_daily_usd`, `frozen`,
`require_capabilities`) with a reason. A proposal never changes anything:

- It appears on the **Limit requests** tab of `/commerce` as a before/after
  table, with each row marked as loosening or tightening, and a fingerprint of
  the exact change.
- Approving asks the owner to confirm it is them, with one of: their account
  password; a fresh Google sign-in; or a signature from a Solana wallet linked
  to their account over a message naming the request and its fingerprint. The
  confirmation is valid for five minutes.
- The approve endpoint accepts only a browser session with CSRF, so an agent's
  API key or OAuth token cannot reach it, and no tool approves. An agent can
  never approve its own limits.
- On approval the change is applied through the same owner-only writer as the
  Limits & Safety panel, and the custody log records it. A request expires
  after seven days, and an agent can have at most three pending.

The destination allowlist is not proposable. It keeps its own cooldown-gated
flow.

## MCP tools

All thirteen live on the agent wallet server, `https://three.ws/api/mcp-agent`,
in the `commerce` group. Financial-tier tools are hidden until a connection
turns the group on, for example with `X-Three-Tools: default,commerce`.

| Tool | Tier | Scope | What it does |
|---|---|---|---|
| `invoice_create(agent_id, amount, asset, memo, network?, description?, payer?, payer_label?, due_in_hours?, due_at?)` | write | `agents:write` | Issue an invoice. Returns the share link, Solana Pay link and QR. |
| `invoice_details(invoice_id)` | read | `wallet:read` | One invoice with its payments and timeline. |
| `invoice_list(agent_id?, status?, limit?, before?)` | read | `wallet:read` | Your invoices with totals (outstanding, paid, past due, mainnet income). |
| `invoice_verify(invoice_id)` | read | `wallet:read` | Read the chain now and settle whatever it shows. |
| `invoice_cancel(invoice_id)` | write | `agents:write` | Cancel an open invoice. |
| `agent_send_preview(agent_id, to, amount, asset, network?, memo?)` | read | `wallet:read` | The confirmation table for a send and how it will be gated. Returns a `preview_id`. |
| `agent_send(agent_id, preview_id, confirm_send)` | **financial** | `wallet:write` | Send, or route to owner approval, per the rules above. |
| `offer_list(seller_agent_id?, asset?, network?, limit?)` | read | none beyond sign-in | Active offers to buy from. |
| `agent_sell(agent_id, title, price, asset, fulfillment, description?, network?, stock?)` | write | `agents:write` | List an offer. |
| `agent_buy(agent_id, offer_id)` | read | `wallet:read` | A purchase quote. Returns a `preview_id`. |
| `agent_buy_confirm(agent_id, preview_id, confirm_payment)` | **financial** | `wallet:write` | Pay for the quoted offer and return the fulfillment once verified. |
| `spending_check(agent_id, network?)` | read | `wallet:read` | Current limits and today's usage. |
| `spending_setup(agent_id, changes, reason?)` | write | `agents:write` | Propose a limit change for the owner to approve. |

The model must show the user the preview table (recipient, amount, asset,
chain) and get an explicit yes before sending a `confirm_send` or
`confirm_payment` flag.

## REST API

Base path: `https://three.ws/api/agent-commerce`. Responses use the v1
envelope (`{ data, meta }` or `{ error: { code, message } }`). Writes from a
browser session need the `x-csrf-token` header. Creates accept an
`Idempotency-Key`.

| Method and path | Auth | What it does |
|---|---|---|
| `GET /invoices/:id/public` | public | The payer's view: amount, pay link, timeline. |
| `POST /invoices/:id/verify` | public | Read the chain now and settle what it shows. |
| `GET /pay/:id` | public | 302 to the invoice's `solana:` transfer link. |
| `GET /pay/:id/qr.svg` | public | That link as a QR code. |
| `GET /offers` | public | Active offers. |
| `GET /invoices`, `POST /invoices` | owner, `wallet:read` / `agents:write` | List with totals; create. |
| `GET /invoices/:id`, `POST /invoices/:id/cancel` | owner | One invoice in full; cancel. |
| `GET /offers/mine`, `POST /offers/mine`, `POST /offers/:id/status` | owner | Your offers; list one; set `active`, `paused` or `closed`. |
| `GET /purchases` | owner, `wallet:read` | What your agents bought. |
| `GET /requests` | owner, `wallet:read` | Limit proposals from your agents. |
| `POST /requests/:id/challenge` | owner, browser session only | Step-up options and the wallet message to sign. |
| `POST /requests/:id` | owner, browser session only | `{ decision: "approve", payload_hash, step_up }` or `{ decision: "deny" }`. |

Create a devnet invoice with an API key:

```bash
curl -s https://three.ws/api/agent-commerce/invoices \
  -H "authorization: Bearer $THREE_WS_API_KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"agent_id":"<your agent id>","amount":"0.01","asset":"SOL","network":"devnet","memo":"Logo design, first draft","due_in_hours":48}'
```

The response carries `invoice.page_url` (the share link to send the payer),
`invoice.pay_url` (the `solana:` transfer link) and `invoice.qr_url`. The two
pay fields become `null` once the invoice is paid or cancelled.

## Testing on devnet

Create an invoice with `"network": "devnet"` in USDC or SOL, open its share
link, and pay it from any devnet wallet by scanning the QR. Press "I've paid"
on the page, or wait up to a minute for the watcher. To see the other states:
pay part of the amount and the invoice reads `underpaid` with the remainder on
the pay link; set `due_in_hours` to `0.1` and let it pass, and it reads
`expired`.

## Related

- [Agent wallet MCP server](./mcp-agent.md): `pay_quote`, `pay_and_call` and the rest of the wallet tools.
- [Account linking](./account-linking.md): linking the Solana wallet used for step-up signatures.
- [STRUCTURE.md](../STRUCTURE.md): where every surface lives.
