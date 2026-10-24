# 430. `/api/pump-bounties*` hard-502 on every pump.fun GO outage, with a proven last-known-good helper sitting unused one import away

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Same failure family as orders 423/424 (pump.fun Cloudflare-blocking this environment) but a different upstream (pump.fun GO's bounties API, not the coin/curve APIs) and a different, simpler fix: a generic LKG helper already exists and is already proven in production; this order is "use it here too," not "invent a new degrade path."

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` / `.todo` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): there is currently no test file exercising the three `api/pump-bounties*` HTTP handlers (only `tests/pump-go.test.js`, which covers the pure normalizers in `api/_lib/pump-go.js`, not the routes). Write one that reproduces the bug (upstream down, no cache, no LKG → hard 502 reaches the caller) before changing any implementation code.

## Why this matters (measured 2026-10-24 10:35 UTC, from HEAD `d234b5de2`)

Live, right now:

    curl -s -D - "https://three.ws/api/pump-bounties?limit=5" -o /dev/null
    → HTTP 502 {"error":"pump_go_upstream","error_description":"pump.fun GO upstream 403"}

    curl -s -D - "https://three.ws/api/pump-bounties/stats" -o /dev/null
    → HTTP 502 {"error":"pump_go_upstream","error_description":"pump.fun GO upstream 403"}

    curl -s -D - -o /dev/null --max-time 10 "https://livestream-api.pump.fun/bounties/tasks?limit=5"
    → HTTP 403, cf-mitigated: challenge, server: cloudflare

Same pump.fun-wide Cloudflare block already documented in orders 423/424 (there against `frontend-api-v3.pump.fun`), hitting a third pump.fun surface: `livestream-api.pump.fun`, the GO bounties REST API. `scripts/gcp-triage.mjs --since 24h --deep --json` classifies both `/api/pump-bounties` and `/api/pump-bounties/stats` 502s as `investigate` (not yet owner-tracked, not self-healing), 2 occurrences each in the sampled window: a real, currently-live, unduplicated finding.

The root cause is narrower than 423/424's: `api/_lib/pump-go.js`'s `pumpGoGet()` throws a bare `PumpGoError` on any non-2xx/non-404 upstream response (line 56), and all three callers propagate it straight to the client:

- `api/pump-bounties.js:40-43` (`listBounties`, list endpoint)
- `api/pump-bounties/stats.js:51-54` (`listBounties` inside a pagination loop, aggregate endpoint)
- `api/pump-bounties/[id].js:38-41` (`getBounty`, detail endpoint; its sibling `getSubmissions` call on line 31 already degrades gracefully to an empty list, proving the pattern is known in this file, just not applied to the primary data)

None of the three has a last-known-good tier. Unlike orders 423/424 (which had to design a bespoke on-chain/DB degrade path because pump.fun coin metadata has no equivalent elsewhere), this fix is simpler and lower-risk: `api/_lib/cache.js` already exports `cacheWrapLastGood(key, ttlSeconds, fn, opts)` (line 608), a generic wrapper that serves a fresh value for `ttlSeconds`, mirrors every fresh value into a `<key>:lkg` entry for `staleTtlSeconds` (default 24h), and transparently falls back to that mirror when `fn()` throws. It is already proven in production for `api/portal.js`, `api/x402/*.js`, and `api/globe/intel.js` (confirmed via `grep -rl cacheWrapLastGood`), and already has test coverage of its own core semantics (`tests/portal-endpoint.test.js`, `tests/token-layer.test.js`, `tests/api/coin-pair-resolver.test.js`). This order is wiring, not invention: swap each handler's hand-rolled `cacheGet` → fetch → `cacheSet` → hard-fail block for one `cacheWrapLastGood` call per handler.

## Step 0: re-derive the current state

    git log --oneline -1
    curl -s -D - "https://three.ws/api/pump-bounties?limit=5" -o /dev/null        # confirm still 502
    curl -s -D - "https://three.ws/api/pump-bounties/stats" -o /dev/null          # confirm still 502
    curl -s -D - -o /dev/null --max-time 10 "https://livestream-api.pump.fun/bounties/tasks?limit=5"  # confirm the CF block (if cleared, ship anyway, see Never-blocked table)
    sed -n '590,627p' api/_lib/cache.js          # cacheWrapLastGood's exact signature and semantics
    sed -n '1,50p' api/pump-bounties.js
    sed -n '1,67p' api/pump-bounties/stats.js
    sed -n '1,52p' "api/pump-bounties/[id].js"
    grep -n "cacheWrapLastGood" api/portal.js    # a live caller to confirm the call-site convention (positional opts, withMeta usage)

## Tasks

1. Create `tests/pump-bounties-endpoint.test.js`. Mirror `tests/pump-bonding.test.js`'s mocking approach: `vi.mock('../api/_lib/cache.js', ...)` with a Map-backed fake, but this time the fake must implement `cacheWrapLastGood` for real (not `cacheGet`/`cacheSet` individually, since the fixed handlers will call `cacheWrapLastGood` directly), replicating the real function's documented semantics from `api/_lib/cache.js:593-626`: on call, check `<key>` in the Map; if present return `{value, stale:false}` (or the bare value depending on `withMeta`); otherwise call `fn()`, on success store under both `<key>` and `<key>:lkg` and return `{value, stale:false}`; on `fn()` throwing, check `<key>:lkg` in the Map, return `{value: lkgValue, stale:true}` if present, otherwise rethrow. Also `vi.mock('../api/_lib/pump-go.js', ...)` so `listBounties`/`getBounty`/`getSubmissions` are controllable per test (resolve, or reject with a real `PumpGoError` imported from the actual module so `instanceof` checks in the handlers still work). Import each handler's default export plus `node:http`-style mock `req`/`res` helpers already used elsewhere in this test suite (check `tests/pump-bonding.test.js` or `tests/portal-endpoint.test.js` for the request/response double convention already in use; reuse it, do not invent a new one). Cases, written before touching implementation:
   - `/api/pump-bounties`: `listBounties` resolves → 200 with the data, Map now holds both the fresh and `:lkg` entries (regression guard for the cache-population side effect).
   - `/api/pump-bounties`: `listBounties` rejects with `PumpGoError`, Map has a pre-seeded `:lkg` entry for the same cache key → 200 with the stale payload and a `x-pump-stale: 1` response header, NOT a 502. This is the new case that must fail against current code before the fix.
   - `/api/pump-bounties`: `listBounties` rejects with `PumpGoError`, Map has nothing → the true miss still returns the `PumpGoError`'s status/code/message unchanged (regression guard on the honest-failure path).
   - `/api/pump-bounties/stats`: same two failure cases (stale-serve vs true-miss), given the aggregation loop calls `listBounties` possibly more than once; wrap the whole aggregation in one `cacheWrapLastGood` call (cache key `pumpgo:stats:v1`, unchanged), not one per page.
   - `/api/pump-bounties/[id]`: `getBounty` rejects with `PumpGoError`, Map has a pre-seeded `:lkg` entry for `pumpgo:task:<id>` → 200 stale payload with `x-pump-stale: 1`; `getBounty` rejects with nothing cached → unchanged 502/404 passthrough. (`getSubmissions`'s existing empty-list degrade on line 31 is untouched; do not fold it into the LKG wrapper, it is already handled correctly.)
2. In `api/pump-bounties.js`, replace the manual `cacheGet` (lines 31-35) / fetch-and-`cacheSet` (lines 37-45) block with a single `cacheWrapLastGood(cacheKey, 30, () => listBounties({ limit, cursor, status }), { withMeta: true })` call. On the resolved `{ value, stale }`, set `res.setHeader('x-pump-stale', '1')` when `stale` is true (in addition to the existing `cache-control` header, unchanged), then `json(res, 200, value)`. Only reach the existing `catch (e) { if (e instanceof PumpGoError) return error(...) }` block when `cacheWrapLastGood` itself rejects (true miss, no LKG).
3. Apply the same replacement to `api/pump-bounties/stats.js`: wrap the entire pagination walk (the `do {...} while (cursor)` loop building `payload`) in one `cacheWrapLastGood(CACHE_KEY, CACHE_TTL_S, async () => { /* existing loop body, return payload */ }, { withMeta: true })` call, set `x-pump-stale` on `stale`, keep the existing `cache-control` header. Do not change `MAX_PAGES`/`PAGE`/the truncation logic.
4. Apply the same replacement to `api/pump-bounties/[id].js` for the `getBounty` call only (cache key `pumpgo:task:${id}`, ttl 30): wrap `getBounty(id)` in `cacheWrapLastGood`, set `x-pump-stale` on `stale`. Leave the `getSubmissions` call and its existing `.catch` degrade exactly as is; a stale bounty detail should still try for fresh submissions.
5. `grep -n "x-pump-stale"` across `src/` and `public/` to confirm no existing frontend code treats its presence as a signal to hide the bounty data or otherwise mishandles it (order 424 already did this check for the coin endpoint and found it safe; re-confirm for these three routes since they are different pages).
6. Run `npx vitest run tests/pump-bounties-endpoint.test.js` once before task 2's edits (confirm the new stale-serve cases fail) and once after (confirm all cases pass for the right reason).

## Definition of done

- [ ] `tests/pump-bounties-endpoint.test.js` exists, covers all cases in task 1 across all three handlers, and `npx vitest run tests/pump-bounties-endpoint.test.js` exits 0.
- [ ] The true-miss path (no live data, no LKG) still returns the original `PumpGoError` status/code/message unchanged, never silently swallowed into a confusing 200.
- [ ] `getSubmissions`'s existing empty-list degrade in `api/pump-bounties/[id].js` is unmodified.
- [ ] No hardcoded third-party bounty/task id or mint added to source or tests beyond what already exists in fixtures; no real mainnet mint introduced.
- [ ] `npm run check:rules -- --paths api/pump-bounties.js api/pump-bounties/stats.js api/pump-bounties/[id].js tests/pump-bounties-endpoint.test.js` exits 0.
- [ ] One `data/changelog.json` entry (tag `fix`) describing the degrade path, matching the style of the existing `/api/crypto/bonding` entry quoted above.
- [ ] Commit with explicit paths; subject names the actual fix (e.g. `fix(pump-bounties): serve last-known-good data instead of a 502 when pump.fun GO is unreachable`).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The CF block has cleared by the time you run this | Ship the fix anyway; `cacheWrapLastGood` is a no-op improvement on the happy path (same TTL, same response shape) and the block has already recurred three times across orders 423/424/this one, so it will recur again. Note in the report that the live symptom was not reproducible at run time. |
| `cacheWrapLastGood`'s real semantics differ from what "Why this matters" describes | Re-read `api/_lib/cache.js:593-626` directly (the actual source, not this file's summary) before writing the test's fake; make the fake match the real function exactly, not this document. |
| The request/response test-double convention in `tests/pump-bonding.test.js` doesn't fit an HTTP handler (vs. a plain function) | Check `tests/portal-endpoint.test.js` instead, since `api/portal.js` is itself an HTTP handler using `cacheWrapLastGood`; reuse its req/res mock shape. |
| Wrapping the stats endpoint's whole pagination loop in one `cacheWrapLastGood` call changes error timing (e.g. a mid-walk `PumpGoError` on page 3 of 5) | That is fine and intended: the whole aggregate is one cache unit today (one `CACHE_KEY`), so a partial walk is not currently cached or served either; preserve that existing all-or-nothing behavior, just add the LKG tier around it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one commit (or a small number if the changelog/test edits are cleanly separable).
3. Delete this file in the final commit (`git rm prompts/finish/430-auto-pump-bounties-lkg-fallback.md`) once every Definition of done line is verified green, and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA(s). If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the Step 0 measurements (reproduced or not, with the exact curl output); the diff summary; the before/after test counts for the new test file; the one-line judgment calls (req/res mock shape chosen, header naming). No trailing questions.
