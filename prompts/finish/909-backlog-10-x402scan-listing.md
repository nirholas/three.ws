# 10. Finish the x402scan listing

Read [00-INDEX.md](_context/backlog-00-INDEX.md) first.

> **Commit gate.** This touches a third-party registry. Any commit into three.ws
> whose diff names it needs owner approval first.

## Where this stands (re-measured 2026-09-02)

The indexer lists settlements per facilitator address from a registry in the
upstream repo. Our self-hosted Solana facilitator settles from fee payer
`WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`.

**The facilitator listing is done and live.** PR #1032 **merged 2026-08-11**
with no review requested, so the reviewer-verification comment that blocked
this for six weeks was never needed and is now moot. Measured the same day, all
without credentials:

| Fact | Value | How it was read |
|---|---|---|
| PR #1032 | `MERGED` 2026-08-11T20:01:45Z, 4 commits, 0 reviews | `gh pr view 1032 --repo Merit-Systems/x402scan` |
| Facilitator page | live, both fee payers rendered | `https://www.x402scan.com/facilitator/three-ws` |
| Attribution | 18,636 transactions, $1,055.01 USDC, latest settle same day | that page's payload |
| Origin listing | 60 resources, none deprecated, re-crawled by them 2026-08-27 | `https://www.x402scan.com/server/17cbd874-52ac-4920-a020-b22ff2489a07` |
| Discovery crawl | 46 pages, 4,519 items, `total` stable, 0 duplicate identities | their `listAllFacilitatorResources` replayed against production |
| Config URLs | `/supported` 200, logo 200, `docsUrl` 200 | `curl` |
| CDP Bazaar | three.ws in 0 of 15,127 catalog resources | full paged sweep of the CDP catalog |

Solana settlement is unchanged and still self-hosted. Nothing in this arc has
re-pointed, demoted, or touched the Solana rail, and nothing here should.

## What the re-verify found, and what it fixed

Their registration flow reads **`/openapi.json`**, not the facilitator catalog
(their facilitator crawl is still paused upstream: `FACILITATOR_SYNC_PAUSED =
true` in `apps/scan/src/app/api/resources/sync/route.ts`, re-checked
2026-09-02). That document hand-enumerated 24 of the 75 live paid services, so
52 endpoints answered a spec-valid 402 in production while being impossible to
register. That is why the origin has sat at 60 resources since 2026-07-11.

Fixed in the tree, not yet deployed: `catalogPaidPaths()` in
[api/openapi-json.js](../../api/openapi-json.js) projects every live paid
service from `api/_lib/service-catalog/` into the document, spread before the
hand-authored paths so the 24 richer entries keep their exact wording.
`/api/x402/*` operations went 24 → 79, with zero change to any existing path.
Five guards in [tests/openapi-aggregator.test.js](../../tests/openapi-aggregator.test.js)
keep it from reopening.

## What remains (re-measured 2026-09-09)

1. ~~**Deploy.**~~ **Done.** The `/openapi.json` fix shipped on 2026-09-08
   (production `880bdcef8`, revision `three-ws-api-00418-j26`). The document now
   declares **82** paid `/api/x402/*` paths, not 24.
2. **Register the missing resources** (owner: one SIWX wallet signature, no
   funds move). This is the ONLY remaining step. Run
   `npm run preview:x402scan-registration` first: it reproduces x402scan's
   classify/probe/deprecate pipeline against live production and, on 2026-09-09,
   reported 123 registrable endpoints declared, 63 already listed, **60 rows
   added and 0 deprecated**, with 59 of the 60 answering a spec-valid 402 to a
   bare probe. The zero is the safety property, so re-run the preview
   immediately before signing and stop if it is no longer zero. Then use "Add
   API" for origin `https://three.ws` at
   <https://www.x402scan.com/resources/register>. Wallet sign-in is a signature,
   not a spend, but it binds an identity: render what is being signed and get an
   owner yes.
3. **The "five blocked endpoints" line was wrong and is retired.** Re-probed
   2026-09-09: `dance-tip`, `feed-health` and `spend-session` all answer a
   spec-valid 402 advertising USDC and $THREE on Solana mainnet, so they are
   probe-registerable today. The sponsor floor bites at settle time, not at
   challenge time (`/api/healthz` reports `x402.self_facilitator.settle` at
   84 ok / 366 failed, every failure `fee_wallet_below_floor`), which stays work
   order 01's capital problem. `ring-settle` and `three-buy` also answer 402 but
   are `discoverable: false` internal ring machinery, deliberately absent from
   the service catalog so `catalogPaidPaths()` never projects them. Listing them
   would let dogfooded volume masquerade as organic demand. **Leave them out.**
   One endpoint genuinely will not probe-register and should not: `GET
   /api/x402/vanity-premium` browses the inventory for free and only
   `?address=<base58>` triggers the 402, so their required-params-only probe
   sees the free mode. Marking `address` required would be a lie about the route.
4. **Optional Base leg.** three.ws is in none of the CDP Bazaar's 15,127
   resources, exactly as documented: indexing is triggered by a settle through
   the CDP facilitator on Base, and production has no `X402_BUYER_PRIVATE_KEY`
   to pay from. It is a nice-to-have. **Never re-point Solana settlement to a
   third-party facilitator for visibility.** Listing is additive, Solana stays
   self-hosted, and an EVM-only directory is a footnote, not a goal.

## Verify

```sh
gh pr view 1032 --repo Merit-Systems/x402scan --json state,mergedAt
curl -s https://three.ws/api/x402-facilitator/discovery/resources \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['pagination']['total'], 'resources')"
curl -s https://three.ws/openapi.json \
  | python3 -c "import json,sys; p=json.load(sys.stdin)['paths']; print(len([k for k in p if k.startswith('/api/x402/')]), 'paid paths')"
npm run preview:x402scan-registration
npx vitest run tests/openapi-aggregator.test.js tests/service-catalog.test.js
```

The third command read 24 before the 2026-09-08 deploy and reads 82 now. The
fourth is the one to trust before spending the signature: it must report 0 rows
would be deprecated.

## Definition of done

- [x] PR #1032 state re-read and reported: merged 2026-08-11, attribution live.
- [x] The verification comment is moot; the PR merged without it.
- [x] The discovery endpoint's live output matches what the PR registers,
      proven by replaying their own crawler against production.
- [x] Solana settlement unchanged and still self-hosted.
- [x] The deploy landed 2026-09-08; `/openapi.json` declares 82 paid paths.
- [x] Registration preview built and validated against x402scan's own discovery
      library (`npm run preview:x402scan-registration`): 60 rows added, 0
      deprecated, 59/60 probe-valid.
- [ ] Origin registration: **owner-gated**, one SIWX wallet signature and
      nothing else. Re-run the preview immediately before signing.
- [x] [PROGRESS.md](_context/backlog-PROGRESS.md) updated.

## Retire this prompt when it is done (required)

1. Verify every Definition of done line against actual command output in front
   of you. Never claim a line you did not verify.
2. Record the outcome in this campaign's PROGRESS or INDEX file if it has one.
3. Commit with explicit paths and a subject that describes the diff (house
   style: type(scope): what changed and why a reader cares), and delete this
   prompt file in that same commit:

       git rm prompts/finish/909-backlog-10-x402scan-listing.md

   A finished order left on disk reads as open work to the next agent, so the
   shrinking directory is the campaign's progress ledger.

If a line genuinely cannot pass inside this session (an external party must
respond, or an owner-gated action is the final step), finish everything else,
leave this file in place, and state exactly which line remains and who owns it.
Never delete this file on a partial.
