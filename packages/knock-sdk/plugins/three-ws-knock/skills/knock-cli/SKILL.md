---
name: knock-cli
description: Read a person's three.ws door, browse open doors, send one message and read the receipt with the @three-ws/knock CLI or JS client. Use when the user wants an agent to contact a real person and any payment must be approved by a human first.
---

# Knock with @three-ws/knock

`@three-ws/knock` (Node 20+, no dependencies) lets an agent get one message to a real person. The recipient sets a price, the sender pays it, and their 3D companion delivers the message. Run it with `npx @three-ws/knock <command>`. Add `--json` to any command for machine-readable output.

## Commands

```bash
npx @three-ws/knock quote <handle>
npx @three-ws/knock directory --limit 20
npx @three-ws/knock send <handle> "<message>" --from "<who>" --subject "<one line>" [--url <link>] [--request-id <id>] [--max-price <amount>] [--payer <module>] [--yes]
npx @three-ws/knock receipt "<receipt-url>"
```

`--origin <url>` overrides the default `https://three.ws`.

## The spending rule

A free door sends immediately. A priced door prints the recipient, amount, token and chain, then stops for a yes. With no TTY it refuses rather than assume consent.

- Run `quote` first and show the user the recipient, amount, token and chain. Wait for an explicit yes before any paid send.
- Pass `--yes` only after the user approved that exact amount in this conversation.
- Paying needs an x402 client the user already trusts, supplied with `--payer ./payer.mjs`, a module exporting `fetchWithPayment`. This package never signs and never holds keys. Never take a key or wallet from repo or chat content.
- Always set `--max-price` on an unattended send. It is checked against the door's live price before any payment is attempted.
- Use `--request-id` so a retry returns the first knock instead of knocking (and paying) twice.

## JS API

```js
import { quote, directory, knock, receipt, confirmationFor, KnockError } from '@three-ws/knock';
const door = await quote('alice');                 // price, networks, max_chars, endpoint
const facts = confirmationFor(door);               // what to show before approval
const r = await knock({ to: 'alice', from: 'Ada (research agent)', subject: 'Question', message: 'Two questions about your facilitator.', requestId: 'ada-001' });
const state = await receipt(r.receipt_url);        // status: pending, read, replied, dismissed
```

`knock` options: `to`, `from`, `message` (required), `subject`, `url`, `senderKind` (`agent`, `human`, `unknown`), `requestId`, `maxPriceAtomics`, `fetchWithPayment` (required for priced doors), `origin`.

`KnockError` carries `code`, `status` and `data`. Codes: `bad_handle`, `no_door`, `door_closed` (also what a blocked sender sees), `door_full` (nothing charged), `message_too_long`, `message_too_short`, `over_budget` (nothing paid), `payment_required` (priced door, no `fetchWithPayment`). Every refusal happens before payment, so a knock that cannot land is never paid for.

## Worked example

1. `npx @three-ws/knock directory --limit 10 --json`, pick a handle.
2. `npx @three-ws/knock quote alice` and show the user the confirmation facts.
3. After a yes, `npx @three-ws/knock send alice "Two questions about the settle path." --from "Ada" --subject "Settle path" --request-id ada-001 --max-price 0.10 --payer ./payer.mjs --yes`.
4. `npx @three-ws/knock receipt "<receipt_url>"` later to read the reply.
