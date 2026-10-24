# 415. Fix the x402 catalog self-reject: `transit-delays`'s own example fails its own schema

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: the failing test already exists (`tests/api/x402-discovery-green.test.js`). Confirm it fails for the stated reason before touching the fix, then fix, then confirm green. Commit the test file's unchanged pass alongside the one-line source fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

    npx vitest run tests/api/x402-discovery-green.test.js

As measured 2026-10-24, this fails with exactly one resource flagged:

    ✗ /api/x402/transit-delays: bazaar.info FAILS its own schema → CDP rejects: /input/queryParams/route must be string: expected [ { …(3) } ] to deeply equal []

If this already passes (another agent already shipped an equivalent fix), run `git log --oneline -5 -- api/_lib/service-catalog/services/transit-delays.js` to find the fix commit, confirm it addresses this exact AJV path, and retire this order without a code change per the "Never blocked" table.

Confirm the blast radius this guardrail exists to prevent, by reading the header comment of the failing test file:

    sed -n '1,20p' tests/api/x402-discovery-green.test.js

It states plainly: a single malformed resource (a newline in `payTo`, a `bazaar.info` that fails its own schema, a missing `output.example`) silently delists the entire x402 catalog from discovery indexers (CDP Bazaar/agentic.market, x402scan, 402index), per prior incident, "that's how we once lost all 43 resources to one stray newline." This is a live production risk to every paid endpoint three.ws exposes, not just `transit-delays`.

## Root cause

`api/_lib/service-catalog/services/transit-delays.js` declares `route` as optional (`required: ['stop']` only) but gives it a strict schema type with no null allowed:

    properties: {
      route: { type: 'string', description: 'Optional feed route id to filter by.' },
    },

Its own illustrative example sets the field to `null`:

    input: { stop: 'South Station', route: null, limit: 20 },

That example flows, unmodified, into `api/x402/transit-delays.js`'s `BAZAAR.input.example` and, via `buildBazaarSchema()` in `api/_lib/x402-spec.js` and the discovery-extension builder in `api/_lib/x402/bazaar-helpers.js`, into `bazaar.info.input.queryParams`, which is then validated against `bazaar.info`'s own generated schema (AJV). `null` fails `{type:'string'}`, so the resource's own `bazaar.info` object fails its own schema; CDP's indexer treats that as malformed and drops it (and per the test's precedent, has previously dropped the whole catalog over exactly this class of mismatch).

The sibling file `api/_lib/service-catalog/services/transit-plan.js` has no optional field set to `null` in its example (`input: { from: 'South Station', to: 'Alewife', max: 3 }`), which is why it is not flagged; this bug is isolated to `transit-delays`.

The service's own `outputExample.arrivals[0].routeId` is `'Red'`, confirming `'Red'` is a real, valid MBTA route id already used elsewhere in this same file as an illustrative value.

## Task

1. Open `tests/api/x402-discovery-green.test.js` and run it alone to confirm the exact current failure text matches Step 0 (it may have drifted if another resource regressed since; if a different resource is now flagged, stop and read that resource's file instead of blindly applying the fix below).
2. Open `api/_lib/service-catalog/services/transit-delays.js` line 18. Change

       input: { stop: 'South Station', route: null, limit: 20 },

   to

       input: { stop: 'South Station', route: 'Red', limit: 20 },

   Do not widen `inputSchema.properties.route` to accept `null`. The field is correctly optional via `required: ['stop']`; the bug is the illustrative example using a value the schema does not allow, not the schema being too strict. Widening the schema would let a real caller send `route: null` and have it pass validation only to fail inside the MBTA filter logic in `api/x402/transit-delays.js`; fixing the example is the narrower, correct change.
3. Run `npx vitest run tests/api/x402-discovery-green.test.js` and confirm it passes with zero resources flagged.
4. Run the broader guardrail suite once more to catch any other resource that might share this pattern: `npx vitest run tests/api/x402-discovery-green.test.js tests/x402-spec.test.js` (second file only if it exists; check with `ls tests/ | grep x402-spec` first and skip gracefully if it does not).
5. Grep the rest of `api/_lib/service-catalog/services/` for the same anti-pattern, so this fix is not a one-off that leaves siblings exposed:

       grep -rn ": null" api/_lib/service-catalog/services/*.js

   For each hit, check whether that field is declared with a non-nullable `type` in the same file's `inputSchema`. If any other resource shares this exact defect, fix it the same way (a real example value, not a schema widening) as part of this same order, and re-run the discovery-green test to confirm it stays green.
6. Run `npm run check:rules -- --paths api/_lib/service-catalog/services/transit-delays.js` and fix anything it flags.

## Done when

- `npx vitest run tests/api/x402-discovery-green.test.js` passes in full, including the `transit-delays` resource no longer appearing in the dropped list.
- `git diff` shows only the one-line example fix in `transit-delays.js` (plus any identical fixes found by the sibling grep in step 5, plus whatever `check:rules` required).
- The fix is committed on `evolve` with an explicit-path commit naming the resource and the AJV path that failed.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist) citing the fix commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Another agent already fixed this | Routine for a shared worktree | Re-run step 0's vitest command first; if it already passes, confirm via `git log` the fix covers this exact AJV path, then retire this order without a code change |
| Unsure whether `'Red'` is a real MBTA route id | It already appears as a value in the same file's `outputExample.arrivals[0].routeId`, so it is already the service's own canonical example value | Use it; no external API call needed to verify a value the file itself already asserts is realistic |
| Tempted to make `route` nullable in the schema instead | That accepts a value the real handler (`api/x402/transit-delays.js`) never meaningfully supports (null is not a route filter) and reopens the door to the same class of mismatch for any future optional field | Fix the example, not the schema, per the root-cause analysis above |
| The sibling grep in step 5 turns up zero other hits | Expected; `transit-delays` may be the only resource with this exact defect | Note "no siblings found" in the report and proceed; do not invent extra work |

## Report format

State: the step-0 failing-test output, the one-line diff, the sibling-grep output (hits found and fixed, or none), the final passing-test output, and the commit SHA.
