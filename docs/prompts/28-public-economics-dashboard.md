# 28. Public economics: fee split, buybacks, burns and creator payouts, live

Read `docs/prompts/README.md` first.

## The problem

The flywheel runs (`api/cron/economy-tick.js`, the buyback crons, the launcher claimer, fee bridge), and `docs/x402-ring-economy.md` describes it, but there is no public page a holder or a creator can open to see the numbers: fees collected, the split, what went to buybacks and burns with signatures, what creators earned, and what the treasury holds. Competitors state the split as a headline and back it with a page.

## Build

- `api/economy/summary.js`: totals and time series for fees collected by source (launch creator fees, marketplace, x402, subscriptions), the split percentages read from the same settings the crons use, buyback amount and `$THREE` bought and burned with every signature, creator payouts, treasury balances, and the current round of the program from prompt 27. Cached, refreshed by the economy tick.
- Page `/economy` (in `data/pages.json`): headline split, live tiles, charts following the `dataviz` skill, a ledger table with signature links, a "how it works" section from the doc, and a JSON and RSS feed of buyback events. Every state designed.
- The launch studio, the marketplace and the pricing page link to it wherever a fee is shown.
- MCP tool and resource `three://economy` on the unified endpoint.
- Docs: `docs/x402-ring-economy.md` updated to point at the page; changelog entry tagged `feature`.

## Acceptance

- Every number on the page reconciles to the ledger rows and on-chain signatures for the last 30 days (a test does the reconciliation).
- The split shown equals the setting the crons use.
- `npm test` green.
