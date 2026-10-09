# Pump.fun upstream watch

This is the operating contract for keeping three.ws current with the official
Pump.fun npm packages and public repositories.

## The check

Run it locally whenever a Pump.fun dependency is in question, and before any
wave of SDK work:

```bash
npm run pump:watch
```

The command discovers every current `@pump-fun/*` npm package, compares their
`latest` tags and every public repository under `pump-fun` with
`data/pump-upstream-baseline.json`. A new package, package version, removed
package, new repository, removed repository, or repository push exits with
status 2 and prints a review report. Nothing runs it on a schedule: this repo
uses no GitHub Actions, and the check writes its baseline back into the repo, so
it belongs in a local run that a human reviews and commits. Dependabot
separately opens dependency pull requests for `@pump-fun/*`.

After reviewing and integrating an upstream change, acknowledge the exact
state in the same pull request:

```bash
npm run pump:watch -- --accept
```

IDL refreshes are deterministic and use the official public docs first:

```bash
npm run pump:refresh-idls
```

## Current upstream feature boundary

`@pump-fun/pump-sdk 4.0.0` and `@pump-fun/pump-swap-sdk 2.1.0` (accepted
2026-10-09) add the 17-account `buy_v3` / `sell_v3` curve trades and PumpSwap
`buy_v2` / `sell_v2`, `multi_hop_swap`, pump coins as quote mints, fees kept on
the curve and pool until a permissionless sweep, and synthetic migration (the
buy that completes a curve keeps buying from the pool's tokens and reports that
part in `PostCompleteBuyEvent`). How three.ws absorbed each part, and the vendored
upstream docs, are in [docs/pumpfun-program/README.md](../pumpfun-program/README.md):
every creator-fee claim, distribution and fee-sharing change sweeps first, every
balance counts unswept fees, and the trade readers fold synthetic migration in.
Our trade builders deliberately stay on `buy_v2` / `sell_v2`, which keep paying
the creator fee per trade.

Earlier: `pump-sdk 2.0.0` added protocol-native holder-reward coins, deprecated
cashback for new launches and consolidated creator/fee changes into the CTO
flow; `pump-swap-sdk 1.20.0` added quote-mint-aware fee collection and canonical
pool derivation.

three.ws exposes holder-reward creation through connected-wallet, autonomous
agent-wallet, and x402 paid launch paths. Its fee inspector identifies the
holder-rewards destination and does not present creator-only claim or delegation
controls for those coins.
