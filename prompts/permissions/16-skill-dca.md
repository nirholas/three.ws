# Task 16 — Reference skill: DCA (`public/skills/dca/`)

## Why

The third canonical MetaMask announcement use case: an autonomous DCA (dollar-cost averaging) strategy that swaps a fixed USDC amount into WETH on a schedule. This is the first skill that calls a DEX (Uniswap V3 SwapRouter), so it exercises `scope.targets` for contract allow-listing and `scope.selectors` for function-level scoping.

## Read first

- [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md) — skill layout
- [public/skills/subscription/](../../public/skills/subscription/) — cron pattern; DCA reuses the same cron infrastructure (task 15) — if task 15's `api/cron/run-subscriptions.js` exists, extend it with a type discriminator; else create a dedicated `api/cron/run-dca.js`
- [00-README.md](./00-README.md) — scope shape, note `selectors` field is optional; use it here
- Uniswap V3 SwapRouter addresses per chain — verify from Uniswap docs, do not guess
- [src/runtime/delegation-redeem.js](../../src/runtime/delegation-redeem.js) — `redeemFromSkill({ mode: 'relayer' })`

## Build this

Create `public/skills/dca/`:

1. **`SKILL.md`** frontmatter:
    - `name: dca`
    - `version: 0.1.0`
    - `trust: owned-only`
    - `permissions_required: true`
    - `default_scope_preset`:
        ```jsonc
        {
            "token": "<USDC>",
            "maxAmount": "100000000", // 100 USDC per day cap
            "period": "daily",
            "targets": ["<Uniswap V3 SwapRouter address>"],
            "selectors": ["0x04e45aaf"], // exactInputSingle selector — verify from Uniswap ABI
            "expiry_days": 30
        }
        ```
2. **`skill.js`**:
    - `setup({ agent, host })` — exposes a "Start DCA" action to the owner only.
    - `execute({ agent, host, args })` (owner-facing):
        1. Prompts for: tokenIn (USDC fixed for v0.1), tokenOut (default WETH), amountPerExecution, frequency (`daily|weekly`).
        2. Opens the grant modal with the preset. Waits for signed delegation.
        3. `POST /api/dca-strategies` with `{ agentId, delegationId, tokenIn, tokenOut, amountPerExecution, periodSeconds, slippageBps }`.
    - `onPeriod({ strategy })` (server-side, invoked by cron):
        1. Builds an `exactInputSingle` calldata for Uniswap V3 with current best quote. Use the existing quoter or fetch from the public Uniswap quoter contract; do not require a 3rd-party price API.
        2. Applies `slippageBps` to the quote to get `amountOutMinimum`.
        3. Calls `redeemFromSkill({ mode: 'relayer', calls: [ approveCall, swapCall ] })`. The approve call targets the USDC contract to approve SwapRouter for `amountPerExecution` — include USDC in `scope.targets` in the preset (fix: preset `targets` above should include **both** SwapRouter and USDC; update the preset to include `[SwapRouter, USDC]` and selectors for `approve` + `exactInputSingle`).
        4. Records the execution + resulting WETH amount in `dca_executions` table (new, small, per task 15's schema pattern).
3. **New endpoint `api/dca-strategies.js`**:
    - POST / GET / DELETE paralleling `api/subscriptions.js`. Small table `specs/schema/dca_strategies.sql` (new file, self-contained).
4. **Cron**: extend task 15's cron if present, or add `api/cron/run-dca.js`. Hourly. Picks rows where `next_execution_at <= NOW()`.
5. **Safety preset**: `slippageBps` default 50 (0.5%). Max 500 (5%) at the UI level.

## Don't do this

- Do not build our own routing logic. Use the Uniswap V3 quoter directly.
- Do not skip the `approve` step. USDC requires allowance to the router per swap — reuse the approval where safe but re-approve if insufficient.
- Do not allow arbitrary tokenOut at v0.1. Whitelist WETH and a small set of well-known tokens per chain (hardcoded).
- Do not run DCA on mainnet by default. Base Sepolia first; owner must explicitly opt into mainnet with an extra confirmation in the UI.
- Do not execute if the quote is >1% off a recent Coingecko check — optional safety, but at minimum check the Uniswap quoter twice 15s apart and abort if they diverge >0.5%.

## Acceptance

- [ ] Owner configures DCA → grant modal → delegation stored → strategy row inserted.
- [ ] Next cron tick executes a real swap on Base Sepolia (tx hash in reporting).
- [ ] Slippage-exceeded scenario aborts cleanly without redeeming.
- [ ] Delegation expiry pauses the strategy.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Explorer link to a real DCA swap tx (Base Sepolia).
- The quoter vs. executed-swap amounts + slippage used.
- Screenshot of the strategy config UI.
