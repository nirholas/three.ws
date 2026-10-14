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
