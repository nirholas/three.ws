# 422. Ship two new Solana Blinks: tip an agent, buy an agent's coin

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order builds unsigned-transaction *builders* only: nothing here signs or broadcasts, exactly like the existing `api/actions/avatar.js` Blink and the existing `/api/tx/solana/[action].js` non-custodial routes it shares code with. That is not a gated action; it is the same shape of code already shipped and already running in production.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.
- $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only coin this platform promotes. Nothing in this order references any other coin by name or mint; the "buy an agent's coin" Blink resolves a mint at runtime from the platform's own `pump_agent_mints` launch records, which is exactly the "platform launch directories... render coins users launched through three.ws from the platform's own launch records at runtime" exception CLAUDE.md names as not needing the commit gate.

## Step 0: re-derive the current state

Confirm the two reusable, already-production, non-custodial transaction builders this order wraps, rather than writing new ones:

    sed -n '116,230p' api/_lib/custody/builders.js

Expect `buildTransferTransaction({ connection, sender, recipient, amount, token, memo, network })` (SOL or any SPL/Token-2022 mint, builds an unsigned `VersionedTransaction`, already used by `/api/tx/solana/[action].js` and the agent withdraw/trade external-signer paths) and `buildSwapTransaction({ connection, sender, inputMint, outputMint, amount, slippageBps })` (Jupiter-routed unsigned swap, same file). Both never sign, never broadcast, and already carry their own input validation (`clientError`/`upstreamError`).

Confirm the one existing Blink to copy the envelope/header pattern from:

    sed -n '1,120p' api/actions/avatar.js

Confirm agents already have a public, idempotent Solana address and a public profile read:

    sed -n '394,416p' api/_lib/agent-wallet.js
    sed -n '338,365p' api/agents.js

Expect `getOrCreateAgentSolanaWallet(agentId)` (reads `agent_identities.meta.solana_address`, which `api/_lib/agent-create.js` already provisions for every agent at creation; the "create" branch is a dormant fallback for pre-existing rows, not the common path) and `handleGetOne` (public `GET /api/agents/:id`, rate-limited, 404s cleanly for a missing/private/malformed id, already reads `agent_identities i.*` plus the agent's avatar thumbnail key).

Confirm the launch-record table that resolves "this agent's coin":

    grep -n "pump_agent_mints" api/_lib/agent-earnings.js | head -5

Expect `pump_agent_mints` with columns including `agent_id`, `mint`, `network`, `created_at`, queryable as `select mint from pump_agent_mints where agent_id = $1 and network = 'mainnet' order by created_at desc limit 1`.

Confirm this is genuinely unfiled: `/home/user/projects/.evolve-wt/docs/research/solana-robinhood-playbook-2026-10.md`'s ranked plan item 8 ("Commerce Blinks: buy coin, hire, tip", effort 2 days, gate "None") names this gap; `grep -rli "blink" prompts/finish/*.md` as measured 2026-10-24 returns no existing order. If a hit now exists, read it before proceeding; if it already covers tip-and-buy Blinks, retire this order per the table below.

Confirm the companion order this one extends:

    test -f prompts/finish/421-auto-missing-solana-actions-registry.md && echo "421 still open, this order's step 7 widens its registry" || echo "421 already closed, re-read public/.well-known/solana/actions.json before step 7"

## Scope (read before writing code)

Two Blinks, both GET-card/POST-transaction pairs following the exact Actions-spec envelope `api/actions/avatar.js` already implements (`ActionGetResponse`/`ActionPostResponse`, `x-action-version`/`x-blockchain-ids` headers on every response including OPTIONS, CORS `origins: '*'`):

1. **Tip an agent** (`api/actions/agent-tip.js`): GET shows the agent's name and a few preset amounts; POST builds an unsigned SOL (or $THREE, see below) transfer from the caller's wallet to the agent's own Solana address via `buildTransferTransaction`.
2. **Buy an agent's coin** (`api/actions/agent-buy-coin.js`): GET shows the agent's most recent mainnet pump.fun launch and a few preset SOL amounts; POST builds an unsigned Jupiter swap from SOL into that mint via `buildSwapTransaction`.

Deliberately out of scope, so this order stays mechanically checkable and does not sprawl:
- **"Hire this agent"** (the third item the research doc groups with these) is NOT part of this order. Hiring in this codebase (`api/agents/a2a-hire.js`) is an agent-to-agent, custodial, x402-settled flow with spend-policy guards; it has no "human wallet signs one unsigned transaction" shape to wrap in a Blink. Do not attempt to force-fit it here.
- **Wallet creation side effects from an unauthenticated GET.** `getOrCreateAgentSolanaWallet` is safe to call because it is a read for every agent created after `api/_lib/agent-create.js` started provisioning Solana wallets (confirmed in step 0); do not add new logic that behaves differently for the rare pre-existing agent without one. If the lookup returns `created: true` for some legacy row, that is an acceptable, already-idempotent side effect identical to what other public agent-wallet reads already do elsewhere in this codebase; it is not a new risk this order introduces.
- **Token choice for the tip Blink.** Support exactly two: `SOL` (default) and `$THREE` (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`, passed straight into `buildTransferTransaction`'s `token` param, which already accepts an arbitrary mint string). Do not accept an arbitrary caller-supplied mint as the tip token: that would let a Blink card advertise "tip" while quietly moving whatever token a crafted URL names, the same class of trust problem `api/actions/avatar.js`'s own `isUuid` guard on `?avatar=` exists to prevent for its parameter.

## Task

1. Write `api/actions/agent-tip.js`:
   - `GET /api/actions/agent-tip?agent=<uuid>&token=SOL|THREE` (`token` optional, default `SOL`).
   - Validate `agent` with `isUuid` (from `../_lib/validate.js`), exactly like `avatar.js` validates `?avatar=`. A non-uuid is a 400, not a 500.
   - Look up the agent via the same public shape `handleGetOne` queries (name, avatar thumbnail key) scoped to `deleted_at IS NULL`; a missing/private agent is a 404 with a plain message, never a card advertising a tip target that does not exist.
   - Resolve the recipient address via `getOrCreateAgentSolanaWallet(agent.id)`.
   - Return an `ActionGetResponse` with `title` ("Tip <agent name>"), a `description`, an `icon` (the agent's avatar thumbnail CDN URL via `cdnUrl()`/`normalizeStoredUrl()` from `../_lib/r2.js` if one exists, else a generic static tip icon already in `public/` such as an existing site favicon/logo asset; do not build a new headless-render icon pipeline for this), and a `links.actions` array of a few preset amounts (for example 0.01, 0.1, 1 SOL, or the $THREE-equivalent presets if `token=THREE`) plus one free-entry amount field, mirroring the Actions spec's `type: "transaction"` button/field pattern.
   - `POST /api/actions/agent-tip?agent=<uuid>&token=SOL|THREE` with body `{ "account": "<caller pubkey>", "amount": <number> }`. Validate `account` is on-curve (same off-curve PDA rejection `avatar.js`'s POST handler already does; read that handler's POST body to copy the exact check) and `amount` is a positive finite number within a sane ceiling (reuse `MAX_UI_AMOUNT` from `../_lib/custody/builders.js`). Call `buildTransferTransaction({ connection, sender: account, recipient: agentSolanaAddress, amount, token: token === 'THREE' ? 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump' : 'SOL', memo: \`tip:\${agent.id}\`, network: 'mainnet' })` and return the base64-serialized unsigned transaction per `ActionPostResponse`.
   - Set the same version headers (`x-action-version`, `x-blockchain-ids`) and CORS (`origins: '*'`) on every response including OPTIONS, exactly as `avatar.js` does.
2. Write `api/actions/agent-buy-coin.js`:
   - `GET /api/actions/agent-buy-coin?agent=<uuid>`.
   - Validate `agent` with `isUuid`. Look up the agent's public profile the same way. Resolve its most recent mainnet launch: `select mint, name, symbol from pump_agent_mints where agent_id = ${agent.id} and network = 'mainnet' order by created_at desc limit 1`. If the agent has never launched a mainnet coin, return a 404 with a plain message ("this agent has not launched a coin") rather than a card with nothing to buy.
   - Return an `ActionGetResponse` titled "Buy <coin symbol>" with preset SOL amounts (for example 0.1, 0.5, 1 SOL) plus a free-entry field.
   - `POST /api/actions/agent-buy-coin?agent=<uuid>` with body `{ "account": "<caller pubkey>", "amount": <SOL amount> }`. Same `account`/`amount` validation as the tip endpoint. Call `buildSwapTransaction({ connection, sender: account, inputMint: 'So11111111111111111111111111111111111111112', outputMint: mint, amount, slippageBps: 50 })` and return the serialized unsigned transaction per `ActionPostResponse`, surfacing `buildSwapTransaction`'s own `no_route`/`swap_failed` client errors as the 422s they already are rather than masking them as 500s.
3. Add both new files' routes to `vercel.json` following the exact single-segment dynamic-function pattern `api/actions/avatar.js` already uses (check how `/api/actions/avatar` is routed today; `api/actions/agent-tip.js` and `api/actions/agent-buy-coin.js` are single-segment files directly under `api/actions/`, so confirm whether the existing `/api/actions/([^/]+)` generic capture (if one exists) already reaches them, or whether `avatar.js` has its own dedicated route that these two need copies of). Run `npx vitest run tests/vercel-action-routes.test.js` after adding routes, since that test exists specifically to catch an unrouted dynamic function.
4. Widen `public/.well-known/solana/actions.json` (from order 421; re-read it first, since it may already be committed by the time this order runs) to add `pathPattern`/`apiPath` entries for `/api/actions/agent-tip` and `/api/actions/agent-buy-coin`, matching the shape of the existing `avatar` entry.
5. Write `tests/actions-agent-tip-and-buy.test.js` modeled on `tests/actions-avatar-blink.test.js` (read it in full first for the mocking pattern: it mocks `../api/_lib/avatars.js` and `../api/_lib/solana/connection.js`, never hits a real RPC or DB). Cover at minimum:
   - GET returns a valid `ActionGetResponse` shape with version headers, for both endpoints.
   - A non-uuid `agent` param is a 400 for both.
   - An unknown/private/deleted agent, and an agent with no mainnet launch (for buy-coin), are 404s, not cards.
   - POST rejects an off-curve `account` before calling any builder.
   - POST with a valid on-curve `account` and amount calls `buildTransferTransaction`/`buildSwapTransaction` with the expected arguments (mock the builders module, assert the call) and returns the serialized transaction.
   - The `token=THREE` branch on the tip endpoint passes the $THREE mint, not an arbitrary caller-supplied mint, to `buildTransferTransaction`.
6. Run `npx vitest run tests/actions-agent-tip-and-buy.test.js tests/vercel-action-routes.test.js tests/solana-actions-registry.test.js` (the last one only if order 421 already shipped it; otherwise skip that file) and confirm everything passes.
7. Run `npm run check:rules -- --paths api/actions/agent-tip.js api/actions/agent-buy-coin.js vercel.json public/.well-known/solana/actions.json tests/actions-agent-tip-and-buy.test.js` and fix anything it flags.
8. Run `npm run audit:docs` and add both new endpoints to `docs/api-reference.md`'s existing "Claim-avatar action" section (rename or extend its heading to cover all three Blinks) so the doc audit and `ARCHITECTURE.md`'s `.well-known`/Actions listing stay accurate, per CLAUDE.md's documentation rule for new developer-facing capabilities.
9. Append a `data/changelog.json` entry for the two new Blinks (user-visible: anyone with a Blink-aware wallet can now tip an agent or buy its coin directly from the agent's profile link), then run `npm run build:pages`.

## Done when

- `api/actions/agent-tip.js` and `api/actions/agent-buy-coin.js` exist, are routed in `vercel.json`, and are registered in `public/.well-known/solana/actions.json`.
- `npx vitest run tests/actions-agent-tip-and-buy.test.js tests/vercel-action-routes.test.js` passes in full.
- `npm run check:rules` is clean on every changed path.
- `docs/api-reference.md` documents both new Blinks and `npm run audit:docs` is clean.
- `data/changelog.json` has a new entry and `npm run build:pages` succeeds.
- `git diff` shows only the two new action files, the `vercel.json` route additions, the `actions.json` widening, the new test file, the doc update, and the changelog entry.
- The feature is committed on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist) citing the fix commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Order 421 has not run yet, so `public/.well-known/solana/actions.json` does not exist | This order's step 4 creates the file if it is missing (copy order 421's exact shape, just with all three rules instead of one), rather than waiting on another order | Create or widen the file inline; do not block on ordering between the two |
| No generic icon asset is obvious to reuse for the Blink card | The site already ships multiple static logo/icon assets under `public/` (favicons, OG images, the agent-card schema's own icon fields) | Pick any existing small static image under `public/` as the icon rather than building a new render pipeline; this is decoration, not the point of the order |
| Jupiter quote/swap calls would hit a real network during tests | `tests/actions-avatar-blink.test.js` already establishes the pattern: mock the module boundary (`../api/_lib/custody/builders.js` here), never the real RPC/Jupiter call, inside `vitest run` | Follow that exact mocking pattern; do not call live Jupiter or Solana RPC from the test suite |
| Unsure whether `agent_identities` exposes the agent's display name under `name` or another column | `api/agents.js`'s `handleGetOne` already selects `i.*` and the frontend already renders a name from that row somewhere (agent profile page) | Grep the agent profile frontend for which field it reads (`grep -rn "agent.name\|agent.display_name" src/` or similar) and use the same column; do not guess |
| Tempted to let the tip Blink accept any mint via a query param for flexibility | That reopens the exact "untrusted parameter reaches a transaction" class `avatar.js`'s `isUuid` guard exists to close, and risks a crafted link quietly moving a non-$THREE, non-SOL token under a "tip" label | Hardcode the two-token allowlist (`SOL`, `$THREE`) exactly as scoped above |

## Report format

State: the step-0 findings (builder signatures, avatar.js pattern, agent lookup shape, pump_agent_mints query), the two new endpoint files' key logic, the vercel.json routing change, the actions.json widening, the test file and its passing output, the doc/changelog updates, and the commit SHA.
