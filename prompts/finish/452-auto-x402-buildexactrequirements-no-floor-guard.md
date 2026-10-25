# 452. Four x402 accept builders advertise a sponsored Solana fee payer the facilitator already refuses at the floor gate

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them: it only changes which fields a 402 challenge advertises, it signs nothing and moves no funds.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`curl -s https://three.ws/api/healthz` right now reports the `x402_settle` subsystem **down**, with this hint text verbatim:

    Settles are being REFUSED at the sponsor floor, not withdrawn: 0 no_solana_accept + 22
    floor refusal(s) against 125 rail faults. The Solana accept is still on every challenge
    and buyers are signing real payments; our own facilitator rejects each one at the floor
    gate, because the sponsor fee wallet sits under X402_SPONSOR_SOL_FLOOR_LAMPORTS.

The same response's `x402.self_facilitator` block carries the cumulative counters: `verify.reject_reasons.payer_fee_unfunded: 2117`, `settle.fail_reasons.fee_wallet_below_floor: 112`. Order `902-backlog-01-x402-settle-runway.md` already owns the *funding* side of this (getting SOL into the sponsor wallet, an owner spend action). This order owns a separate, purely-code defect that makes the symptom worse independent of funding: **some of the challenge builders never ask whether the sponsor is below its floor before advertising it as the fee payer**, so even a correctly-topped-up sponsor that later dips under its floor keeps getting offered on these routes, and every one of those offers is a payment the buyer signs and the facilitator then refuses to settle.

The codebase already fixed this exact bug class twice. `api/_lib/x402-paid-endpoint.js`'s `buildRequirements()` (used by `paidEndpoint()`-wrapped routes) and `api/_lib/x402-spec.js`'s `paymentRequirements()` (used by 17 hand-rolled endpoints) both compute a `solanaSelfPayOnly` guard before deciding whether to include `extra.feePayer`:

    const solanaSelfPayOnly =
        resolveSolanaFacilitator().self &&
        (!env.X402_FEE_PAYER_SOLANA || !solanaSettleable() || sponsorKnownBelowFloor());

`tests/x402-selfpay-fallback.test.js` pins this behavior for both functions and documents the history in its header comment: "`buildRequirements` used to DROP the Solana accept entirely when the sponsor was under its SOL floor, so `/club` answered 503 on both the cover charge and every dance tip for four days." That incident was about dropping the accept; the current bug is the opposite shape (keeping the accept but lying about who pays), but it is the same missing-floor-check root cause in sibling code the fix never reached.

Four more builder functions never got this guard, confirmed by direct read today:

1. **`buildExactRequirements()` in `api/_lib/x402-spec.js` (lines 423-453).** Its own header comment says it "Replaces five byte-for-byte copies of this logic (model-check, mint-to-mesh, vanity, vanity-verifiable, mint-to-mesh-batch)" but its Solana branch unconditionally sets `extra: { name: 'USDC', decimals: 6, feePayer: env.X402_FEE_PAYER_SOLANA }` with no call to `sponsorKnownBelowFloor()` anywhere in the function, and its entry guard (`env.X402_FEE_PAYER_SOLANA && solanaSettleable()`) also never falls back to self-pay the way the two correct builders do. Called by `api/x402/model-check.js`, `api/x402/mint-to-mesh.js`, `api/x402/vanity-verifiable.js`, `api/x402/vanity.js`, `api/x402/vanity-premium.js` (five live routes, each via a thin `buildRequirements(resourceUrl, priceAtomics) { return buildExactRequirements(resourceUrl, priceAtomics); }` wrapper, confirmed via `grep -n "buildExactRequirements" api/x402/*.js`).
2. **`api/x402/pipeline.js`'s own hand-rolled `buildRequirements()`.** Independently duplicates the same unconditional `extra.feePayer: env.X402_FEE_PAYER_SOLANA`, does not import or call `sponsorKnownBelowFloor` at all. Backs the paid multi-stage pipeline endpoint.
3. **`api/x402/forge.js`'s own hand-rolled `buildRequirements()`.** Same unconditional `feePayer`, same missing import. Backs the paid Forge 3D-generation tiers, a significant revenue surface (per its own header comment: "Network: Solana mainnet (USDC) only... production sets it, so the live route quotes Solana only").
4. **`api/vanity/drops.js`'s own hand-rolled `buildRequirements()`.** Same unconditional `feePayer` in its Solana push, same missing import.

Confirmed NOT in scope:
- `api/skills/[id]/invoke.js` and `api/x402/mint-to-mesh-batch.js` import `buildRequirements` from `x402-paid-endpoint.js` (the guarded one). Already correct.
- `api/x402/permit2-paid-demo.js` is Base-only (CDP-gated EIP-3009/Permit2), no Solana sponsor logic exists in it.
- This does not touch `902-backlog-01-x402-settle-runway.md` (funding/capital, owner-gated spend) or any dependency-CVE order (444, 449, 450): this is a single missing conditional, duplicated across four call sites, in code that is already fully owned by this repo.

## Task

1. Re-derive current state: `curl -s https://three.ws/api/healthz | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['x402']['self_facilitator'])"` and `grep -n "feePayer: env.X402_FEE_PAYER_SOLANA" api/_lib/x402-spec.js api/x402/pipeline.js api/x402/forge.js api/vanity/drops.js` to confirm all four sites are still present and unguarded before touching anything.
2. Read `api/_lib/x402-spec.js` lines 190-260 (`paymentRequirements`, the reference implementation) and lines 395-460 (`solanaSettleable`, `buildExactRequirements`) in full. Read `api/_lib/x402-paid-endpoint.js` lines 257-382 (`buildRequirements`, the second reference implementation) in full. These two are the templates; do not invent a different guard shape.
3. Read `tests/x402-selfpay-fallback.test.js` in full (167 lines). It already defines `requirementsWith`/`requirements` helpers and a `solanaAccepts()` filter per describe block, mocking `../api/_lib/x402/self-facilitator.js` via `vi.doMock`. Follow the identical pattern for the new tests below; do not build a new mocking strategy.
4. Write the failing tests first, in `tests/x402-selfpay-fallback.test.js`, one new `describe` block per fixed function:
   - `describe('buildExactRequirements shares the self-pay fallback', ...)`: import `buildExactRequirements` from `../api/_lib/x402-spec.js` under the same `vi.doMock` pattern. Assert that with `belowFloor: true` the Solana accept is still present but every accept's `extra.feePayer` is `undefined`, and with `belowFloor: false` it equals `env.X402_FEE_PAYER_SOLANA` (reuse the module-level `SPONSOR`/`USDC` constants already in the file).
   - `describe('pipeline.js buildRequirements shares the self-pay fallback', ...)`: same shape, importing the module's internal `buildRequirements` is not exported today, so instead drive it through the route's exported handler or export `buildRequirements` from `api/x402/pipeline.js` for testability (check whether the file already has a named export block at the bottom; if not, add `export { buildRequirements };` next to the existing function, matching however `forge.js`/`drops.js` already export their internals, if they do).
   - Same for `forge.js` and `drops.js`.
   Run `npx vitest run tests/x402-selfpay-fallback.test.js` now and confirm the four new blocks fail for the stated reason (feePayer present when it should be absent), not for an import/setup error.
5. Fix `api/_lib/x402-spec.js`'s `buildExactRequirements` (lines 423-453): add the same `solanaSelfPayOnly` computation used in `paymentRequirements` (this file already imports `resolveSolanaFacilitator`, `sponsorKnownBelowFloor`, and exports `solanaSettleable`, so no new imports are needed here), widen the entry condition to also admit self-pay when `!env.X402_FEE_PAYER_SOLANA`, and make `extra.feePayer` conditional exactly as `paymentRequirements` does.
6. Fix `api/x402/pipeline.js`: add `import { sponsorKnownBelowFloor } from '../_lib/x402/self-facilitator.js';` and `import { resolveSolanaFacilitator } from '../_lib/x402/ring-config.js';`, add `solanaSettleable` to the existing `import { ... } from '../_lib/x402-spec.js';` block (it is already exported there), compute `solanaSelfPayOnly` the same way, and make the Solana push's `extra.feePayer` conditional on it.
7. Fix `api/x402/forge.js`: identical three additions (same two new imports, `solanaSettleable` added to its existing `x402-spec.js` import block) and the same conditional `feePayer`.
8. Fix `api/vanity/drops.js`: identical three additions (same two new imports, `solanaSettleable` added to its existing `x402-spec.js` import block) and the same conditional `feePayer` in its Solana push.
9. Re-run `npx vitest run tests/x402-selfpay-fallback.test.js`: all pre-existing cases plus the four new blocks must pass.
10. Run `npm run check:rules -- --paths api/_lib/x402-spec.js api/x402/pipeline.js api/x402/forge.js api/vanity/drops.js tests/x402-selfpay-fallback.test.js` and fix anything it flags.
11. Add a `data/changelog.json` entry (tag `fix`) describing that paid Solana routes now fall back to self-pay instead of advertising a sponsor the facilitator will refuse, then run `npm run build:pages` and confirm only the expected generated files change.
12. Read the full diff (`git diff api/_lib/x402-spec.js api/x402/pipeline.js api/x402/forge.js api/vanity/drops.js tests/x402-selfpay-fallback.test.js data/changelog.json`) and confirm every changed line is one of the changes above, with no unrelated reformatting.

## Done when

- `tests/x402-selfpay-fallback.test.js` has four new passing `describe` blocks (one per fixed function) that fail against the pre-fix code for the stated reason (unconditional `feePayer`) and pass after the fix.
- `grep -n "feePayer: env.X402_FEE_PAYER_SOLANA" api/_lib/x402-spec.js api/x402/pipeline.js api/x402/forge.js api/vanity/drops.js` finds no remaining unconditional occurrence; every one is now behind a `solanaSelfPayOnly` (or equivalently-named) conditional.
- `npx vitest run tests/x402-selfpay-fallback.test.js` passes in full, pre-existing cases included.
- `npm run check:rules -- --paths api/_lib/x402-spec.js api/x402/pipeline.js api/x402/forge.js api/vanity/drops.js tests/x402-selfpay-fallback.test.js` reports no violations.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- Nothing outside the five touched source/test files, `data/changelog.json`, and the generated `public/changelog*`/`CHANGELOG.md` files changed.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "The sponsor might be funded again by the time I run this; does the bug still matter?" | Yes. The fix removes a code path that misbehaves *whenever* the sponsor is below floor, regardless of its balance at the moment you run this. Do not wait for or depend on the live balance. |
| "`pipeline.js`/`forge.js`/`drops.js` don't export `buildRequirements` today; can I add an export?" | Yes, do it. Adding a named export for testability is in scope and matches how the already-guarded builders are tested; it is not a behavior change. |
| "Should I also fix the funding shortfall itself (top up the sponsor wallet)?" | No. That is a spend action owned by order 902 and gate 1 in CLAUDE.md. This order only fixes the code that decides what to advertise; it never touches wallet balances. |
| "`buildExactRequirements`'s entry guard currently requires `X402_FEE_PAYER_SOLANA` truthy; widening it to self-pay changes which routes get a Solana accept at all when no fee payer is configured." | That widening is correct and intentional: it brings this function in line with the two already-fixed builders, which both advertise Solana via self-pay even with no fee payer configured. Do it; do not leave this builder narrower than its siblings. |

## Report format

State: which of the four call sites were fixed, the new test count (before/after) in `tests/x402-selfpay-fallback.test.js`, the `check:rules` result, and the commit hash. If the live healthz floor-refusal counters changed between your Step 1 re-measurement and completion, say so in one line; it does not change what to ship.
