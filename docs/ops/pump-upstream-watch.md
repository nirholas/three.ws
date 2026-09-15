# Pump.fun upstream watch

This is the operating contract for keeping three.ws and the public `nirholas`
Pump.fun ecosystem current with official npm packages and public repositories.

## Automated signal

Run the same check locally that GitHub runs every day:

```bash
npm run pump:watch
```

The command discovers every current `@pump-fun/*` npm package, compares their
`latest` tags and every public repository under `pump-fun` with
`data/pump-upstream-baseline.json`. A new package, package version, removed
package, new repository, removed repository, or repository push exits with
status 2 and prints a review report. `.github/workflows/pump-upstream-watch.yml`
runs it daily and opens or refreshes one GitHub issue instead of creating
duplicate alerts. Dependabot separately opens dependency pull requests for
`@pump-fun/*`.

After reviewing and integrating an upstream change, acknowledge the exact
state in the same pull request:

```bash
npm run pump:watch -- --accept
```

IDL refreshes are deterministic and use the official public docs first:

```bash
npm run pump:refresh-idls
```

## Manual audit - 2026-09-14

The audit queried all 309 public `nirholas` repositories, selected 32 whose
name, description, or topics mentioned Pump.fun, memecoins, Solana launching,
or creator rewards, then searched their checked-out public source. Twenty-seven
contained Pump.fun code or documentation:

- SDK and transaction builders: `pump-fun-sdk`, `pump-swap-sdk`,
  `pumpfun-rust-client`, `agent-payments-sdk`, `atomic`, `pumpvault`,
  `solana-sniper-mcp`.
- Monitoring, claims, and market intelligence: `pumpkit`,
  `pumpfun-claims-bot`, `pumpfun-github-claims`, `pumpfun-creator-rewards`,
  `alerts-mcp`, `pumpfun-mcp`, `pump-fun-workers`, `oracle-model`, `kol-quest`,
  `visualize-web3-realtime`, `boosty`.
- Agent, launch, and UI surfaces: `three.ws`, `avatar-agent-mcp`,
  `solana-launchpad-ui`, `launch-relay`, `clash-mcp`, `pump-fun-skills`,
  `memescope-monday-directory`, `analyze-memecoin-socials`,
  `robinhood-chain-alerts`.

The package consumers needing follow-on repository-specific updates were:

| Public repository | Observed dependency before this wave |
|---|---|
| `pump-fun-sdk` | `@pump-fun/pump-swap-sdk ^1.19.0` |
| `pumpvault` | `@pump-fun/pump-sdk ^1.36.0`, swap SDK `^1.16.0` |
| `solana-sniper-mcp` | Pump SDK `^1.36.0`, swap SDK `^1.19.0` |
| `agent-payments-sdk` | Pump SDK `^1.35.0` in the standalone public checkout |
| `atomic` | `@nirholas/pump-sdk ^1.30.0` |
| `avatar-agent-mcp` | `@nirholas/pump-sdk ^1.30.0` |
| `pumpkit` | `@nirholas/pump-sdk ^1.30.0` |

Repository names alone are not treated as proof of an integration. The five
description/topic candidates with no matching public source were excluded from
the implementation inventory.

## Current upstream feature boundary

`@pump-fun/pump-sdk 2.0.0` adds protocol-native holder-reward coins, deprecates
cashback for new launches, consolidates creator/fee changes into the CTO flow,
and expands bonding-curve, global, trade, and admin event layouts.
`@pump-fun/pump-swap-sdk 1.20.0` adds current quote-mint-aware fee collection,
canonical pool derivation, and pricing/state support.

three.ws exposes holder-reward creation through connected-wallet, autonomous
agent-wallet, and x402 paid launch paths. Its fee inspector identifies the
holder-rewards destination and does not present creator-only claim or delegation
controls for those coins.
