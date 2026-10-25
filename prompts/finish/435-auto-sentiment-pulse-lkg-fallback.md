# 435. Give `/api/social/sentiment-pulse` a last-known-good fallback for pump.fun blocks

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`POST /api/social/sentiment-pulse` is the unauthenticated, no-key endpoint behind the paid `sentiment_pulse` MCP tool, and it also feeds the "Community" sentiment bars rendered on every `/launches/<mint>` page (`src/launch-detail.js:1898-1920`) and every `/oracle/coin/<mint>` page (`src/oracle.js:2381`, `public/oracle-coin.js:908`). It reads pump.fun's live comment feed (`/callout/coin/:mint`) through `api/_lib/pump-callouts.js`'s `fetchPumpFunCallouts`, which has **zero caching of any kind**: a failed upstream call returns `{error, url}` straight through to the handler, and `api/social/sentiment-pulse.js:90-95` turns that into an HTTP 502 `upstream_unavailable` with no caller-supplied texts to fall back on. The frontend then just blanks the whole sentiment section (`sentWrap.replaceChildren()`).

Reproduced live against production right now:

    curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" \
      -d '{"token":"213AqZcCnmvH7CvKyU2NtH8oaoBKkaJ3xAF9FReLpump"}' \
      https://three.ws/api/social/sentiment-pulse

returns `502` on every one of 3 consecutive calls, with body:

    {"error":"upstream_unavailable","error_description":"pump.fun returned 403","token":"213AqZcCnmvH7CvKyU2NtH8oaoBKkaJ3xAF9FReLpump","source":"pump.fun"}

pump.fun's Cloudflare anti-bot layer is returning 403 to our server-side fetch for this endpoint specifically (this is a distinct call path from the already-fixed `pump-coin-lookup-upstream-502` signature and the already-fixed-but-not-yet-deployed bonding-curve on-chain fallback; this one has never had a resilience pass). The live `reports/page-audit-2026-10-24T20-43-27-109Z.json` sweep independently caught the same symptom: six `http-502` hits on `https://three.ws/api/social/sentiment-pulse` across `/launches/<mint>` and `/oracle/coin/<mint>` pages.

This is not a new instance of the already-tracked whole-site pump.fun outage pattern that gets fixed once and forgotten; it is the **one remaining pump.fun-sourced read with no last-known-good tier**. Every sibling pump.fun reader already has this resilience:

- `api/_lib/pump-feed-fetch.js`'s `readThroughFeed` (used by `fetchPumpTrades`/`fetchPumpBoard`) serves a stale cached copy on upstream failure instead of erroring.
- `api/_lib/pump-bonding.js`'s `getBondingStatus` keeps an explicit `bondingLkgKey` cache tier for the same reason.
- `api/_lib/cache.js:608`'s `cacheWrapLastGood(key, ttlSeconds, fn, opts)` is the shared, already-tested, generic version of this exact pattern: serve fresh for `ttlSeconds`, mirror every fresh value under `<key>:lkg` for `staleTtlSeconds` (default 24h), and when `fn()` throws, serve the mirror instead of propagating the failure (only propagating when no mirror exists either).

`fetchPumpFunCallouts` in `api/_lib/pump-callouts.js:52-61` is the only pump.fun reader that was never wired to any of this. Wiring it to `cacheWrapLastGood` closes the gap with the smallest possible change and matches an already-proven, already-reviewed pattern instead of inventing a new one.

## Task

1. Read `api/_lib/pump-callouts.js` in full (62 lines) and `api/_lib/cache.js`'s `cacheWrapLastGood` (around line 593-626) so the fix target and the exact contract (`{ value, stale }` when `withMeta: true`, throws when `fn()` throws and no LKG mirror exists) are both fresh.
2. Read `tests/social-sentiment-endpoints.test.js` in full (237 lines). It currently mocks `../api/_lib/rate-limit.js` only and stubs `globalThis.fetch` directly per test; it does **not** mock `../api/_lib/cache.js`, so it runs against the real cache module (which falls back to an in-process memory store when no Redis is configured, per `api/_lib/cache.js`'s own documented backend fallback). Confirm this by running the existing suite once before touching anything: `npx vitest run tests/social-sentiment-endpoints.test.js`. All 9 existing tests must pass before you change anything.
3. Add a `vi.mock('../api/_lib/cache.js', ...)` to `tests/social-sentiment-endpoints.test.js`, matching the pattern already proven in `tests/pump-bonding.test.js:9-13` (an in-memory `Map`-backed fake exposing `cacheGet`/`cacheSet`, cleared in a `beforeEach`), so this suite's cache state is deterministic and isolated from the real module. Re-run the existing 9 tests after adding the mock; all must still pass unchanged (they don't currently depend on real cache behavior, since nothing in the current code calls `cacheGet`/`cacheSet` yet).
4. Write the failing test first, in `tests/social-sentiment-endpoints.test.js`, inside the `describe('POST /api/social/sentiment-pulse', ...)` block: a case named something like `'serves last-known-good callouts when pump.fun fails and a cached copy exists'`. It should:
   - Call the pulse handler once with a `fetch` stub returning a successful `upstream(200, { callouts: [...] })` response (populating the LKG tier for that mint+limit).
   - Call it again with `fetch` stubbed to reject or return a non-ok status (e.g. `upstream(403, null)`, matching the real-world symptom above).
   - Assert the second call returns `200` (not `502`), with `out.overall.count` matching the cached callouts, and some signal that the data is stale (see task 6 for exactly what to assert here once you've decided the stale-signal shape).
   Run it now and confirm it fails against the current, unfixed `pump-callouts.js` (the second call should currently 502). This is the required pre-fix failure check from the test-first rule.
5. Fix `api/_lib/pump-callouts.js`'s `fetchPumpFunCallouts`: wrap the `pumpFetchJson` call in `cacheWrapLastGood` from `../_lib/cache.js`, keyed by something like `pump:callouts:${mint}:${pageLimit}` (mint plus the clamped page limit, since different limits would otherwise collide or over/under-serve). Use a short live TTL consistent with the sibling trade/board TTLs in `pump-feed-fetch.js` (e.g. 20-30s; add a `PUMP_CALLOUTS_TTL_S` env-overridable constant rather than hardcoding magic numbers, matching the existing `LIVE_TTL_S`/`LKG_TTL_S` convention in `api/_lib/pump-bonding.js`) and a `staleTtlSeconds` matching the existing LKG convention elsewhere in this codebase (1800s, i.e. `PUMP_BONDING_LKG_TTL_S`'s default; reuse that same 1800 default rather than inventing a new number, unless you find a documented reason the callouts feed should age differently). Because `cacheWrapLastGood`'s `fn` must *throw* to trigger the fallback (it does not treat a returned `{error}` object specially), have the wrapped function throw on a failed `pumpFetchJson` call, and keep `fetchPumpFunCallouts`'s own external contract (`{ posts, url }` on success, `{ error, url }` on failure) by catching that thrown error at the outer layer only when no LKG mirror exists. Thread the `stale` flag (from `cacheWrapLastGood`'s `withMeta: true` result) through to the caller so `api/social/sentiment-pulse.js` can report it, matching the existing `stale`/`x-pump-stale` convention already shipped in `api/_lib/pump-bonding.js` and `api/crypto/bonding.js`.
6. Update `api/social/sentiment-pulse.js` to surface the stale flag it now receives from `fetchPumpFunCallouts`: at minimum, add a `pumpfunStatus: 'stale'` (distinct from the existing `'ok'`/`'unavailable'` values) in the `sources` object of the 200 response when serving from the LKG tier, so a caller (and the test from task 4) can tell live data from last-known-good data. Update the test from task 4 to assert on whatever exact shape you land on here.
7. Update the file's header comment (lines 18-20 currently say "This is the unauthenticated, no-key endpoint... It does no caching of its own") to reflect the new LKG behavior, and update the "A pump.fun outage with no caller-supplied texts answers 502" comment block (lines 40-43) to note the LKG exception: an outage still answers 502 only when no cached copy of that mint+limit exists yet.
8. Run the full existing test file plus your new test: `npx vitest run tests/social-sentiment-endpoints.test.js`. All must pass, including the existing `'answers 502 when pump.fun fails and the caller supplied nothing to score'` test (task 2's mock isolation should keep that test's mint+limit combination free of any prior LKG entry from an earlier test in the same file; if test ordering causes a collision, use a distinct mint or limit for the new test rather than changing the existing one's expectations).
9. Run `npm run check:rules -- --paths api/_lib/pump-callouts.js api/social/sentiment-pulse.js tests/social-sentiment-endpoints.test.js` and fix anything it flags.
10. Read the full diff (`git diff api/_lib/pump-callouts.js api/social/sentiment-pulse.js tests/social-sentiment-endpoints.test.js`) and confirm every changed line is one of the changes above.

## Done when

- A new test in `tests/social-sentiment-endpoints.test.js` reproduces the bug (502 on a second pump.fun failure despite a prior successful fetch for the same mint+limit) and is confirmed to fail against the pre-fix code before the fix lands.
- `fetchPumpFunCallouts` in `api/_lib/pump-callouts.js` serves a cached last-known-good callout list (via `cacheWrapLastGood`) instead of erroring, whenever a prior successful fetch for that mint+limit exists within the stale TTL window.
- `api/social/sentiment-pulse.js`'s 200 response distinguishes a live read from a stale/LKG read in its `sources` object.
- The pre-existing "answers 502 ... caller supplied nothing to score" test still passes unchanged (a cold mint+limit with no LKG mirror still 502s; the fallback only kicks in when a mirror actually exists).
- All tests in `tests/social-sentiment-endpoints.test.js` pass: `npx vitest run tests/social-sentiment-endpoints.test.js`.
- `npm run check:rules -- --paths api/_lib/pump-callouts.js api/social/sentiment-pulse.js tests/social-sentiment-endpoints.test.js` passes.
- The file header comments in both touched source files are updated to describe the new LKG behavior (no stale "does no caching of its own" claim left behind).
- `git diff` reviewed; every changed line traces to a task above.
- The fix is committed on `evolve` with explicit paths and a commit message naming the bug and the fix.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and what was verified.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| pump.fun's 403 is itself the "real" root cause and feels like it needs an owner action (rotating IPs, a different scraping approach, contacting pump.fun) | Nothing about this order asks you to make pump.fun stop blocking us; it asks you to make our own endpoint degrade gracefully when pump.fun blocks us, exactly like every sibling pump.fun reader already does | Ship the LKG fallback. Do not attempt to work around pump.fun's Cloudflare layer itself (no header spoofing, no proxy rotation); that is out of scope and risks looking like abuse-evasion |
| The existing test suite runs against the real (unmocked) `cache.js` today, and adding a mock could change the behavior of the other 8 tests in subtle ways | The other 8 tests never call `cacheGet`/`cacheSet` today (nothing in the current code path touches the cache module at all), so mocking it is a no-op for them; this is confirmed by running the suite before and after the mock is added (task 3) | Run the suite immediately after adding the mock, before writing any new test, to prove this |
| `cacheWrapLastGood`'s contract (throws when no mirror, returns the mirror when one exists) doesn't obviously map onto `fetchPumpFunCallouts`'s existing `{error}`-return contract | This is a deliberate design note in the task list (task 5), not an open question: wrap the throwing boundary at the call site inside `fetchPumpFunCallouts` so its own external return shape is unchanged for every existing caller | Follow task 5's wrapping instruction exactly; do not change `fetchPumpFunCallouts`'s external return shape beyond adding the `stale` field |
| Picking an exact live TTL and stale TTL feels like a judgment call with no clearly "correct" number | The codebase already answers this: reuse the existing sibling conventions (20-30s live, 1800s stale) rather than inventing new numbers from scratch | Use `PUMP_BONDING_LKG_TTL_S`'s default (1800) for the stale tier and a TTL in the 20-30s range for the live tier, both as named, env-overridable constants in `pump-callouts.js`, matching the naming style already used in `pump-bonding.js` |

## Report format

State: the failing test's first (red) run output, the fix, the passing test run output (all tests in the file), the `check:rules` result, the diff, and the commit SHA.
