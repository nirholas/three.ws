# 457. `pump-callouts.js`'s last-known-good TTL silently shares `pump-bonding.js`'s env var, coupling two unrelated caches

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25, from commit `bc5a01b95`, unshipped, still on `evolve` only)

`api/_lib/pump-callouts.js` just gained a last-known-good cache tier (commit `bc5a01b95`, "serve last-known-good pump.fun callouts instead of 502 on Cloudflare 403", which also retired order 435). Its TTL constants, as they read right now:

    git show bc5a01b95 --stat   # confirms this file's own diff introduced lines 29-30 below
    grep -n "LKG_TTL_S\|PUMP_BONDING_LKG_TTL_S\|PUMP_CALLOUTS_TTL_S" api/_lib/pump-callouts.js api/_lib/pump-bonding.js

    api/_lib/pump-callouts.js:29:const LIVE_TTL_S = Number(process.env.PUMP_CALLOUTS_TTL_S || 25);
    api/_lib/pump-callouts.js:30:const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 1800);
    api/_lib/pump-bonding.js:41:const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 1800);

The live-tier constant on line 29 correctly got its own name, `PUMP_CALLOUTS_TTL_S`. The LKG-tier constant on line 30 did not: it reads `process.env.PUMP_BONDING_LKG_TTL_S`, the exact same environment variable `api/_lib/pump-bonding.js:41` already uses for a completely different cache (bonding-curve progress reads, not pump.fun callout/comment reads). This is a copy-paste leftover, not a deliberate shared knob: the comment above it (lines 25-27, added in the same commit) describes it as "survives a Cloudflare 403/rate-limit window", scoped to this file's own feed, with no mention of bonding.

Two concrete failure modes this creates, both silent:

1. **An operator who sets `PUMP_BONDING_LKG_TTL_S` to tune bonding's stale-serve window unknowingly retunes sentiment-pulse's callout cache too.** There is no log line, doc, or test anywhere that would surface this; the two subsystems (`/api/crypto/bonding` and `/api/social/sentiment-pulse`) share no other code path and are owned by unrelated features.
2. **Order `442-auto-bonding-lkg-ttl-too-short.md`, already open in this same queue, is about to act on a now-false premise.** Its own "Never blocked" table (line 69) says: *"Should I also fix `pump-callouts.js`'s separate 1800s default? No, that is a distinct constant in a distinct file... Touch only `pump-bonding.js`."* That was true when 442 was written (435 was still open and presumably going to give callouts its own variable name). It is no longer true: `pump-callouts.js` reads the *same* variable, not a distinct one. Order 442's step 6 (`grep -rn "PUMP_BONDING_LKG_TTL_S\|LKG_TTL_S" api/ tests/ docs/`) will surface `pump-callouts.js` as a hit, directly contradicting its own "touch only pump-bonding.js" instruction and its "nothing outside these files changed" Definition of Done line. Whoever runs 442 next hits a contradiction baked into the file.

Fixing the name now, before 442 runs, restores 442's premise to true (the two constants become genuinely distinct again) with no changes needed to 442 itself.

This is not a duplicate of 442 (that order only ever intended to touch `pump-bonding.js`'s TTL *value*) or of the closed order 435 (which shipped the callouts LKG tier but left this naming slip in).

## Task

1. Re-derive current state: `git show bc5a01b95 -- api/_lib/pump-callouts.js` to confirm the exact diff, then `grep -n "LKG_TTL_S" api/_lib/pump-callouts.js api/_lib/pump-bonding.js tests/social-sentiment-endpoints.test.js tests/pump-bonding.test.js`.
2. Write the failing test first, in `tests/social-sentiment-endpoints.test.js`: assert that setting `process.env.PUMP_BONDING_LKG_TTL_S` (without setting a callouts-specific variable) does NOT change the `staleTtlSeconds` the callouts cache call passes to the mocked `cacheWrapLastGood`, and that a new, dedicated variable does. The test file already mocks `../api/_lib/cache.js` with a `cacheWrapLastGood` that accepts `opts.staleTtlSeconds` (lines 35-55); spy on the call or assert through observable behavior (e.g. set the dedicated var to a tiny value and confirm the LKG entry expires at that boundary, mirroring how `tests/pump-bonding.test.js` tests `pump-bonding.js`'s own TTL if it does so; otherwise assert directly on the mock's recorded `opts`). Run it now and confirm it fails because today's code reads `PUMP_BONDING_LKG_TTL_S` for both files.
3. Fix `api/_lib/pump-callouts.js:30`: rename to a dedicated variable, matching the naming convention line 29 already set for this file:

       const LKG_TTL_S = Number(process.env.PUMP_CALLOUTS_LKG_TTL_S || 1800);

   Keep the default at `1800` in this commit; retuning the value is order 442's job for `pump-bonding.js` and is out of scope here (do not raise this file's default past 1800 in this order, to keep this a pure decoupling fix with one clear diff).
4. Grep for any other reference to `PUMP_BONDING_LKG_TTL_S` that assumed it governed callouts (docs, comments, `.env.example` if one lists cache-tuning vars) and update to `PUMP_CALLOUTS_LKG_TTL_S` where the reference was actually about callouts, not bonding.
5. Re-run `npx vitest run tests/social-sentiment-endpoints.test.js` in full; confirm the new test and all pre-existing cases pass.
6. Run `npm run check:rules -- --paths api/_lib/pump-callouts.js tests/social-sentiment-endpoints.test.js` and fix anything it flags.
7. Read the full diff (`git diff api/_lib/pump-callouts.js tests/social-sentiment-endpoints.test.js`) and confirm every changed line is one of the changes above, nothing else drifted.

## Definition of done

- [ ] `api/_lib/pump-callouts.js`'s LKG TTL reads its own `PUMP_CALLOUTS_LKG_TTL_S` environment variable, default unchanged at `1800`.
- [ ] `api/_lib/pump-bonding.js` is untouched by this order (its TTL value is order 442's job, not this one's).
- [ ] A new test in `tests/social-sentiment-endpoints.test.js` proves the two variables are now independent, confirmed to fail against the pre-fix shared-variable code before the fix landed.
- [ ] `npx vitest run tests/social-sentiment-endpoints.test.js` passes in full, no regressions.
- [ ] `npm run check:rules -- --paths api/_lib/pump-callouts.js tests/social-sentiment-endpoints.test.js` exits clean.
- [ ] `grep -rn "PUMP_BONDING_LKG_TTL_S" api/_lib/pump-callouts.js` returns nothing.
- [ ] One commit, explicit paths, subject describing the diff.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| "Should I also fix the TTL value, not just the name, while I'm in this file?" | No. Keep this a pure decoupling fix (name only, value stays 1800). A value change belongs to its own order with its own justification, the way 442 justified bonding's value change; mixing the two makes this diff harder to review and re-adds the coupling risk this order exists to remove. |
| "Order 442 might already have run and touched this file by the time I get here" | Check `git log --oneline -- api/_lib/pump-callouts.js api/_lib/pump-bonding.js` first. If 442 already ran and left `pump-callouts.js` untouched (per its own scope), proceed as written. If somehow `pump-callouts.js` was already changed to use its own variable, verify the variable name is sane and stop, reporting that this order is already satisfied. |
| "`.env.example` or deploy docs don't mention cache TTL vars at all" | Fine, nothing to update there; do not invent documentation for vars that were never documented. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you.
2. Commit with explicit paths: `git add api/_lib/pump-callouts.js tests/social-sentiment-endpoints.test.js` plus any doc touched, then commit with a subject naming the decoupling.
3. Delete this file in that same commit (`git rm prompts/finish/457-auto-pump-callouts-lkg-env-var-collision.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA.
4. Final report: the old shared variable, the new dedicated variable, the test added and its before/after pass state, the `check:rules` result, and the commit hash. No trailing questions.
