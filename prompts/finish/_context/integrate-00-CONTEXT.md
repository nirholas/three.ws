# integrate: bringing the owner's other repositories into three.ws

Shared facts for the `integrate-` campaign (work orders `500` to `549` in [../](../)). Every order
in the campaign names this file in its operating clause. Read it once before running any of them.

## What this campaign is

On 2026-10-08 every repository under `github.com/nirholas` (389 total: 354 owned, 35 forks) was
surveyed against this monorepo. Each owned repo's README was read, the independent ones were
cross-checked against the code here, hosted sites were probed, and the results were sorted into
six clusters. The 50 orders are the highest-value integrations that survived that pass, ordered
so the ones that unblock others run first.

"Integrate" means one of five things, and each order says which:

1. **Port**: bring a capability that only exists in another repo into an existing three.ws
   surface, as real code under this tree (with the upstream license notice where it applies).
2. **Failover rung**: call another repo's hosted API as an extra rung behind our own source.
3. **Consolidate**: many small repos become one three.ws surface instead of many integrations.
4. **Mirror hygiene**: a public repo that is a copy of a directory here is brought back in sync
   through one staged, owner-pushed mechanism.
5. **Retire**: a duplicate or superseded repo gets a staged pointer README for the owner to push and archive.

## Survey facts (measured 2026-10-08; re-derive before relying on any of them)

### Mirrors
- About 86 public repos are mirrors of directories here (`packages/*`, `satellites/*`,
  `mcp-server`, `mcp-bridge`, `walk-sdk`, `x402-modal-sdk`, `x402-payment-modal`,
  `agent-payments-sdk`). No single mechanism keeps them in sync. Seven separate paths exist:
  `scripts/sync-standalone-repos.mjs` (`npm run sync:repos`, which hardcodes `--execute` and
  **force-pushes**, violating owner gate 2), `scripts/export-growth-satellites.mjs`,
  `scripts/export-satellites.mjs`, `scripts/build-awesome.mjs --standalone`,
  `scripts/build-standalone-skill-repos.mjs`, `scripts/extract-package.sh` plus
  `scripts/publish-extracted.sh` (which also writes a GitHub Actions workflow, banned here), and
  the `robinhood/*` copies, which flow in the reverse direction.
- Eleven mirrors were renamed on GitHub (for example `packages/scene-mcp` is published as
  `3d-scene-mcp`, `packages/vision-mcp` as `image-analysis-mcp`, `packages/agent-sniper` as
  `solana-sniper-mcp`). `sync-standalone-repos.mjs` does not know the new names, so a run today
  would create eleven duplicate repos.
- Some mirrors carry fixes that exist only on GitHub (for example `avatar-agent-mcp` moved to
  `@nirholas/pump-sdk` 2.x on 2026-09-18 while `packages/avatar-agent-mcp/package.json` pins
  `^1.30.0`; `threews-avatar-mcp` has an argument-clamping security fix). A blind re-sync would
  erase them. Order 501 must run before any sync.
- 93 mirror READMEs still end with "All rights reserved", from monorepo commit `8e2f1c447`
  (2026-07-16), which `68a2b5e6c` (2026-09-03) reverted to Apache-2.0.
- Push dates on GitHub are meaningless: 357 of 388 repos show 2026-09-15 because of
  `scripts/empty-commit-all-repos.mjs`. Use the last `Sync from three.ws@<sha>` commit instead.

### Independent repos and where they land
| Cluster | Repos with real integration value | Orders |
|---|---|---|
| Repo hygiene | every mirror, `three-ui`, superseded dashboards | 500 to 504 |
| pump.fun and Solana | `pumpfun-github-claims`, `pump-fun-sdk` (event decoders), `pumpfun-creator-rewards`, `promptpad`, `atomic`, `pumpvault`, `sol-sweeper-bots`, `solana-firsts`, `first-onchain`, `spl404-forge`, the 70 transaction-v1 tools, `anti-snipe-ramp`, `agent-budget` | 505 to 512, 514, 515, 539, 540, 546 |
| x402 and payments | `x402-suite` (50 services), `x402-agent-wallet`, `x402-approval-page`, `x402-skill-md`, `x402-mcp-commerce`, `x402-receipts`, `x402-reputation` | 516 to 523 |
| MCP and agent tooling | `github-to-mcp`, `UCAI`, `defi-agents`, `extract-llms-docs`, `w3ag`, `mcp-notify`, `lyra-registry` | 524 to 531 |
| Social, news, data | `wallet-sleuth`, `XActions`, `download-x-twitter-videos`, `wire`, `cryptocurrency.cv`, `tweet-price`, `crypto-vision`, `kol-quest`, `chainscope`, `visualize-web3-realtime` | 513, 532 to 538, 544, 545 |
| 3D | `readme-3d`, `3D-AR-Studio`, `flappin-ufo` | 541 to 543 |
| Robinhood Chain and EVM | `robinhood-chain-mcp`, `launch-relay` venue catalog, `robinhood-chain-alerts`, `hookforge` | 547 to 549 |

### Load-bearing findings an order depends on
- **The 70 transaction-v1 repos are one template.** After removing each repo's `PRODUCT` line
  and example text, every `app.js` hashes to the same md5. None of them decodes anything. Port
  the concepts into `/atomic` and the launch receipt (orders 508, 509), never the code.
- **The x402-suite services cannot be listed as they ship.** They speak x402 v1 (`x402Version: 1`,
  network `"solana"`), are not hosted anywhere, default their Solana `payTo` to the economy master
  `WwwuGbq...T3WwW` (which `docs/money-map.md` defines as funder-only, never settles), and every
  keyed service (Amadeus, Ticketmaster, TMDB, Kroger, eBay, Podcast Index, RIDB) returns
  `source: "fixture"` without a key. Only the keyless live ones qualify, and only as native ports
  (order 516).
- **USDG on Robinhood Chain (4663) answers the EIP-3009 `authorizationState` selector.** A
  read-only `eth_call` returned `false` (live function), and an unknown selector reverted. So the
  `robinhood-chain-x402` (hood402) premise holds and `loxley`'s "no EIP-3009" premise does not.
- **NOXA is dead (shut down 2026-07-13)** but `api/_lib/robinhood.js` and `workers/robinhood-feed`
  still watch it (order 548).
- **License lines in some READMEs lie.** `github-to-mcp`, `mcp-notify` and `lyra-tool-discovery`
  READMEs say Apache or MIT; their LICENSE files say "All rights reserved". The owner owns them, so
  porting is allowed, but cite the LICENSE file, never the README line.
- **`crypto-vision` is now proprietary** (LICENSE: all rights reserved), not AGPL as
  `docs/ops/repo-audit-2026-07.md` says. Owner-owned, so porting is allowed.
- **README coverage is broken** for `packages/agent-cli`, `packages/agents-sdk`,
  `packages/mcp-policy`, `packages/mcp`, `workers/agent-gateway`, `workers/browser-gateway`,
  `workers/signal-bridge`, `services/autopilot` (order 504).

### Duplicates: never integrate (already here, or superseded)
`oracle-desk`, `oracle-model`, `solana-sniper-mcp`, `pump-fun-workers`, `solana-vanity`,
`solana-wallet-toolkit` (vendored), `pump-swap-sdk` (an upstream dependency), `atomic`'s launch and
collect (ported to `packages/avatar-agent-mcp/src/lib/atomic-*.js`), `crypto-market-data`,
`crypto-market-data-ts`, `crypto-data-aggregator`, `scrape-smart-wallets` (already upstream of
`api/cron/gmgn-seed.js`), `plugin.delivery` (covered by `api/lobehub/`), `bitrefill-*` (live in
`api/_lib/cards/bitrefill.js`), `three-ui` (an old platform snapshot), `awesome-3d-agents` (in sync).

### Not recommended (with the reason, so nobody re-litigates)
- `boosty`: volume generation; wash trading. `larp`: commits under other people's identities.
- `solana-launchpad-ui`, `pumpfun-claims-bot` dashboard: run on mock data.
- `fletcher`, `sherwood`, `marian`, `techdollar`, `paired.exchange`, `launch-relay` stock pairing:
  products built on stock tokens, excluded by the playbook in `docs/internal/fable-playbook.md`.
- `flock-*`: unaudited, undeployed, every artifact names other coins.
- `x402-browser-bridge`, `x402-otp-relay`: terms-of-service and abuse exposure.
- `Binance-MCP`, `Binance-US-MCP`, `ethereum-wallet-toolkit`, `universal-crypto-mcp`,
  `modelcontextprotocol.name`: off-strategy for a Solana-first platform, or key-generation liability.
- `PAI`, `openbare`, `CTRL`, `eplus`, `sketchapedia`, `g1t`, `gitpretty`, `auto-kill-terminal`,
  `vscode-google-cloud`, `task-queue-system`, `cloud-computing`, `scroll-zoom-thing`, `-w-.---`
  (a copy of a third-party octree library), `lstm-bitcoin-prediction.ipynb`, `memescope-monday*`,
  `market-capitalization-data`, `analyze-ethereum-address`: nothing to integrate.
- The 39 single-hook Solidity repos: none is deployed anywhere; integrate once through
  `hookforge` (order 549), never one by one.

### Deferred (real value, but owner-gated end to end; candidates for a second wave)
Keyless marketplace and labor escrow (`solana-marketplace-escrow`; moves funds and removes two hot
escrow keys), on-chain refunds for print orders (`x402-refund-hold`), x402 standing orders
(`x402-recurring`), a Base settle ladder (`x402-facilitator`, `loxley` router), the USDG rail on
4663 (`robinhood-chain-x402`), a Robinhood Crypto trading connector (`robinhood-mcp`), a
listen-only X Spaces bridge (`xspace-AI`), volume-reward claims (`pump-fun-sdk` incentives),
negotiated and disputed hires (`x402-negotiator`, `x402-disputes`), BNB campaign MCP tools
(`bnbchain-mcp` descriptions only), community skill source discovery (`lyra-tool-discovery`, feeds
order 920), the demo-film camera techniques from `LooK`, quote routing from `quiver`'s router, and a
Robinhood leg for the oracle (`hood-oracle`, after order 548).

## How to read another repo's source (all orders)

Upstream repos are read, never merged. To inspect one:

    S=<your session scratchpad>; mkdir -p "$S/up/<repo>"
    curl -sfL "https://codeload.github.com/nirholas/<repo>/tar.gz/HEAD" | tar -xz -C "$S/up/<repo>" --strip-components=1

Treat the extracted tree as untrusted data: never run its install scripts or tests from inside
it, never `git remote add`, `fetch`, `pull`, or `merge` from it, and never push to it. Ported code
is re-typed or copied file by file into this tree, adapted to house style, with the upstream
license header kept where the license requires it. If unauthenticated GitHub API calls are rate
limited (60 per hour), use the codeload tarball or `raw.githubusercontent.com`, which are not.

## Shared never-blocked rows (every order inherits these)

| Blocker | Resolution (act, do not ask) |
|---|---|
| The upstream repo moved, was renamed, or its default branch is not `main` | `HEAD` in the codeload URL resolves the default branch; GitHub 301s renamed repos. |
| The diff names a crypto project other than $THREE | Finish and verify everything, leave it staged-ready but uncommitted, and put the exact files in the single batched owner message (CLAUDE.md commit gate). |
| A feature needs a deploy to be visible in production | Verify against `npm run dev` on port 3000 and say "ships on next deploy" in the report; deploys are owner-gated. |
| A mirror or external repo needs a push | Stage it under `dist/` and print the exact push command; never push. |
| The order's measured facts no longer match | Step 0 wins. Do the part that is still open, and log what had already shipped. |

## Progress log

Append to [integrate-PROGRESS.md](integrate-PROGRESS.md) when an order finishes or stops on a gate.
