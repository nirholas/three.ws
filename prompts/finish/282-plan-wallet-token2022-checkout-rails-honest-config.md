# Every $THREE purchase and checkout builder handles Token-2022, and /pricing says plainly when a payment rail is not switched on

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/282-plan-wallet-token2022-checkout-rails-honest-config.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 56 of 100 inside the tier). **Area:** wallet. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

$THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is a Token-2022 mint, but several Solana payment builders still derive associated token accounts and build `transferChecked` with the legacy token program. A $THREE payment built by them either cannot be signed into a valid transaction or sends to the wrong ATA, so the marketplace "pay in $THREE", the Premium data pass quote and skill purchases cannot work even after the owner configures the treasury wallets. Separately, `/pricing` renders "Pay in USDC, SOL, or $THREE, 20% off in $THREE" while `POST /api/payments/solana/checkout` answers `503 not_configured` (`PAYMENT_RECIPIENT_SOLANA` unset), so a paying user hits a generic "checkout failed". The self-hosted x402 facilitator was already fixed for Token-2022; the rest was not.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Fixed already: `api/_lib/x402/self-facilitator.js` pins the token program from the mint (`knownTokenProgramForMint`, Token-2022 ATA rent constant). `api/_lib/onchain-allowance.js` has a correct `tokenProgramFor(connection, mint)` helper that reads the mint owner (not exported as shared).
- Still legacy-program only (no program argument to `getAssociatedTokenAddressSync` / `createTransferCheckedInstruction`): `api/_lib/solana/gasless-tx.js` (lines ~115, 116, 139, the `transferChecked` calls), `api/marketplace/purchase-as-agent.js` (~240), `api/purchase/skill.js` (~194), `api/subscriptions/subscribe.js` (~194, 196, 206).
- `api/_lib/premium.js` `createQuote()` hardcodes `TOKEN_PROGRAM_ID` for the pass payment ATA derivation, ATA creation and `transferChecked` (lines ~241-247). `verifyPassPayment()` is balance-delta based and needs no change.
- `api/_lib/solana/solana-pay-verify.js` and `api/_lib/purchase-confirm.js` rely on `@solana/pay` `validateTransfer`; whether the installed version accepts Token-2022 transfer instructions is unverified.
- Production: `GET /api/token/config` shows `treasury_configured:false`, `rewards_configured:false` (owner row 23 in `prompts/finish/_context/production-100-OWNER-ACTIONS.md` covers the two wallet env vars). `GET /api/payments/solana/plans` advertises assets `["USDC","SOL","THREE"]` with no readiness flag. `pages/pricing.html` (~line 1474) throws a generic `checkout failed` on the 503.
- Tests present: `tests/solana-pay-verify.test.js`, `tests/premium-pass.test.js`, `tests/premium-endpoints.test.js`, `tests/subscriptions-endpoints.test.js`, `tests/marketplace-splits.test.js`. None build a Token-2022 transfer.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -rn "getAssociatedTokenAddressSync(\|createTransferCheckedInstruction(\|createAssociatedTokenAccountIdempotentInstruction(" api --include=*.js | grep -v "TOKEN_2022\|tokenProgram\|programId"
grep -n "TOKEN_PROGRAM_ID\|TOKEN_2022" api/_lib/premium.js api/_lib/solana/gasless-tx.js api/marketplace/purchase-as-agent.js api/purchase/skill.js api/subscriptions/subscribe.js
grep -n "TOKEN_PROGRAM\|2022" node_modules/@solana/pay/lib/cjs/validateTransfer.js
curl -s https://three.ws/api/token/config | head -c 400
curl -s https://three.ws/api/payments/solana/plans | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:v for k,v in d.items() if k!='plans'})"
node -e "fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getAccountInfo',params:['FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',{encoding:'base64'}]})}).then(r=>r.json()).then(j=>console.log(j.result.value.owner))"
```

Skip any file the first grep no longer lists.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Extract one shared helper, `api/_lib/solana/token-program.js`, exporting `resolveTokenProgram(connection, mint)` (reads the mint account owner, accepts only SPL Token and Token-2022, caches per mint for the process, short-circuits the known $THREE mint from `THREE_TOKEN_MINT`) and `ataFor(mint, owner, tokenProgram, { allowOwnerOffCurve })`. Make `api/_lib/onchain-allowance.js` and `self-facilitator.js` use it so there is one implementation. Test file: `tests/solana-token-program.test.js` (legacy mint, Token-2022 mint, missing mint, unsupported owner).
2. `api/_lib/solana/gasless-tx.js`: resolve the program once, derive `fromAta`, `creatorAta`, `feeAta` with it, pass it to every `createTransferCheckedInstruction`, and add an idempotent ATA-create instruction for the seller and treasury ATAs when missing (platform payer funds the rent, as the gasless contract states). Keep the reference key on the last instruction (see the existing comment about `validateTransfer`).
3. Same fix in `api/marketplace/purchase-as-agent.js`, `api/purchase/skill.js`, `api/subscriptions/subscribe.js`, and `createQuote()` in `api/_lib/premium.js`.
4. Make `api/_lib/solana/solana-pay-verify.js` and `api/_lib/purchase-confirm.js` accept a Token-2022 `transferChecked` end to end. If `@solana/pay` `validateTransfer` rejects the Token-2022 program, replace that one check with a parsed-transaction check that matches mint, recipient owner, amount and the reference key, keeping every existing strictness rule. Extend `tests/solana-pay-verify.test.js` with a Token-2022 fixture built from a real parsed transaction shape (record one from mainnet with `getParsedTransaction`, do not hand-write fake numbers).
5. Prove it against the real chain at zero cost: write `scripts/verify-token2022-purchase.mjs` that reads the $THREE mint's largest token accounts to find a real holder, builds the gasless purchase transaction and the Premium quote transaction for that holder, and runs `simulateTransaction` with `sigVerify:false` and `replaceRecentBlockhash:true` on mainnet. The script prints the simulation `err` and logs; it never signs or sends. Record the result in the PR description and in the new tests' header comment.
6. Honest pricing: add `checkout_ready: { USDC, SOL, THREE }` to `GET /api/payments/solana/plans` (true only when `getSolanaRecipient()` is set and, for THREE, the mint and quote path are configured). In `pages/pricing.html`, render a disabled option with the line "Not switched on yet" for any asset that is not ready, hide the "20% off in $THREE" claim unless THREE is ready, and replace the generic `checkout failed` with the typed `not_configured` message plus a retry. Test: `tests/payments-solana-plans.test.js` for both states.
7. Do the same readiness flag for the marketplace token rail (`GET /api/token/config` already exposes `treasury_configured`): where the marketplace or skill pages show a $THREE price button, disable it with the same copy when `treasury_configured` is false.
8. Docs and changelog: update `docs/x402.md` or the nearest Solana payments doc with the Token-2022 rule ("never pass a default token program"), add a `data/changelog.json` entry, and refresh the findings table in `marketing/three-utility-season/README.md` so editions 03 and 08 no longer cite the fixed blockers.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -rn "getAssociatedTokenAddressSync(" api --include=*.js | grep -v "tokenProgram\|programId\|TOKEN_"` prints no Solana payment builder.
- [ ] `npx vitest run tests/solana-token-program.test.js tests/solana-pay-verify.test.js tests/premium-pass.test.js tests/subscriptions-endpoints.test.js` passes with a Token-2022 case in each.
- [ ] `node scripts/verify-token2022-purchase.mjs` prints `err: null` for both the gasless purchase and the Premium quote simulation against mainnet.
- [ ] `curl -s <local dev>/api/payments/solana/plans` includes `checkout_ready`, and `/pricing` in a real browser shows the not-ready state with no console errors when `PAYMENT_RECIPIENT_SOLANA` is unset, and the normal state when it is set.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `THREE_TREASURY_WALLET`, `PAYMENT_RECIPIENT_SOLANA` are not set in production | They are owner config (row 23 of the owner-actions table). Build and verify with simulation and tests; set them in a local `.env.local` only for the simulation, and list the two variables in the final report. |
| `@solana/pay` rejects Token-2022 | Replace only the transfer-instruction check with a parsed-transaction check, as in task 4. |
| No funded holder wallet to sign a real purchase | Simulation with `sigVerify:false` against a real holder's public key is the acceptance proof. Do not send a transaction. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Do not send any real transaction or move funds to verify. Simulation only. A real $THREE purchase end to end is an owner-approved action after the treasury is configured.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/282-plan-wallet-token2022-checkout-rails-honest-config.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `282-plan-wallet-token2022-checkout-rails-honest-config.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `marketing/three-utility-season/README.md` (section "What verification found (2026-09-16)")

~~~~markdown
## What verification found (2026-09-16)

Every scheduled surface was traced from `vercel.json` to its handler and exercised against
production. Seven of the twelve scheduled stories could not be run as written (six are substituted, one is narrowed to the MCP server), because the `$THREE`
spend paths are switched off or broken in production. Every hold-based utility checked out. The season
was rebuilt around what works, and each substitution is recorded in its pack.

| Finding | Evidence | Editions affected |
|---|---|---|
| The `$THREE` token payment rail refuses every quote | Signed-in `POST /api/token/quote` returns `treasury_unavailable`; `GET /api/token/config` shows `treasury_configured: false`, `rewards_configured: false` (`THREE_TREASURY_WALLET` and `THREE_REWARDS_WALLET` unset) | 03, 04, 10 (pay-per-use, marketplace, holder rewards) |
| Plan checkout cannot create an intent in any asset | Signed-in `POST /api/payments/solana/checkout` returns `503 not_configured` (`PAYMENT_RECIPIENT_SOLANA` unset) | 02 |
| Marketplace has no confirmed sale, `$THREE` skill prices are not rendered, and the gasless purchase builder uses the legacy token program for a Token-2022 mint | `/api/marketplace/analytics`: `totalSales: 0`; `api/_lib/solana/gasless-tx.js` | 03, 10 |
| Labor market escrow is offline | `/api/labor/feed`: `escrow_configured: false` (`LABOR_ESCROW_SECRET_BASE58` unset) | 04 |
| `/play` token gate is off and boutique sales cannot settle | No `PLAY_GATE_MINT` or `THREE_MINT`; `three-ws-multiplayer` has no `GAME_TOKEN_TREASURY` | 07 |
| x402 advertises `$THREE` but the self-hosted facilitator rejects Token-2022 transfers | `api/_lib/x402/self-facilitator.js` only allows the legacy token program | 08 |
| Holder deploy discount exists only in the MCP server; the browser deployer charges no fee, and `/deploy` is the model viewer | `src/deploy-onchain.js`, `vercel.json` | 06 |
| Premium Data API pass cannot quote `$THREE` and builds with the legacy token program | Signed-in `POST /api/premium/quote` returns `quote_failed` for THREE and USDC (SOL works) | not used |
| Public "burned" figures are computed, not on-chain | `/api/three-token/burns` and `/three-live` report `agents x 1000`; the token config says the platform never burns | 09 (do not cite) |
~~~~

### `marketing/three-utility-season/03-gated-embed-mcp.md` (whole file)

~~~~markdown
# Edition 03: What $THREE does this week, marketplace settlement

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-MARKET` |
| Publish date | 2026-10-02 |
| Chapter | Creation |
| Audience | creators and agents |
| Campaign anchor (campaigns.csv) | https://three.ws/marketplace |
| Surface used in this pack | /docs/mcp (tool `create_gated_embed`) |
| Verified status (2026-09-16) | **Not demonstrable. Substitute used.** |

## Verification

**Substitute:** Marketplace settlement in $THREE has no completed sale to show and its payment rail is switched off. The substitute is the live MCP tool `create_gated_embed`, which lets an agent (or its owner) make holder-only 3D content.

- Planned surface: `GET https://three.ws/api/marketplace/analytics` on 2026-09-16 returned `totalSales: 0`, `uniqueBuyers: 0`, `totalTrials: 11312`, `trialFunnel.converted: 0`.
- Payment rail: signed-in `POST /api/token/quote` (purposes `consumption` and `marketplace_sale`) returned `treasury_unavailable`; `GET /api/token/config` reports `treasury_configured: false`, `rewards_configured: false`.
- Listing UI: an agent with $THREE `skill_prices` in `/api/marketplace/agents/<id>` does not render those prices on its marketplace page, and the Skills tab "Paid" entries are USDC x402 skills.
- Code risk: `api/_lib/solana/gasless-tx.js` builds the purchase transfer with the legacy token program, while the $THREE mint is Token-2022 (confirmed with `getAccountInfo`: owner `spl-token-2022`).
- Substitute: tool definition at `api/_mcp/tools/embed.js` line 227, backed by `api/embed/gate-create.js`; documented at `/docs/mcp` (section `create_gated_embed`, 200 on 2026-09-16). Calling the MCP endpoint requires sign-in (OAuth); an unauthenticated `tools/list` answered with a 402 challenge, so the tool call itself was not exercised in this pass.

## The three questions

- **What can a holder do now?** Connect an MCP client to `https://three.ws/api/mcp`, sign in, and call `create_gated_embed` with an owned `asset_id` and a `min_amount`.
- **Where does $THREE enter?** Held, by the viewer. The gate defaults to the $THREE mint when `mint` is omitted; a viewer must hold at least `min_amount` to open the scene.
- **What verifiable result comes out?** A `gate_id`, the gate terms, and a paste-ready embed snippet that shows a locked teaser below the bar and the live 3D scene above it.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Omitting `mint` defaults the gate to $THREE | `docs/token-gated-3d-embeds.md` and `api/_mcp/tools/embed.js`, captured 2026-09-16 |

## Media

- File: [`images/03-gated-embed-mcp-tool.png`](./images/03-gated-embed-mcp-tool.png), 1600x900, captured 2026-09-16 from `github.com/nirholas/three.ws/blob/main/api/_mcp/tools/embed.js#L227` by `node marketing/three-utility-season/capture.mjs --only 03`.
- Alt text (required on every post):

> Source of the three.ws MCP server on GitHub, file api/_mcp/tools/embed.js, highlighting line 227: name create_gated_embed, title "Create a token-gated embed", with the description "Turn an avatar or on-chain agent you own into a holder-only interactive 3D embed".

## X post

Weighted length: **163 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Agents can gate 3D content too. The three.ws MCP tool create_gated_embed turns an avatar you own into a scene only $THREE holders can open. https://three.ws/docs/mcp?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-market&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: agents that gate content.
The three.ws MCP server has a create_gated_embed tool. Point it at an avatar you own and set a minimum; leave the mint empty and the gate uses $THREE.
The result is an embed snippet that stays locked for wallets below the bar.
Marketplace sales in $THREE are not running yet, so this week shows the part that is.
https://three.ws/docs/mcp?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-market&utm_content=utility-telegram
```

## User action

Connect an MCP client to `https://three.ws/api/mcp`, sign in, and call `create_gated_embed` with an owned `asset_id` and a `min_amount`.

## KPI and where to read it

Gates created by agents. Read UTM sessions for `mkt-2026-10-three-market`; count new rows in `embed_gates` created during the week (1 row existed on 2026-09-16).

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] From a real MCP client, call `create_gated_embed` once end to end and open the returned preview URL.
- [ ] Re-check `/api/marketplace/analytics` and `/api/token/config`. If `totalSales` is above 0 and `treasury_configured` is true, the owner can restore the marketplace story.
- [ ] Re-run `capture.mjs --only 03`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not describe the marketplace as settling in $THREE until a confirmed sale exists.
- Do not quote the trial count as usage.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
~~~~

### `marketing/three-utility-season/08-tier-api-for-agents.md` (whole file)

~~~~markdown
# Edition 08: What $THREE does this week, pay for agent tools over x402

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-THREE-X402` |
| Publish date | 2026-11-06 |
| Chapter | Agent work |
| Audience | agent and API builders |
| Campaign anchor (campaigns.csv) | https://three.ws/x402 |
| Surface used in this pack | `GET /api/three/tier` |
| Verified status (2026-09-16) | **Advertised but not settleable. Substitute used.** |

## Verification

**Substitute:** Paying x402 endpoints in $THREE cannot settle today. The substitute is the public tier endpoint any agent can call to read a wallet's $THREE standing before it serves or discounts a request.

- Planned surface: a 402 challenge from `https://three.ws/api/x402/token-intel` lists a second `accepts` entry with the $THREE mint on Solana (`X402_ACCEPT_THREE_SOLANA` defaults to true in `api/_lib/env.js`).
- Blocker: the configured facilitator is self-hosted (`X402_FACILITATOR_URL_SOLANA=https://three.ws/api/x402-facilitator`). `api/_lib/x402/self-facilitator.js` only accepts transfers under the legacy token program and rejects any other program with `program_not_allowed`. $THREE is a Token-2022 mint, so a $THREE payment cannot pass verification.
- The `/x402` page itself says settlement is "in USDC".
- Substitute: `GET https://three.ws/api/three/tier` answered 200 without auth on 2026-09-16 with `tier`, `next.usd_to_go`, and the ladder; `?wallet=<address>` returned a resolved tier for a mainnet holder.
- Docs gap: this public endpoint is not documented in `docs/api-reference.md`.

## The three questions

- **What can a holder do now?** Call `curl "https://three.ws/api/three/tier?wallet=<address>"` from an agent and branch on `tier.level`.
- **Where does $THREE enter?** Held. The endpoint values the $THREE the wallet holds and returns its level, `discount_bps`, and `rate_multiplier`.
- **What verifiable result comes out?** A JSON tier verdict an agent can act on, with no API key and no signature.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Unauthenticated, `?wallet=` supported, fields `tier`, `next`, `ladder` | live response, 2026-09-16 |

## Media

- File: [`images/08-tier-api.png`](./images/08-tier-api.png), 1600x900, captured 2026-09-16 from `/api/three/tier` by `node marketing/three-utility-season/capture.mjs --only 08`.
- Alt text (required on every post):

> Raw JSON from three.ws/api/three/tier: signed_in false, tier Member, next tier Bronze with usd_to_go 25, and the ladder of Member, Bronze, Silver, Gold, and Genesis with discount_bps and rate_multiplier for each.

## X post

Weighted length: **161 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
An agent can read any Solana wallet's $THREE tier with one unauthenticated GET: level, perks, and the USD still to go. No key, no signup. https://three.ws/api/three/tier?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-three-x402&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: a tier check any agent can call.
GET three.ws/api/three/tier?wallet=<address> returns that wallet's $THREE tier, its perks, and how far it is from the next tier. No key, no signup.
Builders can use it to decide what a holder gets from their own agent or API.
Paying x402 endpoints in $THREE is not working yet; payments settle in USDC today.
https://three.ws/api/three/tier?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-11-three-x402&utm_content=utility-telegram
```

## User action

Call `curl "https://three.ws/api/three/tier?wallet=<address>"` from an agent and branch on `tier.level`.

## KPI and where to read it

External tier reads. Count `/api/three/tier` requests carrying `wallet=` and a non-browser user agent in `three-ws-api` request logs for the week; UTM sessions for `mkt-2026-11-three-x402`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] `curl` the endpoint with and without `?wallet=` and confirm 200.
- [ ] Re-test a $THREE x402 payment. If the facilitator settles one, the owner can restore the x402 story.
- [ ] Re-run `capture.mjs --only 08`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say agents can pay in $THREE over x402.
- The `perks` strings in the JSON include Planned perks; do not quote them as available.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
~~~~

### `marketing/three-utility-season/10-gameready-holder.md` (whole file)

~~~~markdown
# Edition 10: What $THREE does this week, creator earnings and royalties

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-THREE-CREATOR` |
| Publish date | 2026-11-20 |
| Chapter | Creation |
| Audience | 3D creators and community |
| Campaign anchor (campaigns.csv) | https://three.ws/marketplace |
| Surface used in this pack | /three (Game-Ready export perk) |
| Verified status (2026-09-16) | **Not live. Substitute used.** |

## Verification

**Substitute:** Creator earnings in $THREE have no confirmed sale and the payment rail is off (see edition 03). The substitute is the live Game-Ready export holder perk, which gives 3D creators an engine-ready asset by holding Bronze.

- Planned surface: same evidence as edition 03 (`totalSales: 0`, token rail `treasury_unavailable`). The marketplace skill fee knob `MARKETPLACE_PLATFORM_FEE_BPS` is unset, so a sale would pay the full list price to the creator once purchases work.
- Substitute: `api/forge-gameready.js` gates through `forge.gameready`, listed `enforced: true`, minimum Bronze, in `/api/three/access` on 2026-09-16. The client (`src/forge-gameready.js`) sends the tier pass and polls the real remesh job.

## The three questions

- **What can a holder do now?** Generate a model on `/forge`, then press Game-Ready export from a wallet holding Bronze and download the FBX.
- **Where does $THREE enter?** Held. Bronze is verified with a signed tier pass before the retopology job starts.
- **What verifiable result comes out?** A retopologized mesh delivered as GLB plus FBX for Unity or Unreal.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Game-Ready export marked LIVE at Bronze | `/three` captured frame and `/api/three/access`, 2026-09-16 |

## Media

- File: [`images/10-gameready-holder.png`](./images/10-gameready-holder.png), 1600x900, captured 2026-09-16 from `/three (scrolled to the ladder)` by `node marketing/three-utility-season/capture.mjs --only 10`.
- Alt text (required on every post):

> The $THREE tier ladder on three.ws: Bronze lists High-quality generation and Game-Ready export (Unity/Unreal retopo plus PBR), both marked LIVE; Silver, Gold, and Genesis perks such as private worlds, branded worlds, and early access to drops are marked PLANNED.

## X post

Weighted length: **163 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Game-Ready export retopologizes a Forge model into a GLB plus FBX for Unity or Unreal. Holding $25 of $THREE (Bronze) opens it on three.ws. https://three.ws/three?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-three-creator&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: engine-ready exports for creators.
Game-Ready export on three.ws turns a Forge model into a clean GLB plus FBX for Unity or Unreal. Holding $25 of $THREE (Bronze) opens it; the balance is checked, not spent.
Earning $THREE from marketplace sales is not running yet. It will get its own walkthrough when the first sale settles.
https://three.ws/three?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-11-three-creator&utm_content=utility-telegram
```

## User action

Generate a model on `/forge`, then press Game-Ready export from a wallet holding Bronze and download the FBX.

## KPI and where to read it

Game-Ready exports by holders. `forge-gameready` job completions in `three-ws-api` logs for the week; UTM sessions for `mkt-2026-11-three-creator`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Run one Game-Ready export from a Bronze wallet end to end.
- [ ] Re-check marketplace sales. If a confirmed $THREE sale exists, the owner can restore the creator-earnings story.
- [ ] Re-run `capture.mjs --only 10`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not mention royalties, earnings, or payouts.
- Do not describe Planned perks visible in the frame as available.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
~~~~

### `marketing/three-utility-season/02-holder-free-quota.md` (whole file)

~~~~markdown
# Edition 02: What $THREE does this week, lower-cost platform access

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-09-THREE-DISCOUNT` |
| Publish date | 2026-09-25 |
| Chapter | Access |
| Audience | community and creators |
| Campaign anchor (campaigns.csv) | https://three.ws/pricing |
| Surface used in this pack | /forge |
| Verified status (2026-09-16) | **Not live (planned surface is wired but switched off). Substitute used.** |

## Verification

**Substitute:** The planned story, paying for Pro at 20% off in $THREE on `/pricing`, cannot be completed in production today. The substitute is the live holder free-quota multiplier on the free Forge lane, which lowers the cost of access without a payment.

- Planned surface: `/pricing` renders "Pay in USDC, SOL, or $THREE, 20% off in $THREE", and `GET https://three.ws/api/payments/solana/plans` returns `three_discount_bps: 2000` and Pro at $39.20 in $THREE.
- Blocker: a signed-in `POST /api/payments/solana/checkout` with `{"plan":"pro","asset":"THREE"}` returned `503 not_configured: Solana payment recipient not configured` on 2026-09-16 (also for USDC). `PAYMENT_RECIPIENT_SOLANA` is not set on the `three-ws-api` Cloud Run service (`api/payments/_config.js`).
- Substitute: `api/forge.js` `freeLaneMultiplier()` lifts the free-lane hourly limit by the tier multiplier from a verified tier pass (`api/_lib/rate-limit.js` `mcp3dGenerateFreeTiered`). The ladder in `/api/three/tier` lists `rate_multiplier` 2, 3, 5, 10. The `/forge` page shows "Hold $THREE for up to 10x free generations".

## The three questions

- **What can a holder do now?** Open `/forge`, connect a wallet holding at least Bronze, and generate past the default hourly free limit.
- **Where does $THREE enter?** Held, not spent. A signed tier pass derived from the wallet's $THREE balance travels with each free generation request and raises that wallet's hourly free limit.
- **What verifiable result comes out?** More free generations per hour for the same wallet: 2x at Bronze, 3x Silver, 5x Gold, 10x Genesis.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Multipliers 2x / 3x / 5x / 10x | `/api/three/tier` `rate_multiplier`, captured 2026-09-16 |
| "Hold $THREE for up to 10x free generations" on `/forge` | captured frame, 2026-09-16 |

| Volatile figure (read on posting day) | Source |
|---|---|
| The base hourly free limit is deployment config (`FORGE_FREE_HOURLY_SELFHOST`); do not quote an absolute number | n/a |

## Media

- File: [`images/02-holder-free-quota.png`](./images/02-holder-free-quota.png), 1600x900, captured 2026-09-16 from `/forge` by `node marketing/three-utility-season/capture.mjs --only 02`.
- Alt text (required on every post):

> The three.ws Forge page: a prompt box, quality options Draft, Standard, and High with a $THREE badge, a Generate button, and a line under it reading "Hold $THREE for up to 10x free generations" next to a Connect wallet button.

## X post

Weighted length: **170 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Holding $THREE lifts your free Forge generation limit: 2x at Bronze, up to 10x at Genesis. Nothing is spent; the balance is read from your wallet. https://three.ws/forge?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-09-three-discount&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: more free generations.
Forge on three.ws is free to use. Holding $THREE raises how many free generations your wallet gets per hour: 2x at Bronze ($25 held), up to 10x at Genesis.
Nothing is spent. Connect a wallet on three.ws/forge and generate.
Paying for Pro in $THREE is shown on /pricing but checkout is not switched on yet, so this week is about holding.
https://three.ws/forge?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-09-three-discount&utm_content=utility-telegram
```

## User action

Open `/forge`, connect a wallet holding at least Bronze, and generate past the default hourly free limit.

## KPI and where to read it

THREE-tier free generations. Read UTM sessions for `mkt-2026-09-three-discount`; read generations by tier from `forge_creations` (backend and status per generation) joined with tier-pass usage in `/api/forge` logs. Checkout completions stay at zero until the recipient is configured.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Re-test the planned story: signed-in `POST /api/payments/solana/checkout` with asset THREE. If it now returns an intent, the owner may switch this edition back to the `/pricing` story (the frame and copy would need re-capture and rewriting).
- [ ] Confirm `/forge` still shows the "up to 10x free generations" line.
- [ ] Re-run `capture.mjs --only 02`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say "pay in $THREE for 20% off" until a real checkout completes.
- Do not quote an hourly generation number.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
~~~~

