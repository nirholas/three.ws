# Re-verify every Robinhood Chain standalone repo builds and tests green against the current chain endpoints

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/778-plan-robinhood-standalone-repos-reverify.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 25 of 100 inside the tier). **Area:** robinhood. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`robinhood/` holds 17 standalone Robinhood Chain packages (hood-js, hood-cli, hood-mcp, hood-pay, hoodkit, hood-launcher, hood-alerts, hood-traders, hood402, erc8056 and more). They were generated from the plan in `prompts/robinhood-chain/` and nothing guarantees they still build or work against the live chain RPC and token list. Robinhood here means Robinhood Crypto only; Solana stays the lead rail and these are secondary EVM surfaces.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- 17 directories under `robinhood/`; each should carry its own README, tests and package.json (verify).
- No aggregate verify script located; check `package.json` for `robinhood`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
ls robinhood; grep -n -i robinhood package.json | head
for d in robinhood/*/; do [ -f $d/package.json ] && (cd $d && echo == $d && npm test --silent 2>&1 | tail -3); done
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add `scripts/verify-robinhood-repos.mjs` that, per package, runs install (offline cache ok), build and test, and probes the documented RPC and tokenlist endpoints with plain GETs/`eth_chainId`; prints a table; exits non-zero on failure.
2. Fix each failure at the root (stale chain id, RPC URL, ABI, dependency drift). Test-first for any logic bug.
3. Make sure each README states install, usage and the verify command; remove dead links.
4. Changelog only if a user-visible package changed. Commit gate: none (Robinhood Crypto is platform scope).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/verify-robinhood-repos.mjs` exits 0 with 17 rows.
- [ ] Each package's own `npm test` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Public RPC rate limited | Retry with backoff, use the endpoint list in the repo README; record the endpoint used. |
| A package has no tests | Write minimal real tests against its public API (no mocks of the chain; use read-only RPC calls). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/778-plan-robinhood-standalone-repos-reverify.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `778-plan-robinhood-standalone-repos-reverify.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `robinhood/README.md` (whole file)

~~~~markdown
# robinhood/: the Robinhood Chain suite

Everything three.ws builds for **Robinhood Chain** (Robinhood's Arbitrum
Orbit L2, chain ID 4663): Robinhood Crypto only. Solana remains the home
chain; these are additional crypto surfaces, and each subproject below has its
own README with install and usage.

> **Reference copies, not the source of truth (updated 2026-10-14):** every
> package below is also a standalone GitHub repo (`nirholas/robinhood-chain-*`,
> listed with `direction: "in"` in [`data/standalone-mirrors.json`](../data/standalone-mirrors.json)),
> and those standalone repos are where each package is developed and
> published to npm. The copies in this directory are read-only snapshots kept
> for reference inside the monorepo; they drift from their standalone repos
> between manual re-syncs, sometimes by hundreds of lines (see
> [`npm run mirrors:drift`](../scripts/mirror-drift-report.mjs)). Do NOT `npm
> publish` from here: you would ship stale code over a newer release. Sync from
> the standalone repo (or the published tarball) first if a release must
> happen from this tree.
>
> Two standalone repos duplicate another one under a different name
> (`robinhood-chain-alert-bot` duplicates `robinhood-chain-alerts`;
> `robinhood-chain-trading-bot` duplicates `robinhood-chain-traders`, both
> pairs titled identically on npm, `hood-alerts` and `hood-traders`). The
> duplicates have pointer READMEs staged under `dist/retired-repos/` for the
> owner to push and archive; `robinhood-chain-alerts` and
> `robinhood-chain-traders` stay the ones this directory mirrors.
>
> The one package production actually imports,
> [`robinhood-chain-sdk`](robinhood-chain-sdk/) (npm name `hoodchain`), is
> consumed by [`workers/robinhood-feed`](../workers/robinhood-feed/) as a
> normal pinned npm dependency, not a `file:` link into this directory: the
> worker always runs the published release, never whatever happens to be
> checked out here.

## Developer tooling

| Project | What it is |
| --- | --- |
| [robinhood-chain-sdk](robinhood-chain-sdk/) | The TypeScript SDK for Robinhood Chain |
| [hood-js](hood-js/) | Five-lines-to-your-first-trade wrapper around the SDK |
| [hood-cli](hood-cli/) | Command-line toolkit |
| [hoodkit](hoodkit/) | Power-user toolkit |
| [hood-connect](hood-connect/) | Add-to-wallet / connect helpers |
| [robinhood-chain-examples](robinhood-chain-examples/) | Runnable example projects |
| [learn-robinhood-chain](learn-robinhood-chain/) | The learning site for building on the chain |

## Data + infrastructure

| Project | What it is |
| --- | --- |
| [hood-api](hood-api/) | Hosted market-data API |
| [hood-status](hood-status/) | Status page for the chain |
| [hood-tokenlist](hood-tokenlist/) | Canonical token list |
| [hood-alerts](hood-alerts/) | Alerting |
| [hood-mcp](hood-mcp/) | MCP servers exposing chain data + actions to agents |

## Payments + agents

| Project | What it is |
| --- | --- |
| [hood402](hood402/) | x402 payment rail for USDG on Robinhood Chain |
| [hood-pay](hood-pay/) | Checkout-grade USDG payments |
| [hood-traders](hood-traders/) | Autonomous trading agent fleet |
| [hood-launcher](hood-launcher/) | Token launcher |
| [erc8056](erc8056/) | Reference implementation of ERC-8056 (Scaled UI amounts) |

The platform's Robinhood feed worker lives separately at
[workers/robinhood-feed/](../workers/robinhood-feed/); chain-priority rules
for the whole workspace are in [CLAUDE.md](../CLAUDE.md).
~~~~

### `prompts/robinhood-chain/PLAN.md` (whole file)

~~~~markdown
# Robinhood Chain Campaign - Research + Build Plan

> Drafted 2026-07-11 from a 4-agent research sweep (chain facts, GitHub, npm, infra/gap landscape).
> COMMIT GATE: everything in this campaign references a non-$THREE crypto project. Per CLAUDE.md,
> no commit ships without explicit owner approval of that content. Owner directed this campaign
> on 2026-07-11; confirm approval per-commit or get a blanket sign-off before the first push.

## Ground truth (verified 2026-07-11)

- **Mainnet LIVE since 2026-07-01.** Permissionless Arbitrum Orbit L2, settles to Ethereum,
  blobs DA, ETH gas, 100ms blocks, ERC-4337 supported.
- **Chain ID 4663** (mainnet) / **46630** (testnet). Public RPC `https://rpc.mainnet.chain.robinhood.com`,
  Alchemy is the recommended provider (`robinhood-mainnet.g.alchemy.com/v2/{key}`), Blockscout
  explorer + Pro API at `robinhoodchain.blockscout.com`, public sequencer feed
  `wss://feed.mainnet.chain.robinhood.com`. Testnet faucet drips ETH + test Stock Tokens
  (TSLA, AMZN, PLTR, NFLX, AMD): `https://faucet.testnet.chain.robinhood.com/`.
- **`viem@^2.55.0` ships `robinhood` + `robinhoodTestnet` chain defs** (published 2026-07-08).
  No custom chain config needed anywhere.
- **Assets:** ~95 tokenized Stock Tokens (plain ERC-20, 18 decimals, each with a live Chainlink
  price feed; corporate actions via ERC-8056 `uiMultiplier()`); **USDG** (Paxos) is the dollar
  rail (>$260M week one); **no native chain token** (airdrop talk is pure speculation).
  Memecoin meta is real: $560M+/day DEX volume, NOXA + "The Odyssey" pump.fun-style launchpads
  graduating coins to Uniswap v3, CASHCAT hit ~$150M cap.
- **Programmatic trading is open:** Uniswap v2/v3/v4 + UniswapX, 1inch, Arcus (zero-fee stock
  DEX), Lighter (perps), Morpho are live. Stock Tokens are standard transferable ERC-20s.
- **Compliance line:** Stock Tokens may not be offered/sold to US persons (also CA/UK/CH limits).
  Enforced legally + at issuance/front-ends, not at contract level. Memecoins carry no such
  restriction. → Stock Token BUY flows must be geo-gated; display/data is fine; memecoin swaps
  are unrestricted.
- **Official tooling vacuum:** no Robinhood SDK, no official chain MCP (their Trading MCP at
  `agent.robinhood.com/mcp/trading` is brokerage-only, US-only), no market-data REST API for
  Stock Tokens, no launchpad firehose, chain absent from Graph Studio. Robinhood's GitHub org
  has zero original chain repos.
- **Ecosystem is ~2 weeks old:** ~40 repos, almost all 0-star. Standouts: `nhevers/project-r0x`
  (MIT, 122★, x402 facilitator + USDG agent OS on chain 4663 - the one serious competitor,
  squarely in our x402 lane), `arambarnett/robinhood-chain-mcp` (MIT, read-only chain MCP),
  `ismailmoazami/robinhood-chain-quickstart` (MIT Foundry template),
  `BankrBot/skills` hoodmarkets pack (known-contracts.json = Stock Token address source).
  `adrydevel/robinhood-chain-sdk` audited from the author's own zip 2026-07-11: VAPORWARE
  (fake chain ID 64288, dead RPC domain, placeholder addresses, padded tests) - build
  clean-room, do not fork.
- **Data providers we already integrate cover the chain:** DefiLlama has chain/RWA/bridge pages
  (our fixture already carries chainId 4663), CoinGecko API has live+historical chain data plus
  "Robinhood Chain Meme" and "Robinhood Chain Stocks Ecosystem" categories, GeckoTerminal +
  DEXTools track its pools, Dune has full support.
- **Distribution:** Robinhood committed $1M to Arbitrum Open House 2026 (4 buildathons + 2
  founder houses). Priority verticals: DEXs, perps, lending.

## Confirmed market gaps (nobody has these)

1. Unified tokenized-equity market-data API (Robinhood + xStocks + Ondo in one schema:
   price, 24/7 candles, holders, DEX volume, premium/discount vs underlying, multipliers).
   RWA.xyz is enterprise-paid; CoinGecko has no equity semantics.
2. Cross-venue tokenized-stock screener ("DEX Screener for equities") with arb/premium alerts.
3. MCP server + agent tooling for the chain itself (not the brokerage).
4. Portfolio tracking that reads `uiMultiplier()` correctly (every generic tracker misstates
   balances after splits/dividends).
5. Launchpad/memecoin WebSocket firehose (PumpPortal-equivalent) - raw material is the public
   sequencer feed + Blockscout.
6. x402-payable APIs on/for the chain (r0x is day-one; no incumbent).
7. A polished chain SDK on npm (zero exist).
8. Wallet/onboarding kit (no wagmi connector kit; 4663 is not a default network anywhere).
9. Canonical tokenlist, alert bots, chain status page, USDG human-checkout - all absent.

## Workstreams

The pack expanded into 19 prompts - see [00-INDEX.md](00-INDEX.md) for the authoritative list,
waves, and status. Original workstream sketch (RH-01…RH-08) for context:

- **RH-01 Chain plumbing** → shipped inside the core SDK (prompt 01, BUILT 2026-07-12).
- **RH-02 Market Data API + x402** → prompts 04 (standalone hood-api) + 12 (three.ws api/v1).
- **RH-03 SDK** → prompts 01/02/03 (core, hood-js, hoodkit).
- **RH-04 MCP + agent skill** → prompt 06.
- **RH-05 /markets display** → prompt 12.
- **RH-06 Purchase flow** → prompt 12 (memecoins open; Stock Tokens display-only pending owner).
- **RH-07 /play worlds + firehose** → prompt 13.
- **RH-08 x402 USDG settlement rail** → prompt 05 (+ INTEGRATION.md seam for three.ws).
- Later additions: 07 traders, 08 launcher, 09 examples, 10 tutorials, 11 CLI, 14 connect kit,
  15 tokenlist, 16 alerts, 17 erc8056, 18 status, 19 hood-pay.

## Sequencing

Wave 1 (done) → Wave 2 (libraries/infra) → Wave 3 (applications + three.ws surfaces) →
Wave 4 (tutorials last). Marketing: X thread per phase (x-posting playbook); submit toolkit to
Arbitrum Open House buildathons for distribution; list hood-api on x402 bazaars/x402scan;
register MCPs in the modelcontextprotocol registry + Smithery.

## Owner decisions needed
1. Blanket commit approval for Robinhood Chain content in this campaign, or per-commit sign-off?
2. Stock Token purchase geo-gating: US-block buy UI only, or display-only at launch?
3. Funded settlement wallet on chain 4663 (ETH gas float + USDG) for hood402/hood-pay mainnet.
4. npm publish token (all packages ship publish-ready).
5. Testnet faucet requires Turnstile + Google Sign-In in a real browser - grab funds once for
   the shared test wallet, or approve an alternative funding path.
~~~~

### `prompts/robinhood-chain/00-INDEX.md` (whole file)

~~~~markdown
# Robinhood Chain pack: execution index

Robinhood in this workspace always means **Robinhood Crypto**, never equities or options
(`CLAUDE.md`). Chain facts live in [_shared.md](_shared.md); the research behind the campaign is
in [PLAN.md](PLAN.md). Facts in those two files override training data.

## State: every work order in this pack has shipped and been retired

All 19 numbered work orders were completed and their files removed from the working tree; each
remains readable in git history (`git log --diff-filter=D --name-only -- prompts/robinhood-chain/`).
What they produced is on disk:

| Product | Folder | Kind |
|---|---|---|
| Core TypeScript SDK | `robinhood/robinhood-chain-sdk/` | standalone repo |
| Simple wrapper | `robinhood/hood-js/` | standalone repo |
| Advanced toolkit | `robinhood/hoodkit/` | standalone repo |
| Market-data API + x402 | `robinhood/hood-api/` | standalone repo |
| x402 USDG rail | `robinhood/hood402/` | standalone repo |
| MCP servers | `robinhood/hood-mcp/` | standalone repo, published to npm |
| CLI toolkit | `robinhood/hood-cli/` | standalone repo |
| Wallet and onboarding kit | `robinhood/hood-connect/` | standalone repo |
| Canonical token list | `robinhood/hood-tokenlist/` | standalone repo |
| ERC-8056 reference | `robinhood/erc8056/` | standalone repo |
| Chain status page | `robinhood/hood-status/` | standalone repo |
| Trading agents | `robinhood/hood-traders/` | standalone repo |
| Coin launcher | `robinhood/hood-launcher/` | standalone repo |
| Alert bots | `robinhood/hood-alerts/` | standalone repo |
| USDG checkout | `robinhood/hood-pay/` | standalone repo |
| Examples gallery | `robinhood/robinhood-chain-examples/` | standalone repo |
| Tutorial site | `robinhood/learn-robinhood-chain/` | standalone repo |
| In-repo markets board | `pages/markets.html`, `api/v1/robinhood/*`, route `/markets/robinhood` | three.ws surface |
| In-repo coin worlds and firehose | `api/robinhood/play-worlds.js`, `api/robinhood/coin-trades.js`, `workers/robinhood-feed/` | three.ws surface |

## What is left, and it is all owner-side

None of these is agent-executable from this machine:

1. **npm publish.** Every package is publish-ready (`npm pack` clean, `files`, `exports`,
   `types` set). The owner holds the token: `npm publish --access public` per package.
2. **GitHub Pages.** Each standalone repo ships a static `docs/` site. Enable Settings, Pages,
   main branch, `/docs` after the repo is pushed. No GitHub Actions anywhere in this project.
3. **Repo extraction and push.** The folders under `robinhood/` deliberately have no `.git`.
   The owner extracts and pushes them.
4. **Testnet faucet funding.** The official faucet requires Turnstile plus Google Sign-In in a
   real browser, so a shared test wallet must be funded once by hand.

## If you want an agent pass over this pack

There is no open work order, so give a specific instruction instead. Useful ones:

- "Re-verify every repo under `robinhood/`: install, build, test, `npm pack`, and report which
  ones are still green." Real on-chain reads against mainnet 4663 are free and unblocked.
- "Refresh `_shared.md` against the live chain and the current viem chain defs."
- "Audit the in-repo `/markets/robinhood` surface against the live APIs and fix what drifted."

## Non-negotiables recap

- Standalone repos live under `robinhood/<name>/`, MIT, copyright 2026 nirholas, no `git init`
  inside them and no commits from an agent.
- **Commit gate:** everything in this campaign references a crypto project other than `$THREE`,
  so no commit that touches it ships without explicit owner approval (`CLAUDE.md`).
- Stock Token display is unrestricted; any buy or swap flow carries the eligibility disclosure
  and a config-level geo gate. Memecoins carry no such restriction.
- Done means tested, with real on-chain evidence, docs, and a report. Format in `_shared.md`.
~~~~

