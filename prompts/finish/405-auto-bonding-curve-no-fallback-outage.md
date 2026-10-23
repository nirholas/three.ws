# 405. `/api/crypto/bonding` is in total outage: port the already-proven last-known-good cache into `pump-bonding.js`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order." Runnable now, no gate. Written by the evolve scout lane on 2026-10-23 from a live measurement against production.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them: it edits one library file, ports an existing pattern already shipped elsewhere in this repo, and adds tests.
- No mocks, no fake data, no unfinished-work markers, no commented-out code. Every claim gets verified against the live endpoint, not assumed from the code.
- Bug fixes are test-first (CLAUDE.md): write a test that reproduces the gap (upstream failure with no cache returns a hard error with no fallback), confirm it fails for that reason, then fix, then confirm it passes. Commit the test with the fix.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-23, production, `main` at `9b32c1ea3`)

`GET https://three.ws/api/crypto/bonding?mint=<any mint>` is in **complete, sustained outage**. Three consecutive live calls against a real mint (`$THREE`'s own CA) each returned `503`:

```
$ curl -s -o /dev/null -w "%{http_code}\n" "https://three.ws/api/crypto/bonding?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
503
503
503
```

This is a free, keyless, Solana-native endpoint (CLAUDE.md: Solana first) that any agent or frontend surface can call to check a pump.fun bonding-curve's progress and migration status. It currently fails for every caller, every time.

**Root cause, read end to end:**

1. `api/crypto/bonding.js` (handler) calls `getBondingStatus(mint)` from `api/_lib/pump-bonding.js`. On `result.kind === 'upstream_down'` it returns a hard `503 upstream_unavailable` with `retry_after: 15` and no fallback of any kind.
2. `api/_lib/pump-bonding.js`'s `fetchOnce(url)` makes exactly one raw `fetch()` with a 6000ms timeout and **no retry**. Any non-OK response, including pump.fun's Cloudflare anti-bot challenge, becomes `{kind:'upstream_down'}` immediately.
3. `fetchPumpCoin(mint)` tries `coins-v2/<mint>` then `coins/<mint>` against `PUMP_FRONTEND_BASE` (`https://frontend-api-v3.pump.fun`), both direct fetches with **no caching whatsoever**, so there is nothing to fall back to even when a prior successful fetch exists.
4. pump.fun's upstream is confirmed, independent of this bug, to intermittently serve a Cloudflare "Just a moment..." challenge (HTTP 403) or a rate limit (429/1015) regardless of request shape. This is a known, already-solved failure class elsewhere in this exact codebase:
   - `api/_lib/pump-feed-fetch.js` exports `pumpFetchJson(url, {timeoutMs, retries})`, a bounded retry that honors `Retry-After` on 429/5xx and never throws, plus a shared `readThroughFeed({key, ttlSeconds, lkgKey, lkgTtlSeconds, fetchRows})` helper: live cache first, then a much longer last-known-good (LKG) cache, served stale with an `x-pump-stale: 1` header rather than hard-failing.
   - `api/pump/[action].js`'s `handleCoin()` (the sibling `/api/pump/coin` endpoint, which fetches the exact same pump.fun coin object this order's endpoint needs) already ships this: an in-memory `COIN_CACHE` (30s TTL), a 24-hour Redis-backed LKG keyed `pump:coin:lkg:<mint>`, and `serveStaleCoin(res, mint, status, code, message)` which serves the LKG copy with `x-pump-stale: 1` on live failure, only returning a real `Retry-After: 15` error when there is no LKG at all.

`pump-bonding.js` is the one module in this family that never got this treatment. The fix is mechanical: port the proven pattern, not invent a new one.

## Step 0: re-derive the current state

```bash
git log --oneline -1
for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code}\n" "https://three.ws/api/crypto/bonding?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"; done
curl -s "https://three.ws/api/crypto/bonding?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" | head -c 500; echo
cat api/_lib/pump-bonding.js
sed -n '1,220p' api/_lib/pump-feed-fetch.js
grep -n "COIN_CACHE\|COIN_LKG_TTL_S\|coinLkgKey\|serveStaleCoin\|function handleCoin" api/pump/\[action\].js
```

If the endpoint already returns `200` reliably across 10 consecutive calls, another agent or a pump.fun-side recovery already fixed the symptom; still read `pump-bonding.js` and confirm it has a real cache/LKG path (not just a transient upstream recovery that will regress), add the missing resilience if it is still absent, and report that the live symptom had already cleared.

## Tasks

1. **Add caching to `api/_lib/pump-bonding.js`.** Import `cacheGet`/`cacheSet` from `api/_lib/cache.js` (the same module `api/pump/[action].js` uses). Add a short live-cache TTL (follow the sibling convention, e.g. 20-30s) keyed per mint, e.g. `pump:bonding:live:<mint>`, and a long LKG TTL (follow the sibling convention, e.g. 1800-3600s) keyed `pump:bonding:lkg:<mint>`.
2. **Replace the single-shot `fetchOnce` with a retrying fetch.** Either import and reuse `pumpFetchJson` from `api/_lib/pump-feed-fetch.js` directly (preferred: one fewer retry implementation to maintain), or if `fetchPumpCoin`'s two-URL-shape fallback (`coins-v2` then `coins`) doesn't fit `pumpFetchJson`'s single-URL signature cleanly, wrap each of the two attempts in `pumpFetchJson` calls. Either way, upstream failures must now retry with backoff honoring `Retry-After` before being treated as down, matching the sibling modules' behavior.
3. **Wire the LKG fallback into `getBondingStatus(mint)`.** On successful fetch: write through to both the live cache and the LKG cache. On fetch failure: check the live cache first (serve if fresh), then the LKG cache (serve if present, flagging staleness), and only return `{kind:'upstream_down'}` when neither exists, mirroring `readThroughFeed`'s three-way contract (fresh / stale-but-present / truly nothing).
4. **Surface staleness in the handler.** In `api/crypto/bonding.js`, when `getBondingStatus` returns a stale/LKG result, set the `x-pump-stale: 1` response header (matching the sibling endpoint's convention) and return `200` with the stale data rather than `503`, so callers get a usable answer instead of a hard failure whenever any successful fetch has ever happened for that mint. Only return `503 upstream_unavailable` with `retry_after: 15` when there is truly no cached data of any kind (e.g. a mint queried for the first time during an upstream outage).
5. **Tests.** Add or extend a test file beside the existing pump-bonding tests (check for `tests/pump-bonding*.test.js`; create one at that path if it does not exist) covering: (a) a reproduction of today's bug: upstream fetch fails and there is no LKG, asserting the current `{kind:'upstream_down'}` / `503` behavior is what happens when there is truly nothing cached (this is the correct behavior for that case, so this test documents the contract rather than proving a regression, but write it test-first by confirming it against the pre-fix code path for the *stale-fallback* case below, which does fail pre-fix); (b) the actual bug reproduction: seed the LKG cache with a prior successful result, force the live fetch to fail, assert the fix now returns the LKG data with staleness indicated instead of a `503` (this must fail against the current code since no LKG path exists at all, then pass after the fix); (c) a successful fetch writes through to both caches.
6. **Re-verify against production behavior.** You cannot deploy from this session (CLAUDE.md gate), so verify locally: run the handler against a mocked/forced-failing upstream in the test suite (already covered by task 5) and confirm `npm run test:core -- pump-bonding` (or the exact path of the new/extended test file) passes.

## Definition of done

- [ ] `api/_lib/pump-bonding.js` imports `cacheGet`/`cacheSet` from `api/_lib/cache.js` and uses a retrying fetch (`pumpFetchJson` or equivalent bounded-retry wrapper), not a single raw `fetch()`.
- [ ] `getBondingStatus(mint)` returns cached/LKG data with a staleness flag when the live fetch fails and prior data exists; only returns `upstream_down` when no cached data exists at all for that mint.
- [ ] `api/crypto/bonding.js` sets `x-pump-stale: 1` and returns `200` on a stale-but-present result; only returns `503` when there is truly nothing cached.
- [ ] A new or extended test file reproduces the bug (fails before the fix, for the stated reason: no LKG fallback path exists) and passes after the fix.
- [ ] `npx vitest run <the exact test file path>` exits 0.
- [ ] `npm run test:core` shows no new failures introduced by this change versus the Step 0 baseline (the suite may already be red for unrelated reasons tracked in order 401; compare only files this order touches).
- [ ] `npm run check:rules -- --paths api/_lib/pump-bonding.js api/crypto/bonding.js <the test file path>` exits 0.
- [ ] Committed as one topical commit (code + test together, per the bug-fix-is-test-first rule), with an honest message naming the fix.
- [ ] `git status --short` shows nothing left uncommitted from this order.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| pump.fun's upstream happens to be healthy while you work, so you cannot observe a live `503` | The bug is in the code path (no cache exists at all), not a transient upstream state; write the test with a forced-failing fetch mock as task 5 describes, you do not need a live outage to prove the gap. |
| `api/_lib/cache.js`'s `cacheGet`/`cacheSet` require Redis credentials not present locally | Check `.env.local` first (used throughout this order's own research); if genuinely absent, the `self-unblock-playbook` skill's credential row covers it. The cache module may also have an in-memory fallback mode, check its own source before assuming a hard block. |
| `pumpFetchJson`'s signature doesn't fit `fetchPumpCoin`'s two-URL-shape retry cleanly | Wrap each of the two attempts (`coins-v2` then `coins`) in its own `pumpFetchJson` call rather than forcing a shared signature; correctness matters more than code reuse purity here. |
| `npm run test:core` is red for unrelated reasons (tracked in orders 401/406) | Compare only the files this order touches; do not attempt to fix unrelated red tests here. |

## Report format

1. Before/after: the three live `curl` status codes from Step 0, and (if you can reproduce an upstream failure locally) the handler's response before and after the fix.
2. The diff to `pump-bonding.js` and `crypto/bonding.js`, inline or by commit SHA.
3. The new/extended test file's path and its pass/fail transition (fails before fix with the stated reason, passes after).
4. Anything parked (e.g. a cache-infra limitation discovered mid-task).
