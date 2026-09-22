# 08. Lending and yield from the agent wallet

Read `docs/prompts/README.md` first.

## The problem

Yield data is read-only: `api/defi/` serves protocol and pool yields, and nothing lets an agent deposit idle USDC or SOL into a lending market, track the position, or withdraw. "Earn yield" is a prompt flow in prompt 02 with nothing behind it.

## Build

### Venue

Pick one Solana lending venue by these criteria and record the choice in your report: an on-chain program with a maintained TypeScript SDK, top-three TVL among Solana lending markets, USDC and SOL markets, and no whitelist. Integrate it in `api/_lib/lending/<venue>.js` behind `api/_lib/lending/index.js`. No venue token names in committed code.

### Routes and tools

Under `api/v1/agents/:id/lending/` with MCP tools on `/api/mcp-agent` under the prompt 03 policy:

- `markets` (`lend_markets`): every supported token with supply APY, borrow APY, utilization, available liquidity, and the risk parameters.
- `positions` (`lend_positions`): the agent's deposits and borrows with accrued interest and health factor.
- `deposit/preview` and `deposit` (`lend_deposit`, financial, `confirm_deposit`, fresh `preview_id`).
- `withdraw/preview` and `withdraw` (`lend_withdraw`, financial, `confirm_withdraw`).
- `borrow/preview`, `borrow`, `repay/preview`, `repay` (`lend_borrow`, `lend_repay`, financial) only if the venue supports it safely; otherwise ship deposit and withdraw and say so in the docs.
- `history` (`lend_history`): every action with signatures and interest earned.

Every fund-moving call goes through the agent wallet signer, `enforceSpendLimit`, the anomaly freeze, and the custody ledger.

### Yield automation

- Wallet intent action `earn`: "deposit idle USDC above a reserve of X" and "withdraw when balance below Y", built on `api/_lib/wallet-intents.js` with the existing receipt path.
- A cron `lending-accrual` under `api/cron/` that refreshes position snapshots for the `three://agents/{id}/lending` resource and the page.

### UI

`/agents/:id/earn` page (add to `data/pages.json`): markets with APY, the agent's positions, deposit and withdraw flows with preview then confirm, health factor if borrowing exists, history. Every state designed. Link from the wallet page and the cockpit.

## Docs and wiring

`docs/lending.md` (new) linked from `docs/start-here.md`; `docs/api-reference.md` section; `STRUCTURE.md` row; `data/changelog.json` entry tagged `feature`.

## Acceptance

- Dry run: preview a minimal USDC deposit on the QA agent and stop at the owner confirmation table (gate 1).
- `lend_withdraw` for more than the position returns a validation error before any transaction is built.
- Tests with recorded real RPC fixtures for market parsing and preview math; `npm test` green.
