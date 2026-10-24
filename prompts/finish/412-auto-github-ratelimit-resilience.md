# 412. Stop the GitHub anonymous rate limit from firing unhandled 5xx alerts on ship/feed and commit-feed-push

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required for the code fix (one optional, non-blocking owner action is noted at the end).

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: reproduce with a failing test before touching the fix, confirm it fails for the stated reason, then fix, then confirm green. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

Production has no `GITHUB_TOKEN` or `GH_TOKEN` set, so every unauthenticated call to `api.github.com` from the Cloud Run service shares one 60-requests/hour budget per egress IP across several independent features. Confirm the alert pattern is still live:

    export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' | tail -1)"
    node -e "
    import('./api/_lib/db.js').then(async ({ sql }) => {
      const rows = await sql\`SELECT signature, title, count, first_seen, last_seen FROM ops_alerts WHERE title ILIKE '%rate limit exhausted%' AND last_seen > now() - interval '24 hours' ORDER BY last_seen DESC\`;
      console.log(rows);
      process.exit(0);
    });
    "

As measured 2026-10-24: both `cron timeout`-unrelated signatures `unhandled 5xx in GET /api/cron/commit-feed-push` ("GitHub rate limit exhausted ... set GITHUB_TOKEN to raise it above 60/hour") and `unhandled 5xx in GET /api/ship/feed?limit=200&audience=internal` ("shipfeed: GitHub rate limit exhausted ... pass a token to raise it above 60/hour") fired multiple times in the preceding few hours (2026-10-24 01:00-02:25 UTC window alone: three occurrences). If this query returns nothing from the last 24 hours, re-run it against the last 7 days; if still nothing, the condition may not currently be reproducible live, but the code defect below is real and verifiable by reading the source regardless, so proceed with the fix and note the absence of fresh alerts in the report.

Confirm no `GITHUB_TOKEN`/`GH_TOKEN` is configured on the live service (this only reads config, it changes nothing):

    gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -i "GITHUB_TOKEN\|GH_TOKEN" || echo "confirmed: no GitHub token configured"

## Root cause

Two independent, unauthenticated call paths hit GitHub's commits API and both advertise resilience they do not actually implement:

1. **`api/ship/feed.js`'s `buildFeed()`** (around line 106). Its own file header comment claims the GitHub call is "served from last-good on an upstream blip," but `buildFeed()` uses plain `cacheGet`/`cacheSet` (a fresh-value TTL cache with nothing to fall back to), not `cacheWrapLastGood()` from `api/_lib/cache.js` (line 608), which is the exact helper that implements the last-known-good fallback this comment describes and which dozens of other upstream-dependent modules already use (`api/_lib/birdeye.js`, `api/_lib/coingecko.js`, `api/_lib/hyperliquid.js`, `api/_lib/news.js`, and others). When `fetchGitHubCommits()` throws (a rate-limit 403, or any other GitHub fault), `buildFeed()` has no catch, so the throw propagates straight out of the handler as an unhandled exception, which is what produces the `unhandled 5xx in GET /api/ship/feed` alert even though a perfectly good cached response from the last successful run is sitting right there unused.

2. **`api/_lib/commit-feed-push.js`'s `fetchCommitPage()`** (around line 142) throws a plain `Error` naming the rate-limit condition when GitHub answers `x-ratelimit-remaining: 0`. The call chain that invokes it, `pushTelegramLane()` -> `fetchCommitsSince(state.lastSha)` (around line 281), has no try/catch around that call (the only try/catch in `pushTelegramLane()` wraps the later Telegram-posting loop, not the initial GitHub fetch), so the throw propagates out of `pushTelegramLane()`, out of the cron handler's bare `try { ... } finally { ... }` (no `catch`) in `api/cron/commit-feed-push.js`, and into `wrapCron()`'s generic unhandled-error path, which is what produces the `unhandled 5xx in GET /api/cron/commit-feed-push` alert. The module's own comment at that throw site says plainly that this is an expected, no-fault condition ("a shared Cloud Run address can burn through [60/hour] without this cron doing anything wrong"), but the code does not act like it believes that: it throws instead of returning a typed, graceful skip the way every other anticipated no-op in this file does (compare the `{ skipped: 'not_configured' }` and `{ posted: 0, seeded: true }` returns a few lines away).

Both are real resilience gaps independent of whether `GITHUB_TOKEN` is ever set: even with a token raising the ceiling to 5,000/hour, a transient GitHub outage or a shared-IP burst from an unrelated caller can still exhaust it, and today both paths turn that into a noisy false-urgency "unhandled 5xx" instead of the graceful degradation the surrounding code already assumes exists.

## Task

### Part A: `api/ship/feed.js` serves stale instead of throwing

1. Add a test-first regression in `tests/ship-feed-endpoint.test.js` (read it first to match its existing mocking style for `cacheGet`/`cacheSet`/`fetchGitHubCommits` or whatever upstream fetch it already stubs) that: primes the cache with one successful `buildFeed()` result, then makes the next call's GitHub fetch throw a rate-limit-shaped error, and asserts the endpoint still returns the previous feed (marked stale) instead of a 5xx. Run it and confirm it fails against today's code.
2. In `api/ship/feed.js`, change `buildFeed()` to wrap its GitHub-dependent work in `cacheWrapLastGood(key, CACHE_TTL_S, async () => { ...the existing fetch+build body... }, { withMeta: true })` (imported from `../_lib/cache.js` alongside the existing `cacheGet`/`cacheSet`, or replacing them entirely if nothing else in the file still needs the bare versions), and thread the returned `{ value, stale }` into the response shape the handler already returns (`{ ...value, cached: false, stale }` on a fresh-but-stale-serving path, matching the existing `cached` flag convention in the file).
3. Re-run the new test and confirm it passes. Run the rest of `tests/ship-feed-endpoint.test.js` to confirm no regression.

### Part B: `api/_lib/commit-feed-push.js` skips gracefully instead of throwing

1. Tag the rate-limit error at its throw site (around line 145) with a stable, exported predicate instead of a bare message string callers must pattern-match, e.g.:

   ```js
   export function githubRateLimitError(resetMs) {
     const until = Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : 'unknown';
     return Object.assign(
       new Error(`GitHub rate limit exhausted (resets ${until}); set GITHUB_TOKEN to raise it above 60/hour`),
       { githubRateLimited: true, retryAfter: Number.isFinite(resetMs) ? until : null },
     );
   }
   export function isGithubRateLimitError(err) {
     return Boolean(err?.githubRateLimited);
   }
   ```

   and use `throw githubRateLimitError(reset)` in place of the existing `throw new Error(...)` at that site.
2. Add a test-first regression in `tests/commit-feed-push.test.js` for `isGithubRateLimitError`/`githubRateLimitError` (no DB needed, pure functions): confirms a tagged error round-trips true, and a generic `new Error('boom')` reads false. Confirm it fails before the helpers exist, passes after.
3. In `pushTelegramLane()` (around line 281), wrap the `const { commits, found } = await fetchCommitsSince(state.lastSha);` call in its own try/catch: on `isGithubRateLimitError(err)`, `console.warn` a one-line notice and `return { posted: 0, skipped: 'github_rate_limited', retryAfter: err.retryAfter };` immediately (releasing the lock still happens in the cron handler's `finally`); any other error rethrows unchanged (out of scope for this order; only the named, previously-unhandled rate-limit case is being fixed).
4. Add a second test-first regression, following the existing PGlite-mocking pattern already established in `tests/x-mention-health.test.js` (`vi.mock('../api/_lib/db.js', ...)` backed by `@electric-sql/pglite`), that drives `pushTelegramLane()` with a `getPage`-equivalent failure path (check whether `pushTelegramLane` needs a small injectable-fetch parameter added, following the same shape `fetchCommitsSince` already accepts, to make this testable without mocking global `fetch`) and asserts it returns `{ posted: 0, skipped: 'github_rate_limited', retryAfter: ... }` rather than rejecting. Confirm it fails before the Part B.3 fix, passes after.
5. Confirm `api/cron/commit-feed-push.js` needs no change: it already treats any `telegram` result without a truthy `.error` as a 200 success, so the new `{ skipped: 'github_rate_limited', ... }` shape naturally returns 200, not 502.

### Part C: verify and close

1. Run `npx vitest run tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` and confirm everything passes.
2. Run `npm run check:rules -- --paths api/ship/feed.js api/_lib/commit-feed-push.js api/_lib/cache.js tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` and fix anything it flags (omit `api/_lib/cache.js` from the paths if Part A needed no change to it).
3. Add one dated row to `prompts/finish/_context/production-100-OWNER-ACTIONS.md` noting that setting `GITHUB_TOKEN` (a GitHub personal access token with no special scopes, read-only public access is enough) via `gcloud run services update three-ws-api --region us-central1 --update-env-vars GITHUB_TOKEN=<token>` would raise the shared ceiling from 60 to 5,000 requests/hour and reduce how often the new stale/skip paths this order ships are ever exercised; this is optional and does not block this order's completion, since the fix above already makes exhaustion a non-event instead of an alert-worthy failure.

## Done when

- `npx vitest run tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` passes in full, including every new case.
- `api/ship/feed.js`'s `buildFeed()` uses `cacheWrapLastGood()` and serves a stale-but-marked response instead of throwing when GitHub is unreachable or rate-limited.
- `api/_lib/commit-feed-push.js`'s `pushTelegramLane()` returns `{ skipped: 'github_rate_limited', ... }` instead of throwing when GitHub answers a rate limit, and the cron handler's existing 200/502 logic naturally reflects that without modification.
- `git diff` reviewed; every changed line matches one of Part A, B, or C above.
- The fix and its tests are committed together on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA, and the owner-action row from Part C.3 is in place.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| `tests/ship-feed-endpoint.test.js` doesn't already stub the GitHub fetch in a way that's easy to make throw | Read the file first; it already exercises `buildFeed()`'s success path, so the fetch seam exists | Reuse whatever injection point the existing tests use (a mocked `fetchGitHubCommits`/`fetchUpstream` or an injected `fetchImpl`); if none exists, add the smallest possible seam, matching the style `fetchCommitsSince`'s `getPage` option already sets in this repo |
| `pushTelegramLane()` has no injectable fetch today, making the DB-backed regression test awkward | Small, surgical seams are normal in this codebase (`fetchCommitsSince` already has one) | Add one parameter (default to the real `fetchCommitPage`) rather than mocking global `fetch`; keep the production call site unchanged (no argument passed, so it uses the default) |
| The live `ops_alerts` query in step 0 comes back empty | The alert is intermittent by nature (depends on shared-IP traffic), not permanently reproducible on demand | The code-level defect (no catch, no last-good fallback) is verifiable by reading the source regardless of whether an alert is firing right now; proceed with the fix and note this in the report |
| Tempted to also wire a cross-process GitHub call budget (shared rate limiter) to stop exhaustion happening at all | Out of scope: this order fixes the alert-worthy symptom (an avoidable failure mode turning into noisy unhandled 5xx), not the underlying shared-IP quota, which the optional `GITHUB_TOKEN` owner action in Part C.3 addresses far more effectively than new client-side throttling would | Do not build new rate-limiting infrastructure for this order; ship the two resilience fixes and the owner-action note |

## Report format

State: the step-0 `ops_alerts` and `gcloud run services describe` output, the failing-test confirmation for each of Part A and Part B before their fixes, the diffs, the passing-test output after, and the commit SHA.
