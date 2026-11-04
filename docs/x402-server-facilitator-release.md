# @three-ws/x402-server 0.2.0 release steps

Prepared, not executed. Publishing and posting to external channels are owner
actions.

## State

The facilitator extracted from `api/_lib/x402/self-facilitator.js` now lives in
`packages/x402-server/src/facilitator`, exported as
`@three-ws/x402-server/facilitator`. The platform file is a thin adapter over the
same code. Verified locally: `cd packages/x402-server && npm test` (merchant,
attack suite, CLI, per-guard tests) and the root facilitator vitest files.

## Publish

```bash
cd packages/x402-server
npm test
npm pack --dry-run          # confirm bin/, docs/, src/facilitator, examples are listed
npm publish --access public
```

Then verify from a clean directory:

```bash
npx @three-ws/x402-server@0.2.0 attack
```

(prints usage and exits 0). Finish with `npm run check:vendored` and, if your
release flow uses it, `node scripts/publish-packages.mjs`.

## Not yet done

- No end-to-end settle against a live validator or devnet has been run from this
  package. The settle path is covered by a scripted RPC double and by the production
  platform's history. Run the example against devnet and the attack CLI before
  announcing.
- Production settle volume is the platform's own canary loop, not external adoption.
  Say so in any announcement; `GET /api/x402-facilitator/metrics` shows the split.

## Draft: issue for the upstream x402 repository

Title: Reference Solana facilitator with an adversarial test suite

Body:

> We run a Solana x402 facilitator that sponsors fees for buyer-signed transfers, and
> we have published its engine as MIT-style open source (Apache-2.0) in
> `@three-ws/x402-server/facilitator`. Because a sponsoring facilitator pays SOL for
> transactions it did not build, its transaction gate is the security boundary, and
> we found no shared test suite for it.
>
> We built one: 27 hostile transactions (System-transfer drains, priority-fee
> inflation, recipient and mint substitution, ATA rent abuse, lookup-table hiding,
> forged signatures, dust griefing, wallet-guard padding, and more), each with the
> refusal class a hardened facilitator should return. It runs against any
> facilitator over HTTP: `npx @three-ws/x402-server attack --facilitator <url>`, and
> refuses to run against mainnet.
>
> Would the maintainers want the attack cases as a conformance suite alongside the
> Solana scheme spec? Happy to open a PR adapting them to your test layout.
>
> Disclosure: our production volume through this facilitator is our own internal
> payment loop, not third-party traffic. The suite, not the volume, is the point.
