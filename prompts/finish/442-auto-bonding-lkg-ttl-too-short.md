# 442. `/api/crypto/bonding`'s last-known-good cache expires long before the outages it exists to survive

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`api/_lib/pump-bonding.js:41` sets the last-known-good cache window for every bonding-curve read to 1800 seconds (30 minutes):

    const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 1800);

This value was introduced by order 405 (closed 2026-10-23) purely to give the endpoint *some* fallback where it had none before; the order's own closing note never claims 1800 was a considered choice, and no later order has revisited the number. Confirmed still live in the current tree today: `grep -n "LKG_TTL_S" api/_lib/pump-bonding.js` still shows the `1800` default, unchanged since 405 shipped.

30 minutes is far shorter than the outage windows this exact cache tier exists to survive:

- `ISSUES.md` documents the Solana RPC lane cooldown as `QUOTA_COOLDOWN_MS` = 6 hours once a lane exhausts its quota (a lane that returns `429`/quota-exhausted does not recover until the billing-period rollover or the full 6h cooldown elapses, per the same backoff design pattern used in `api/_lib/rate-limit.js`'s circuit breaker).
- The pump.fun Cloudflare block that order 423 (closed 2026-10-24) added an on-chain fallback for is not a blip either: `curl -s -D - --max-time 10 "https://frontend-api-v3.pump.fun/coins/<mint>"` returned `403` with `cf-mitigated: challenge` at order 423's measurement and is confirmed still returning the identical `403`/`cf-mitigated: challenge` today (re-run below), i.e. a block that has now persisted across at least two measurement sessions a day apart.
- The codebase's own general-purpose equivalent, `cacheWrapLastGood` in `api/_lib/cache.js:561` (`opts.staleTtlSeconds`), defaults to `24 * 3600` (24 hours), not 1800. `pump-bonding.js` is the one caller that reinvented this pattern by hand (predates `cacheWrapLastGood`, per order 405's own description of porting the pattern from `pump-feed-fetch.js` rather than from `cache.js`) and landed on a window 48x shorter than the shared convention it was modeled after, with no stated reason for the gap.

Net effect: once both the live cache (25s) and the 30-minute LKG window expire during a multi-hour upstream or RPC outage, every request for that mint falls all the way through to `{kind:'upstream_down'}` and `api/crypto/bonding.js` returns a hard `503`, even though the three-tier design's entire purpose is to avoid exactly that. A `503` here is user-visible: `api/crypto/bonding.js` backs the bonding-progress UI on every `/launches/<mint>` and `/oracle/coin/<mint>` page.

Reproduced live against production right now (re-run of order 423's own check, one day later):

    curl -s -D - --max-time 10 "https://frontend-api-v3.pump.fun/coins/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" 2>&1 | grep -i "^HTTP\|cf-mitigated\|^server"

returns `HTTP/2 403`, `server: cloudflare`, `cf-mitigated: challenge`: the exact block order 423 diagnosed is still live today, confirming this is a sustained, multi-day condition, not a transient blip that a 30-minute window would ever outlast.

This is not a duplicate of order 405 (which added the LKG tier) or order 423 (which added the on-chain fallback behind it): both of those orders are closed and shipped. This order only retunes the TTL constant both of them left at its original placeholder value, and only for `pump-bonding.js`; it does not touch `pump-callouts.js` (order 435, separate file, separate constant) or any other LKG cache.

## Task

1. Read `api/_lib/pump-bonding.js` in full (294 lines), focusing on lines 36-42 (the TTL constants) and lines 257-293 (`getBondingStatus`, the three-tier read path: live cache -> pump.fun fetch -> LKG cache -> on-chain fallback -> `upstream_down`).
2. Read `tests/pump-bonding.test.js` in full to see the existing Map-backed `cache.js` mock and how `LKG_TTL_S`/`LIVE_TTL_S` are exercised today (search for `cacheSet` call-site assertions, if any, and for any hardcoded `1800`).
3. Write the failing test first, in `tests/pump-bonding.test.js`: a case asserting that `getBondingStatus` writes the LKG cache entry with a TTL that survives at least a multi-hour outage window, not just 1800s. Concretely: spy on the mocked `cacheSet` and assert the TTL argument passed for the `bondingLkgKey(mint)` write (both call sites, line 270 and line 289) is `>= 21600` (6 hours) by default. Run it now (`npx vitest run tests/pump-bonding.test.js`) and confirm it fails against the current code (current writes use 1800).
4. Fix `api/_lib/pump-bonding.js:41`: change the default from `1800` to `21600` (6 hours), keeping the existing `PUMP_BONDING_LKG_TTL_S` env override untouched so an operator can still tune it without a code change:

       const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 21600);

   Use 21600 specifically because it matches the documented `QUOTA_COOLDOWN_MS` (6h) RPC-lane cooldown in `ISSUES.md`, the longest *recurring* outage class this cache tier is known to face; it is still well short of the 24h default in `cacheWrapLastGood`, which is appropriate because bonding-curve price/progress data is far more time-sensitive than the generic use cases `cacheWrapLastGood` serves elsewhere (serving 6h-stale bonding data is already a materially worse user experience than 24h-stale would be for, say, a static profile field; do not raise this past 6h without separately re-justifying it).
5. Re-run `npx vitest run tests/pump-bonding.test.js`: the new test and all pre-existing cases (22 before this change) must pass.
6. Check every other reader of `PUMP_BONDING_LKG_TTL_S` or a hardcoded `1800` tied to this constant: `grep -rn "PUMP_BONDING_LKG_TTL_S\|LKG_TTL_S" api/ tests/ docs/`. If any doc or comment states the old 30-minute figure (e.g. a docstring in `pump-bonding.js` itself, or `docs/api-reference` if it documents cache behavior), update it to say 6 hours.
7. Run `npm run check:rules -- --paths api/_lib/pump-bonding.js tests/pump-bonding.test.js` and fix anything it flags.
8. Add a `data/changelog.json` entry (tag `fix`, link `/api/crypto/bonding` or `/docs/api-reference`, whichever the existing convention for this endpoint used in orders 405/423 points at) describing the longer stale-serve window, then run `npm run build:pages` and confirm only the expected generated files change.
9. Read the full diff (`git diff api/_lib/pump-bonding.js tests/pump-bonding.test.js data/changelog.json`) and confirm every changed line is one of the changes above.

## Done when

- A new test in `tests/pump-bonding.test.js` asserts the LKG cache write TTL is `>= 21600` seconds, confirmed to fail against the pre-fix `1800` default before the fix lands.
- `api/_lib/pump-bonding.js`'s `LKG_TTL_S` default is `21600`, with the env override (`PUMP_BONDING_LKG_TTL_S`) left intact.
- `npx vitest run tests/pump-bonding.test.js` passes in full (23/23 or more, none regressed).
- `npm run check:rules -- --paths api/_lib/pump-bonding.js tests/pump-bonding.test.js` reports no violations.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- Nothing outside `api/_lib/pump-bonding.js`, `tests/pump-bonding.test.js`, `data/changelog.json`, and the generated `public/changelog*`/`CHANGELOG.md` files changed.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "Is 21600 the right number, or should I ask the owner?" | No. It is directly derived from `ISSUES.md`'s documented `QUOTA_COOLDOWN_MS` (6h) and is strictly shorter than the codebase's own `cacheWrapLastGood` 24h default. Use it and move on. |
| "The pump.fun block might resolve before I finish; does the order still apply?" | Yes. The fix is a TTL constant unconditionally better than 1800s regardless of this specific block's current state; it does not depend on the block being live when you run this. |
| "Should I also fix `pump-callouts.js`'s separate 1800s default?" | No, that is a distinct constant in a distinct file covered by order 435 if still open, or already shipped if closed. Touch only `pump-bonding.js`. |

## Report format

State: the old and new TTL values, the test file and line added, the vitest pass count before and after, the `check:rules` result, and the commit hash. If the pump.fun block or RPC quota state changed between your Step 0 re-measurement and completion, say so in one line; it does not change what to ship.
