# Native $THREE launchpad gets a coin page and one-click buy from SOL

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/718-plan-launchpad-native-coin-page-and-sol-buy.md`.

**Priority:** P2, new capability with clear value (score 56 of 100 inside the tier). **Area:** launchpad. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The native launchpad (Meteora Dynamic Bonding Curve priced in $THREE) is built, tested and documented, but a native coin has no page of its own and a buyer who holds only SOL cannot buy. `docs/native-launchpad.md` names both gaps in "Current limits". `/launches/<mint>` (`pages/launch-detail.html`, `src/launch-detail.js`) reads pump-specific endpoints, so the launch success screen has to link to Solscan and the agent page instead. SOL is what almost every Solana wallet holds, and $THREE is the quote token, so the SOL to $THREE hop is the largest conversion barrier on the lane. This order delivers the two missing user-facing pieces and proves them on devnet. It is the first thing a user who follows a native-coin link will hit.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `GET https://three.ws/api/native-launch/config` answers with the lane economics and `config_key: null`, `network: mainnet`: the mainnet DBC config has not been created. `GET /api/native-launch/launches` returns an empty list. No native coin exists on mainnet.
- Built: `api/native-launch/[action].js` (launch-prep, launch-confirm, swap-prep, config, pool, quote, launches), `api/_lib/native-launch/{config,dbc,fee-config}.js`, `pages/three-launchpad.html` with `src/three-launchpad/page.js`, table `native_launches` (migration `20260726100000_native_launchpad.sql`), `scripts/native-launchpad-e2e-devnet.mjs`, `scripts/native-launchpad-create-config.mjs`, tests `tests/native-launch-curve.test.js` and `tests/native-launch-endpoint.test.js`.
- `vercel.json` routes `/launches/<mint>` to `launch-detail.html`; `src/launch-detail.js` is pump-only (price history, trades, safety and smart-money endpoints are pump endpoints).
- No trade-history store exists for native pools (`grep -rn "native_trades\|native_launch_trades" api` finds nothing).
- Another open order, `prompts/finish/512-integrate-13-anti-snipe-native-lane.md`, covers the decaying anti-snipe fee. Do not touch fee logic here.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
curl -s https://three.ws/api/native-launch/config | head -c 400
curl -s "https://three.ws/api/native-launch/launches?limit=3"
grep -n "native" src/launch-detail.js | head
grep -n "jupiter" -i api/_lib/native-launch/*.js api/native-launch/*.js src/three-launchpad/page.js | head
ls pages | grep -i launch-detail; sed -n 1170,1185p vercel.json
npm test -- tests/native-launch-curve.test.js tests/native-launch-endpoint.test.js
```

If a native coin detail view or a SOL-in swap path already exists, build only what is missing.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read the whole `api/native-launch/[action].js` and `api/_lib/native-launch/dbc.js`. Decide the minimum read data a coin page needs: pool state (`/pool`), a live quote (`/quote`), the launch row (name, symbol, image, agent, creator), and recent swaps. Recent swaps come from on-chain: add `GET /api/native-launch/trades?mint=&network=&limit=` that reads the pool's recent signatures through the configured RPC and parses swap events (server-side, cached for a few seconds). No new table.
2. Test first for each new endpoint in `tests/native-launch-endpoint.test.js`: `trades` validates the mint, clamps `limit` to 1..50, answers 404 for a mint not in `native_launches`, never reaches the database or RPC on an invalid mint.
3. Route native coins to a native detail view. Preferred: `src/launch-detail.js` detects a native coin by looking the mint up through `GET /api/native-launch/launches?mint=` (add the `mint` filter, validate it as base58 32..44) and renders a native layout (curve progress bar toward graduation, price in $THREE, market cap, fee schedule from `/config`, buy and sell panel using `swap-prep`, recent trades, the agent card). Pump coins keep their existing path untouched. The launch success screen in `src/three-launchpad/page.js` links to `/launches/<mint>`.
4. One-click buy from SOL. Add `POST /api/native-launch/swap-prep` support for `side: "buy"` with `pay_with: "sol"`: build a single unsigned v0 transaction that first swaps SOL to $THREE through the Jupiter quote and swap-instructions API (mainnet only; the program IDs and mint come from `config.js`), then the curve buy, with the slippage floor taken from the combined quote. On devnet, where $THREE and Jupiter do not exist, return a typed `400 sol_swap_unavailable_on_devnet` and keep the $THREE-in path. Show the SOL path in the buy panel with an explicit total (SOL in, $THREE out, tokens out, fee breakdown).
5. Test first for the SOL path: the builder returns a transaction whose instruction list contains the Jupiter swap before the DBC swap, the min-out equals the combined floor, and a quote failure maps to a typed error. Use recorded real Jupiter response fixtures captured from a real GET (store under `tests/fixtures/` as JSON, no invented numbers).
6. UI states on the native coin view and the buy panel: skeleton blocks for chart, stats and trades while loading; an empty state for "no trades yet, be the first" with the buy panel focused; an error state for RPC or quote failure with a Retry button and the exact failure; hover, focus-visible and active styles on every button and tab; keyboard reachable; works at 400px width.
7. Devnet proof: extend `scripts/native-launchpad-e2e-devnet.mjs` (or add a section) to launch a native coin on devnet, open the new detail view through the dev server, buy and sell through the page with a funded devnet wallet, and see the trade appear. Capture the observed results for the report.
8. Update `docs/native-launchpad.md` ("Current limits" loses the two resolved bullets; "Where it lives" gains the new files), add the `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test tests/native-launch-endpoint.test.js tests/native-launch-curve.test.js` exits 0 with the new cases present.
- [ ] `curl -s "http://localhost:3000/api/native-launch/trades?mint=not-a-mint"` answers 400, not 500.
- [ ] On devnet, a native coin created by the e2e script renders at `/launches/<mint>` in a real browser with the curve progress, quote, trades and agent card, no console errors.
- [ ] A pump.fun coin at `/launches/<pump mint>` renders exactly as before.
- [ ] `docs/native-launchpad.md` no longer lists the coin-detail page or one-click SOL buy as limits.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Mainnet DBC config is not created | Work on devnet with `scripts/native-launchpad-create-config.mjs --network devnet`; the pages must also render the honest "lane not deployed on this network" state from `/config` |
| Jupiter is not available on devnet | Gate the SOL path to mainnet in the builder, return a typed error on devnet, and verify the instruction composition in unit tests from real captured responses |
| Devnet wallet has no SOL | Use the devnet faucet via `solana airdrop` against the devnet RPC, or the repo's existing devnet funding helper in the e2e script |
| RPC rate limits when parsing trades | Cache the parsed result for 5 to 10 seconds and page by signature; use the configured RPC provider env rather than the public endpoint |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Creating the mainnet DBC config (`scripts/native-launchpad-create-config.mjs --network mainnet`) spends about 0.006 SOL of rent and mints nothing, but it is an on-chain write and needs the owner's explicit yes with the partner wallet and the printed config key. Do not run it in this order. Run the mainnet dry run (no key, no spend) to prove the config would be valid, and state the exact command for the owner in the final report. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/718-plan-launchpad-native-coin-page-and-sol-buy.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `718-plan-launchpad-native-coin-page-and-sol-buy.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/native-launchpad.md` (section "Current limits")

~~~~markdown
## Current limits

Stated plainly, because a half-built feature that claims to be finished is worse than one that names its edges:

- **No custodial launch path.** The pump.fun lane can launch from an agent's own server-signed wallet; the native lane is always signed by the launcher's connected wallet. The lane toggle switches the signer back to the connected wallet automatically rather than offering an option that would fail.
- **No coin-detail page yet.** `/launches/<mint>` reads price history, trades, safety, and smart-money data from pump-specific endpoints, so it cannot render a native coin. The launch success screen links to Solscan and the agent page instead of a link that would 404.
- **No coin variants.** Mayhem, USDC pairing, buyback binding, and delegated reward splits are pump.fun program features. The native lane is $THREE-quoted and variant-free, so that picker is withheld on this lane rather than shown with dead options.
- **No one-click buy from SOL.** A buyer who holds only SOL swaps to $THREE first (the page links to [/three-token](https://three.ws/three-token)). Bundling a Jupiter SOL to $THREE swap in front of the curve buy is the obvious next step.
- **Thin $THREE liquidity cuts both ways.** A graduation needs about 12.3M $THREE bought through the curve. That is the point, and it also means early curves fill slowly until $THREE's own liquidity deepens.
~~~~

### `docs/native-launchpad.md` (section "Read endpoints")

~~~~markdown
### Read endpoints

All public, no auth:

- `GET /api/native-launch/config[?network=]` - the lane's live economics and whether it is deployed. This is what the launch UI renders, so the fee story on the page always comes from the same source as the on-chain config.
- `GET /api/native-launch/pool?mint=…[&network=]`: pool address, curve progress (0..1), `quote_reserve_three` ($THREE held in the curve), `migration_quote_threshold_three`, migration status.
- `GET /api/native-launch/quote?mint=…&three_in=…[&network=]`: a live buy quote off the curve: tokens out, minimum out, and the fee breakdown in $THREE. Pass `tokens_in=…` instead for a sell quote (`three_out`, `min_three_out`).
- `GET /api/native-launch/launches[?network=&agent_id=&limit=&offset=]`: the native launch directory, each row carrying its agent and avatar thumbnail. `agent_id` must be a uuid: anything else answers `400 validation_error` instead of reaching the database. `limit` is clamped to 1..100 (default 24), `offset` to a non-negative integer.
~~~~

### `docs/native-launchpad.md` (section "Where it lives")

~~~~markdown
## Where it lives

| Piece | Path |
|---|---|
| Curve economics (single source of truth) | [`api/_lib/native-launch/config.js`](../api/_lib/native-launch/config.js) |
| DBC wrapper (build launch and swap txs, read pool, quote) | [`api/_lib/native-launch/dbc.js`](../api/_lib/native-launch/dbc.js) |
| Public page (lane facts, coin directory, buy and sell, launch) | [`pages/three-launchpad.html`](../pages/three-launchpad.html) + [`src/three-launchpad/`](../src/three-launchpad) `→ /three-launchpad` |
| HTTP dispatcher | [`api/native-launch/[action].js`](../api/native-launch/%5Baction%5D.js) |
| Launch table | `native_launches` (migration `20260726100000_native_launchpad.sql`) |
| Launch UI (lane toggle) | [`public/studio/launch-panel.js`](../public/studio/launch-panel.js) |
| Config creation | [`scripts/native-launchpad-create-config.mjs`](../scripts/native-launchpad-create-config.mjs) |
| Devnet end-to-end | [`scripts/native-launchpad-e2e-devnet.mjs`](../scripts/native-launchpad-e2e-devnet.mjs) |
| Tests | `tests/native-launch-curve.test.js`, `tests/native-launch-endpoint.test.js` |

Note the namespace: this lane is `/api/native-launch/*`. The unrelated `/api/launchpad/*` endpoints belong to Launchpad Studio, the page builder.

---
~~~~

