# three.ws in the `pay` registry

This directory holds the three.ws providers for
[`pay-skills`](https://github.com/solana-foundation/pay-skills), the public
registry of stablecoin-gated APIs behind the Solana Foundation's
[`pay`](https://github.com/solana-foundation/pay) CLI and MCP server. Every
agent that runs `pay skills search`, or browses the catalog through
`pay mcp`, finds providers from this registry, and `pay curl` pays their 402
challenges in USDC on Solana.

The layout mirrors the upstream repository exactly, so publishing is a copy:

| Provider (FQN) | Category | What it lists |
|---|---|---|
| [`three-ws/3d`](providers/three-ws/3d/PAY.md) | media | Text and image to 3D, the asset pipeline (rig, remesh, game-ready, stylize, background removal), model inspection, remixes, avatar bodies, token-to-mesh, and the free job-status and remix-feed routes |
| [`three-ws/market-data`](providers/three-ws/market-data/PAY.md) | finance | The paid market data API: coin tables and profiles, price history, sectors, exchanges, derivatives, TVL, yields, stablecoins, fees, DEX volume, exploits, mood, news pulse, token signals |
| [`three-ws/agent-trust`](providers/three-ws/agent-trust/PAY.md) | identity | Agent reputation scores, the agent bouncer, on-chain identity verification, fact checks |

## Do not edit these files by hand

They are generated from the service catalog by
[`api/_lib/service-catalog/pay-skills.js`](../../api/_lib/service-catalog/pay-skills.js).
Paths, input schemas, examples, and prices come from the catalog descriptors and
the same price functions the live 402 challenges use. The listing copy (summaries,
descriptions) lives in that module because the registry has its own rules:
verb-first operation summaries of 24 to 64 ASCII characters, no marketing
language, and a description on every parameter.

```bash
npm run build:pay-skills    # regenerate after a catalog change
npm run check:pay-skills    # fail when the committed files are stale
npm run verify:pay-skills   # regenerate, then run the registry's own validator
                            # with live probes against https://three.ws
```

`verify:pay-skills` runs `pay catalog check` from the pinned `@solana/pay` npm
package, which is the same check the registry runs on every pull request. It
calls each paid endpoint once without payment and requires a 402 that is payable
in USDC on Solana mainnet. It never pays anything. `tests/pay-skills.test.js`
fails the test suite when the committed files drift from the generator.

## Adding a service

1. Make sure the service has a live descriptor in
   `api/_lib/service-catalog/services/` whose accepts builder offers Solana.
2. Add an operation to the right provider in `PAY_PROVIDERS` with a
   verb-first `summary` and a plain `description`. Fill any parameter that has no
   description through `params`.
3. Run `npm run verify:pay-skills` and commit the regenerated files.

## Publishing upstream

Copy `providers/three-ws/` into a fork of `solana-foundation/pay-skills`, run
`pay catalog check providers/three-ws/<name>/PAY.md` there, and open a pull
request. The registry's CI re-probes every listed endpoint before merge. The
runbook and submission log live in `docs/ops/x402-discovery-listings.md`.

## Calling three.ws with `pay`

Once `pay setup` has a funded Solana wallet, any listed endpoint is one command.
`pay` reads the 402, asks you to approve the payment, signs a USDC transfer on
Solana, and retries:

```bash
pay curl 'https://three.ws/api/x402/market-global'
pay curl 'https://three.ws/api/x402/token-intel?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'
pay curl -X POST https://three.ws/api/x402/forge \
  -H 'content-type: application/json' \
  -d '{"prompt":"a brass steampunk owl, full body","tier":"draft"}'
```
