# 424. `/api/pump/coin` 502s once its 24h last-known-good cache is exhausted, with no on-chain degrade path

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Depends conceptually on order 423 (same root cause) but touches a different file and ships independently; do not block on 423 being merged first, re-derive state fresh per Step 0.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` / `.todo` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): there is currently no test file for `api/pump/[action].js`'s `handleCoin`/`serveStaleCoin` path. Write one that reproduces the bug (upstream down, no live cache, no LKG cache → hard 502) before changing any implementation code.

## Why this matters (measured 2026-10-24 08:21-08:35 UTC, from HEAD `a3b0b8f2e`)

Same root cause as order 423, a different endpoint, and a worse failure mode because this one has already burned through its full 24-hour safety margin:

    curl -s -D - "https://three.ws/api/pump/coin?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
    → HTTP 502 {"error":"upstream_failed","error_description":"pump.fun returned 403", ...}  (no x-pump-stale header: the 24h LKG is also empty)

pump.fun's `frontend-api-v3.pump.fun` is answering every request from this environment with a Cloudflare challenge, confirmed directly:

    curl -s -D - -o /dev/null --max-time 10 "https://frontend-api-v3.pump.fun/coins/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
    → HTTP 403, cf-mitigated: challenge, server: cloudflare

`api/pump/[action].js`'s `handleCoin` has three tiers: a 30s in-memory `COIN_CACHE`, a direct fetch, then `serveStaleCoin` which checks the same in-memory cache and a 24-hour `cacheGet(coinLkgKey(mint))`. The CF block has now outlasted even the 24-hour tier for $THREE's own mint: the platform's own promoted coin's `/api/pump/coin` card is currently unrenderable anywhere in the frontend that calls it directly. In the same 1000-row / 8.5-minute production error-log sample used in order 423 (`gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" severity>=ERROR httpRequest.status>=500'`), `/api/pump/coin` 502s account for a further meaningful slice behind the `/api/crypto/bonding` 503s, confirming this is not a one-off for one mint.

Full pump.fun coin metadata (name, symbol, image, description, socials) genuinely does not exist on-chain, Jupiter, or anywhere else this codebase can reach without pump.fun's web API, so this endpoint cannot be fully on-chain-backed the way order 423's bonding endpoint can. The achievable, honest fix is a graceful three-tier degrade instead of a hard 502:

1. Numeric/curve fields (bonding progress, graduation, market cap, SOL-in-curve) can come from `getCurveView()` (`api/_lib/pump-curve-view.js`, already proven live, see order 423's evidence) exactly as in order 423.
2. Identity metadata (name, symbol, image, creator) can come from this platform's own `pump_agent_mints` table for any mint that was launched or is tracked through three.ws (check `api/_lib/db.js` or wherever `pump_agent_mints` is queried elsewhere, e.g. grep `pump_agent_mints` in `api/`), which is real first-party data, not a guess.
3. Only if neither source has anything should the endpoint fall back to today's 502, and it should say so plainly (`error_description` naming pump.fun specifically, not a generic message) so the frontend can render an honest "metadata temporarily unavailable" state instead of a blank error.

## Step 0: re-derive the current state

    git log --oneline -1
    curl -s -D - "https://three.ws/api/pump/coin?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" -o /dev/null   # confirm still 502, no x-pump-stale
    curl -s "https://three.ws/api/pump/curve?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"                    # confirm the on-chain reader still works for numeric fields
    curl -s -D - -o /dev/null --max-time 10 "https://frontend-api-v3.pump.fun/coins/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"  # confirm the CF block (if cleared, check Step 0 note below)
    grep -n "pump_agent_mints" api/**/*.js | head -40      # find how the platform already queries its own launch-record table
    sed -n '1,80p' api/_lib/pump-curve-view.js              # getCurveView's export shape, reused from order 423
    grep -n "handleCoin\|serveStaleCoin\|COIN_CACHE\|COIN_LKG_TTL_S\|coinLkgKey" api/pump/\[action\].js   # locate the exact lines to change

If pump.fun's block has cleared and a fresh `/api/pump/coin` call for several real mints returns 200 directly (not from the stale path), the immediate outage is over, but ship the degrade path anyway: the 24-hour LKG tier being fully exhausted proves this has already happened for a sustained period and will recur, and today the only alternative to pump.fun answering is a bare 502 with no honest message and no partial data.

## Tasks

1. Create `tests/pump-coin-endpoint.test.js`. Mirror the mocking pattern from `tests/pump-bonding.test.js` (Map-backed `vi.mock('../api/_lib/cache.js', ...)`, `vi.stubGlobal('fetch', ...)`, `THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'`). Import whatever is exported/exportable from `api/pump/[action].js` for this handler (check what is currently exported; if `handleCoin` is not exported, add a named export for it alongside the default handler, the same way the file likely already structures its other `handle*` functions per action, confirm by reading the file's export pattern first rather than assuming). Write these cases before touching implementation:
   - Live fetch succeeds → 200, full pump.fun body, unchanged from today (regression guard).
   - Live fetch fails, in-memory `COIN_CACHE` has a recent entry → stale 200 with `x-pump-stale: 1`, unchanged from today (regression guard).
   - Live fetch fails, no in-memory cache, 24h LKG cache empty, `getCurveView` (mocked) returns usable on-chain data, no `pump_agent_mints` row → 200 with numeric/curve fields populated from the mock, identity fields (`name`/`symbol`/`image`) present but explicitly marked unavailable (e.g. `null` plus a `metadataSource: 'onchain'`/`'unavailable'` flag, pick a convention consistent with how `mapBondingStatus`'s `source` field reads), and NOT a 502. This is the new test that must fail against current code before the fix.
   - Same as above but a `pump_agent_mints` row exists for the mint (mock the DB call) → 200 with identity fields populated from that row.
   - Live fetch fails, no in-memory cache, no LKG, `getCurveView` also fails/returns nothing, no DB row → the true triple-miss still returns 502, with an `error_description` that names pump.fun specifically (regression guard on the honest-failure path, do not let the degrade logic swallow the real "everything is down" case silently).
2. In `api/pump/[action].js`, change `serveStaleCoin` (or add a sibling function called from the same failure path in `handleCoin`) to implement the three tiers from "Why this matters" above: in-memory cache → 24h LKG cache → `getCurveView` + `pump_agent_mints` DB lookup merge → honest 502. Import `getCurveView` from `../_lib/pump-curve-view.js` (relative path from `api/pump/`, confirm the exact relative path before writing the import, `api/_lib/pump-curve-view.js` vs `api/pump/_lib/...`, check with `ls api/_lib/pump-curve-view.js`). For the DB lookup, reuse whatever existing query/helper already reads `pump_agent_mints` elsewhere in the codebase (found in Step 0's grep) rather than writing a new one; if none exists as a reusable helper, add the minimal query next to it following that file's existing query style.
3. When serving the degraded response, set a distinguishing response header (e.g. `x-pump-degraded: onchain`) alongside or instead of `x-pump-stale`, and confirm no existing frontend code treats `x-pump-stale` presence as "this is fresh enough to not show a degraded-data indicator" in a way that would now mislabel on-chain-only data as fresh pump.fun data (grep `x-pump-stale` across `src/` and `public/`).
4. Run `npx vitest run tests/pump-coin-endpoint.test.js` until every case passes for the right reason (the new on-chain-degrade cases must have failed against the pre-fix code first; confirm this by running the suite once before task 2's edit and noting the failure, then once after).

## Definition of done

- [ ] `tests/pump-coin-endpoint.test.js` exists, covers all five cases in task 1, and `npx vitest run tests/pump-coin-endpoint.test.js` exits 0.
- [ ] The true triple-miss (pump.fun down, no caches, on-chain fallback also unavailable, no DB row) still returns 502 with an honest, pump.fun-specific `error_description`, never silently swallowed into a confusing 200.
- [ ] No hardcoded third-party mint added to source or tests; `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` is the only real mint used.
- [ ] `npm run check:rules -- --paths api/pump/[action].js tests/pump-coin-endpoint.test.js` exits 0.
- [ ] One `data/changelog.json` entry (tag `fix`) describing the degrade path, since `/api/pump/coin` is a documented public endpoint.
- [ ] Commit with explicit paths; subject names the actual fix (e.g. `fix(pump): degrade /api/pump/coin to on-chain numeric data plus first-party metadata instead of a bare 502 when pump.fun is Cloudflare-blocked`).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The CF block has cleared by the time you run this | Ship the degrade path anyway; the 24h LKG being fully exhausted is itself proof this already happened for a sustained period. Note in the report that the live symptom was not reproducible at run time. |
| `handleCoin` is not currently exported / is tightly coupled to the request/response objects of the `[action].js` router | Export the smallest testable unit (a pure function taking `mint` and returning the response body/status, with `req`/`res` plumbing kept thin in the router), following whatever pattern the file already uses for its other actions; do not restructure the whole file, only this handler. |
| No reusable `pump_agent_mints` query helper exists anywhere | Write the minimal `SELECT name, symbol, image_url FROM pump_agent_mints WHERE mint = $1` (match actual column names from the table's existing usage, do not guess blind) next to this handler; do not build a generic data-access layer, that is out of scope. |
| `getCurveView` import path is wrong on first try | `ls api/_lib/pump-curve-view.js` to confirm the real path before importing; `api/pump/[action].js` imports from `../_lib/...` the same way order 423's target file does from a sibling location. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one commit (or a small number if the changelog/test edits are cleanly separable).
3. Delete this file in the final commit (`git rm prompts/finish/424-auto-pump-coin-onchain-degrade.md`) once every Definition of done line is verified green, and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA(s). If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the Step 0 measurements (reproduced or not, with the exact curl output); the diff summary; the before/after test counts for the new test file; the one-line judgment calls (export shape, DB column names, header naming). No trailing questions.
