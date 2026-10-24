# One paid skill, four rails

A priced marketplace skill is defined once and served over every payment rail its author enables. Callers pick the rail; the price, the author and platform split and the receipt are the same on all of them.

| Rail | How a caller reaches it | Settles as |
|---|---|---|
| `x402` | Plain `GET`/`POST /api/skills/:id/invoke`, pay with `X-PAYMENT` | x402 `exact` on Solana (Base when the author set a Base payout) |
| `mpp` | `x-payment-rail: mpp` (or `?rail=mpp`), pay with `Authorization: Payment` ([MPP on Solana](./mpp-solana.md)) | the same Solana `exact` transaction |
| `a2a` | JSON-RPC `message/send` with the `x402` extension | x402 `exact` through the A2A task flow |
| `ap2` | Present an `x-ap2-mandate` and `x-ap2-cart` | a signed mandate debited against its spend ledger |

`rails` defaults to `["x402","a2a"]`. The author toggles the rest in the publish flow on `/marketplace` (the rail checkboxes next to the price), or sends `rails` to `POST /api/skills`. A skill with a price and no rail enabled is refused at publish.

## One quote

`quoteSkill()` in [api/_lib/skill-rails.js](../api/_lib/skill-rails.js) turns the skill's per-call USD price into atomics and the author/platform split. Every rail calls it, so the dry run below prices each rail identically:

```
GET /api/skills/:id/invoke?dry_run=1&rail=<rail>
```

| rail | price_atomics | author_atomics | platform_atomics | platform_bps | currency |
|---|---|---|---|---|---|
| x402 | 10000 | 9750 | 250 | 250 | USDC |
| mpp | 10000 | 9750 | 250 | 250 | USDC |
| a2a | 10000 | 9750 | 250 | 250 | USDC |
| ap2 | 10000 | 9750 | 250 | 250 | USDC |

A dry run moves no funds and writes no receipt.

## Agent card

`GET /api/skills/:id/card` is the skill's A2A agent card. It lists each enabled rail with its endpoint and headers. A rail the author switched off is absent from the card and answers `404` on `invoke`.

## Receipts

Whatever the rail, a successful call runs the same `recordSkillInvocation()`: one `x402_receipts` row (tagged with the rail) and one royalty ledger accrual carrying the author/platform split.

## Tests

`npx vitest run tests/skill-rails.test.js` runs the router, mandate and cart signing, the spend ledger and royalty accrual for real against local counterparties; `tests/mpp-solana.test.js` covers the MPP wire format end to end.
