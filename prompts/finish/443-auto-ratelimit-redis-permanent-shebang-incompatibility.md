# 443. Rate limiter's Redis path has been permanently broken for 24h+, misdiagnosed as "transient" and never recovering

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`GET /api/healthz` reports `rate_limiter` as `degraded`, not `down`, with a hint claiming the fault self-heals:

    {
      "name": "rate_limiter",
      "status": "degraded",
      "detail": "redis circuit open, retries in 33s; serving from Postgres",
      "hint": "Transient Redis fault. The breaker probes on an escalating backoff and closes on the first success."
    }

Sampled three times 6 seconds apart just now: `retries in 33s` -> `retries in 213s` -> `retries in 527s` -> `retries in 520s`. That is the circuit breaker's `circuitRecordFailure()` backoff in `api/_lib/rate-limit.js` escalating toward (and sitting at) its `CIRCUIT_COOLDOWN_MAX_MS` ceiling of 600s, not recovering. It has been failing continuously, not intermittently: querying production logs for the underlying error over the last 2 hours returns the identical message on essentially every rate-limited request, across multiple buckets (`studio:ip`, `crypto-data:ip`):

    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"allow-key-locking"' \
      --project=aerial-vehicle-466722-p5 --freshness=2h --limit=5 --format="value(timestamp,textPayload)"

    2026-10-25T05:33:02Z [rate-limit] redis degraded for "studio:ip", ...: Command failed: ERR Unexpected flag in script shebang: allow-key-locking
    2026-10-25T05:32:42Z [rate-limit] redis degraded for "studio:ip", ...: Command failed: ERR Unexpected flag in script shebang: allow-key-locking
    2026-10-25T05:30:03Z [rate-limit] redis degraded for "crypto-data:ip", ...: Command failed: ERR Unexpected flag in script shebang: allow-key-locking
    2026-10-25T05:29:01Z [rate-limit] redis degraded for "studio:ip", ...: Command failed: ERR Unexpected flag in script shebang: allow-key-locking
    2026-10-25T05:27:42Z [rate-limit] redis degraded for "studio:ip", ...: Command failed: ERR Unexpected flag in script shebang: allow-key-locking

The same window (24h+ earlier samples, confirmed before this order was filed) shows the identical error, meaning the breaker has never once successfully closed in at least a day: this is a deterministic, 100%-reproducing incompatibility, not a flaky network fault. A backoff-and-retry strategy can never fix it, because the server will reject the exact same command forever.

**Root cause (confirmed via upstream project history, since this sandbox's `node_modules/` is not readable):** `@upstash/ratelimit` (pinned here at `^2.2.0`, `package.json:684`) changed its Lua scripts starting at v2.1.0 to prefix every script with a shebang line requesting Upstash's proprietary "key locking" behavior:

    #!lua flags=allow-key-locking

This flag is an Upstash-hosted-Redis-only extension (documented at `upstash.com/docs/redis/features/key-locking`). Open-source Redis and Valkey reject any unrecognized shebang flag outright with `ERR Unexpected flag in script shebang: allow-key-locking`, which is exactly the message in our logs. `ISSUES.md` item 4 already documents that `UPSTASH_REDIS_REST_URL` in this deployment points at a **self-hosted SRH (Serverless Redis HTTP) proxy on the VPC**, not Upstash's managed cloud, i.e. whatever open-source Redis/Valkey engine backs that proxy. This exact combination (self-hosted SRH in front of OSS Redis, `@upstash/ratelimit` >= 2.1.0) is a known, publicly tracked incompatibility: `github.com/upstash/ratelimit-js` issue #162 ("allow-key-locking script flag breaks the recommended local development setup") and `github.com/hiett/serverless-redis-http` issue #40 both report this identical error string for this identical cause. An upstream fix exists (`upstash/ratelimit-js` PR #163, "retry lua scripts without shebang on OSS Redis/Valkey") but is **not yet in any published release**: `npm view @upstash/ratelimit versions` lists `2.2.0` as the latest published version, with no `2.2.1`/`2.3.0` superseding it, so pinning to a newer release is not currently an option.

The fix within our control: pin `@upstash/ratelimit` back to the last version published before the incompatible shebang was introduced, `2.0.8` (the version immediately preceding `2.1.0-rc`/`2.1.0` in the published version list), which issues plain Lua scripts with no shebang line and is therefore compatible with any OSS Redis/Valkey version the self-hosted SRH proxy runs. This avoids a library-internals change on our side: it is a one-line `package.json` downgrade plus a lockfile update.

Downstream effect of the current break, for scope: `resilientLimiter()` in `api/_lib/rate-limit.js` fails every non-critical bucket open (rate limiting effectively disabled on most read/public endpoints) and fails every critical/`degradeToMemory` bucket over to the Postgres-backed counter (`fallbackLimiter`), which is a real but materially slower and more expensive path than Redis for every rate-limited request on the platform, sustained for 24h+ continuously, not momentarily.

This is distinct from and does not duplicate order 440 (`agent_index`/Base EVM crawl health-verdict mischaracterization) or order 441 (Base EVM crawl's own unbounded shrink-retry loop): both are about the `agent_index` subsystem and Base/EVM crawling specifically. This order is about the `rate_limiter` subsystem and has no EVM/crawl component. No open order in `prompts/finish/` currently mentions `rate-limit.js`, `allow-key-locking`, or `@upstash/ratelimit` (confirmed via `grep -ril` across the directory immediately before filing this order).

## Task

1. Read `api/_lib/rate-limit.js` in full, focusing on: `getLimiter()` (constructs `new Ratelimit({..., limiter: Ratelimit.slidingWindow(...)})`), the circuit breaker (`circuitAllows`, `circuitRecordSuccess`, `circuitRecordFailure`, `CIRCUIT_COOLDOWN_BASE_MS`/`CIRCUIT_COOLDOWN_MAX_MS`), `resilientLimiter()`, `warnDegradedOnce()`, and the existing `isRedisQuotaError()`/`warnQuotaOnce()` pair (a precedent for classifying a specific error string distinctly from the generic "transient" path).
2. Read `api/_lib/ops/subsystem-health.js` around the `rate_limiter` block (search for `name: 'rate_limiter'`) to see exactly where the misleading "Transient Redis fault... closes on the first success" hint string lives.
3. Confirm the root cause yourself before changing anything, since this session's own attempt to read `node_modules/@upstash/ratelimit` was denied by sandbox permissions; your environment may differ. Try: `cat node_modules/@upstash/ratelimit/dist/index.js | grep -o "allow-key-locking" | head -1` (or equivalent for whatever build artifact exists) and/or `cat node_modules/@upstash/ratelimit/package.json | grep version`. If readable, confirm the installed version is `>= 2.1.0` and that its bundled Lua script source contains the `#!lua flags=allow-key-locking` (or `no-writes,allow-key-locking`) shebang. If `node_modules` is unreadable in your environment too, proceed on the strength of the upstream issue reports cited above (`upstash/ratelimit-js#162`, `hiett/serverless-redis-http#40`) plus the production log evidence; the fix does not depend on inspecting the installed source, only on the published version list.
4. Write the failing test first. Add a case to `tests/rate-limit-durable-fallback.test.js` (or create `tests/rate-limit-redis-shebang-incompatibility.test.js` if that file's existing mock shape does not fit) that mocks the underlying Redis client call to reject with `new Error('Command failed: ERR Unexpected flag in script shebang: allow-key-locking')`, then asserts: (a) `resilientLimiter`'s returned decision still succeeds (fails open or falls back, per the bucket's existing `degradeToMemory` setting, exactly as today), and (b) a new, distinctly-named classifier (task 6) returns `true` for this error so the health/logging path can tell it apart from a generic transient fault. Run it now and confirm part (b) fails against the current code (no such classifier exists yet).
5. Pin the fix. Edit `package.json:684` from `"@upstash/ratelimit": "^2.2.0"` to `"@upstash/ratelimit": "2.0.8"` (exact pin, not a caret range, since the whole point is staying below the version that introduced the incompatible shebang; a caret range would let a future `npm install` drift back onto `2.1.x`/`2.2.x`). Run `npm install` to update `package-lock.json`. Read the diff of `package-lock.json`'s `@upstash/ratelimit` entries to confirm the resolved version is exactly `2.0.8` and that no other package's resolution changed as a side effect (if something unrelated shifts, investigate why before proceeding; do not blindly accept an unrelated lockfile diff).
6. Add a dedicated classifier in `api/_lib/rate-limit.js`, mirroring the existing `isRedisQuotaError`/`warnQuotaOnce` pair: `isRedisShebangIncompatibilityError(err)` matching `/unexpected flag in script shebang/i`, and a `warnShebangIncompatibilityOnce(name, err)` that logs once per 60s with a message naming the actual cause (e.g. `[rate-limit] FATAL INCOMPATIBILITY: Redis backend rejects @upstash/ratelimit's Lua script shebang (likely OSS Redis/Valkey behind the SRH proxy, not Upstash-hosted); downgrade or patch required`), called from the same site `warnDegradedOnce`/`warnQuotaOnce` are currently called from. Keep this as a logging/classification addition only; do not change `resilientLimiter`'s actual success/fallback behavior, since the version pin in task 5 is the real fix and this is purely for accurate diagnosis if the error class ever reappears for a different reason.
7. Update the `rate_limiter` hint text in `api/_lib/ops/subsystem-health.js`: when the most recent recorded failure matches `isRedisShebangIncompatibilityError`, do not emit "Transient Redis fault... closes on the first success"; emit something accurate, e.g. "Redis script incompatibility (not transient); see rate-limit.js shebang handling." If the current code has no mechanism to inspect the last error's text at health-check time (only the breaker's open/closed state and countdown), add the minimal plumbing to carry the last error message (or just its classification) into the health snapshot, matching whatever pattern `rateLimiterHealth()` already uses to expose breaker state.
8. Re-run the test from task 4: the classifier assertion must now pass. Run the full nearby suite: `npx vitest run tests/rate-limit-durable-fallback.test.js tests/api-rate-limit-wiring.test.js tests/rpc-rate-limit.test.js tests/rate-limit-refund.test.js tests/agent-screen-ratelimit.test.js tests/mcp-studio-ratelimit.test.js tests/x402-rate-limit-probe-target.test.js`. All must pass; none should regress from the version pin (none of these tests should depend on `@upstash/ratelimit`'s internal script content, only its public `Ratelimit`/`slidingWindow` API, which has not changed between 2.0.8 and 2.2.0; if any test fails for an API-shape reason, read the 2.0.8 README/types to find the minimal compatible call shape and adjust the call site, not the test's expectations).
9. Run `npm run check:rules -- --paths package.json package-lock.json api/_lib/rate-limit.js api/_lib/ops/subsystem-health.js` plus whichever test file(s) you touched, and fix anything it flags.
10. Add a `data/changelog.json` entry (tag `fix`) describing the rate limiter Redis fix, then run `npm run build:pages` and confirm only the expected generated files change.
11. Read the full diff before finishing and confirm every changed line is accounted for by the tasks above.

## Done when

- `package.json` pins `"@upstash/ratelimit": "2.0.8"` (exact, no range operator) and `package-lock.json` resolves it to exactly `2.0.8`.
- A new or extended test proves a classifier distinguishes the `allow-key-locking` shebang error from a generic transient Redis fault, and was confirmed failing before the classifier existed.
- `api/_lib/ops/subsystem-health.js`'s `rate_limiter` hint no longer claims this specific fault class is transient / self-healing when it is the shebang incompatibility.
- All listed rate-limit test files pass with no regressions.
- `npm run check:rules` reports no violations on the changed files.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- Live verification note in your report: since this fix is a dependency pin, it only takes effect once deployed; say explicitly that production will keep showing the `degraded`/circuit-open state until the next owner-approved deploy, matching the same honest "fix shipped on evolve, not yet live" framing orders 405 and 423 used.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "`node_modules/@upstash/ratelimit` is unreadable, I can't confirm the shebang is really there." | Proceed anyway. The production log error string, the two independently-filed upstream GitHub issues describing this exact error for this exact self-hosted-SRH-plus-`>=2.1.0` combination, and the published-version list (no shebang-stripping release exists yet) are sufficient evidence. The fix (pin to 2.0.8) is correct regardless of whether you can personally read the bundled script text. |
| "Pinning an exact version instead of a range feels wrong." | It is deliberate and required here: a caret/range pin would let the next `npm install` silently reintroduce the incompatible version. Leave a comment-free exact pin; the classifier added in task 6 is the safety net if this ever needs revisiting. |
| "Should I instead try to upgrade the self-hosted Redis/Valkey engine behind the SRH proxy to one that supports `allow-key-locking`?" | No. `allow-key-locking` is an Upstash-hosted-Redis-only proprietary extension (per Upstash's own docs), not a version feature of open-source Redis/Valkey; no OSS engine version will ever accept it. Infra changes to the SRH proxy are also out of scope for an unattended code-only order. The library-version pin is the only correct fix available from this repo. |
| "This touches `package.json`/`package-lock.json`, is a dependency change an owner-gated action?" | No. CLAUDE.md's gates are on-chain/spend actions, push/deploy, non-$THREE crypto content, and destroying unrecoverable data. A local dependency version pin, committed to the `evolve` branch like any other code change, is none of those. |

## Report format

State: the exact before/after `@upstash/ratelimit` version, the production log evidence snippet used to confirm the fault is sustained (not transient), the new classifier function name and its test, the full test-suite pass counts before and after, the `check:rules` result, and the commit hash. Note explicitly that the fix is not yet live in production (deploy is owner-gated) and that `/api/healthz`'s `rate_limiter` status will keep reading `degraded` until the next deploy.
