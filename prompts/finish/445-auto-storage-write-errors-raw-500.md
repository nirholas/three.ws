# 445. Object-storage write faults raise a raw, alerting 500 instead of the 503 the DB-outage path already proves out

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

Production's R2 bucket is down right now (owner-gated, tracked separately: do not touch R2 itself):

    curl -s https://three.ws/api/healthz | python3 -c "import json,sys; d=json.load(sys.stdin); print([s for s in d['subsystems']['subsystems'] if s['name']=='object_storage'])"
    # [{"name":"object_storage","status":"down","detail":"bucket unreachable: Please enable R2 through the Cloudflare Dashboard.", ...}]

`api/_lib/r2.js:94` already exports a classifier built for exactly this fault class:

    export function isStorageInfrastructureError(err) {
      const text = [err?.name, err?.Code, err?.message ?? (err == null ? '' : String(err))].filter(Boolean).join(' ');
      return STORAGE_ERROR_RE.test(text); // matches signaturedoesnotmatch, invalidaccesskeyid, "enable r2 through", econnrefused, enotfound, etc.
    }

It is used by exactly one caller today, `api/cdn-object.js`'s own two-lane READ fallback (the mechanism order 437 hardens further). It is NOT imported by `api/_lib/http.js`. Confirmed:

    grep -n "^import" api/_lib/http.js | grep -i "db.js\|r2.js"
    # import { isDbUnavailableError, isDbCapacityError, isStoragePressured } from './db.js';
    # (no import from r2.js)

Compare to how a DB outage is treated: `wrap()`'s catch block, `wrapCron()`'s `runHandler` catch block, and `serverError()` each special-case `isDbUnavailableError(err) || isDbCapacityError(err)` to answer a clean 503 (`wrap`/`serverError`) or a 200 skip (`wrapCron`, so cron retries don't get penalized), with a throttled warn and a deduped ops alert instead of a Sentry capture and an "unhandled 5xx" alert. No equivalent branch exists for a storage-infrastructure fault, so every route that calls `putObject`/`getObjectBuffer`/`headObject`/`deleteObject`/`copyObject` without its own try/catch gets the generic path instead: raw `500`, a Sentry event, and an `unhandled:<url>:<message>` ops alert, once per request, for the entire duration of any R2 outage.

This is not hypothetical during the CURRENT outage. Live 24h production error logs (`gcloud logging read` against `resource.type=cloud_run_revision AND resource.labels.service_name=three-ws-api AND httpRequest.status=500`, project `aerial-vehicle-466722-p5`, service `three-ws-api`, region `us-central1`) show:

    /api/avatars/upload?content_type=model%2Fgltf-binary&sha256=a6b721b9... : 5 occurrences, HTTP 500

Traced to `api/avatars/_actions.js`'s `handleUpload` (the proxy-upload action): line `await putObject({ key, body: buffer, contentType });` sits with no try/catch around it, after every validation step (auth, CSRF, rate limit, content-type, body read, GLB header check, quota) has already passed. When R2 rejects the write, this throws straight up through `wrap()` (confirmed: `handleUpload` is itself wrapped with `wrap(...)` at its definition), hits the generic `else` branch (`console.error('[api] unhandled ...')`, `captureException(err, ...)`, `sendOpsAlert('unhandled 5xx in ...', ...)`), and the client gets a bare `{error:'internal_error', ...}` instead of the actionable "storage temporarily unavailable, retry shortly" a DB outage already produces.

`handleUpload` is one of 60+ call sites across `api/` that call `putObject` with no local try/catch (`grep -rn "putObject(" api/ | grep -v _lib/r2.js | wc -l` returns 60+, spanning forge, avatars, tts, print, pump, mail, provenance, and more). Fixing `handleUpload` alone would only close the one call site this session happened to catch in the logs; the next outage (or the current one, hitting a different route first) reproduces the identical raw-500-plus-alert pattern everywhere else `putObject`/`getObjectBuffer`/`headObject`/`deleteObject`/`copyObject` is called bare. The leverage is in `api/_lib/http.js`'s three shared choke points, which is exactly where the DB-outage precedent already lives and exactly why this ranks above a one-file patch: one change closes it for every route, present and future, the same way the DB branch already does for every DB-backed route.

This is also not a duplicate of order 437 (`/cdn/*` read-path placeholder fallback, scoped to `api/cdn-object.js`'s GET lane) or order 439 (CAD forge R2 URL leak, a different leak entirely). Neither touches `api/_lib/http.js`'s generic error classification, and neither covers the write path.

## Task

1. Read `api/_lib/http.js` in full, focusing on:
   - `reportServerError` and `serverError` (the DB-coercion branch: `if (isDbUnavailableError(err) || isDbCapacityError(err)) { ... }`)
   - `wrap()`'s catch block (`const dbDown = isDbUnavailableError(err); ... const status = dbDegraded || missingEnv ? 503 : (err.status || 500); ...`)
   - `wrapCron()`'s `runHandler` catch block (`if (isDbUnavailableError(err) || isDbCapacityError(err)) { ... json(res, 200, { ok: false, reason: ... }); return; }`)
2. Read `api/_lib/r2.js` lines 1-150, specifically `isStorageInfrastructureError` (line 94) and `STORAGE_ERROR_PATTERN`/`STORAGE_ERROR_RE` (lines 89-92), to confirm the exact error-text shapes it already matches (SignatureDoesNotMatch, InvalidAccessKeyId, "enable r2 through", ECONNREFUSED, ENOTFOUND, etc).
3. Read `tests/http-db-unavailable-boundary.test.js` in full: it is the test file to model the new one on, including its `fakeRes()` helper and its `vi.mock('../api/_lib/alerts.js', ...)` / `vi.mock('../api/_lib/cache.js', ...)` setup.
4. Write the failing test first, in a new file `tests/http-storage-unavailable-boundary.test.js`:
   - A `storageDownError()` helper returning `new Error('Please enable R2 through the Cloudflare Dashboard.')` (the exact live production message) or, for a second case, `Object.assign(new Error('The request signature we calculated does not match the signature you provided.'), { name: 'SignatureDoesNotMatch' })`.
   - `describe('wrap() under an object-storage outage')`: a handler that `throw storageDownError()` wrapped in `wrap()` must answer `503`, `error: 'service_unavailable'`, a `retry-after` header, and must NOT log a `[api] unhandled` error line and must NOT call `captureException` (import and spy on `../api/_lib/sentry.js`'s `captureException`, mirroring how the DB test spies on `console.error`).
   - `describe('wrapCron() under an object-storage outage')`: mirrors the DB case: answers `200`, `{ ok: false, reason: 'storage_unavailable' }`, no `[api] unhandled` line.
   - `describe('serverError() under an object-storage outage')`: `serverError(res, 500, 'upload_failed', storageDownError())` must coerce to `503` + `retry-after` + `error: 'service_unavailable'`, regardless of the passed-in status, exactly like the DB case.
   - Also keep one assertion per describe block proving a genuine non-storage, non-DB error (`new Error('boom')`) still 500s and still alerts, so the new branch cannot swallow real bugs.
   - Run `npx vitest run tests/http-storage-unavailable-boundary.test.js` now and confirm every new case fails against the current code (no storage branch exists yet, so they all fall through to the generic 500/`unhandled` path).
5. Fix `api/_lib/http.js`:
   - Add `isStorageInfrastructureError` to the existing `from './r2.js'` import (there is none yet; add `import { isStorageInfrastructureError } from './r2.js';` near the `isDbUnavailableError` import).
   - In `reportServerError`/`serverError`'s DB-coercion branch, extend the condition to `isDbUnavailableError(err) || isDbCapacityError(err) || isStorageInfrastructureError(err)`, OR add a parallel `else if (isStorageInfrastructureError(err)) { ... }` branch that does the same 503 + retry-after + `service_unavailable` response with its own alert signature `storage:unavailable` (pick whichever keeps the function readable; a parallel branch is likely clearer since the DB branch's alert text is DB-specific).
   - In `wrap()`'s catch block, add a `storageDown = !dbDegraded && !missingEnv && isStorageInfrastructureError(err)` check, fold it into the same `status = ... ? 503 : ...` ternary, and add an `else if (storageDown) { ... }` branch alongside the existing `dbDegraded`/`missingEnv` branches: log a throttled warn (not `console.error`), skip `captureException`, and `sendOpsAlert('object storage unavailable', ..., { signature: 'storage:unavailable' })`. Ensure the client-facing response also sets `retry-after: 30` and returns `{ error: 'service_unavailable', error_description: 'object storage temporarily unavailable, retry shortly', ref }` the same shape the DB branch already returns.
   - In `wrapCron()`'s `runHandler` catch block, add an `else if (isStorageInfrastructureError(err)) { ... json(res, 200, { ok: false, reason: 'storage_unavailable' }); return; }` branch alongside the existing DB branch, so a storage outage degrades a cron tick to a clean skip instead of a timeout-adjacent 500.
6. Re-run `npx vitest run tests/http-storage-unavailable-boundary.test.js`: every case must now pass.
7. Re-run the full existing `tests/http-db-unavailable-boundary.test.js`, `tests/http-cron-timeout.test.js`, `tests/http-cache-control.test.js`, `tests/http-method-head.test.js`, and `tests/api/http-*.test.js`: all must still pass (the new branches must not change behavior for non-storage errors).
8. Run `npm run check:rules -- --paths api/_lib/http.js tests/http-storage-unavailable-boundary.test.js` and fix anything it flags.
9. Add a `data/changelog.json` entry (tag `fix`, no specific user-facing page link needed since this is an internal error-handling change; omit the `link` field or point it at `/docs/api-reference` if the existing convention requires one) describing that object-storage faults now degrade to a clean 503 instead of a raw 500, then run `npm run build:pages` and confirm only the expected generated files change.
10. Read the full diff (`git diff api/_lib/http.js tests/http-storage-unavailable-boundary.test.js data/changelog.json`) and confirm every changed line is one of the changes above.

## Done when

- `tests/http-storage-unavailable-boundary.test.js` exists, covers `wrap()`, `wrapCron()`, and `serverError()` under a storage-infrastructure error, and is confirmed to have failed against the pre-fix code before the fix landed.
- `api/_lib/http.js` imports `isStorageInfrastructureError` from `./r2.js` and uses it in all three places (`wrap()`, `wrapCron()`, `serverError()`/`reportServerError`) to coerce a storage-infrastructure fault to the same 503/200-skip treatment the DB-outage path already gets, without touching the DB branches' own behavior.
- `npx vitest run tests/http-storage-unavailable-boundary.test.js` passes in full.
- `tests/http-db-unavailable-boundary.test.js` and the other `tests/http-*.test.js` / `tests/api/http-*.test.js` files still pass unchanged.
- `npm run check:rules -- --paths api/_lib/http.js tests/http-storage-unavailable-boundary.test.js` reports no violations.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- Nothing outside `api/_lib/http.js`, `tests/http-storage-unavailable-boundary.test.js`, `data/changelog.json`, and the generated `public/changelog*`/`CHANGELOG.md` files changed. In particular, no individual route file (`api/avatars/_actions.js` or any other of the 60+ `putObject` callers) is touched: the fix is centralized in `http.js` on purpose.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "Should I also wrap `putObject` calls in try/catch at each of the 60+ call sites, to be thorough?" | No. That is the opposite of the point: the whole reason this ranks above a one-file patch is that the central `http.js` fix covers every current and future call site in one change, exactly like the DB-outage branch already does. Touching call sites individually is explicitly out of scope. |
| "The R2 outage might be fixed by the time I run this; does the order still apply?" | Yes. The fix is a general error-classification improvement, independent of whether R2 happens to be up when you run this. Use the test's synthetic error objects; you do not need a live outage to reproduce or verify the fix. |
| "Should this also change `api/cdn-object.js`'s existing use of `isStorageInfrastructureError`?" | No. That caller already has its own correct two-lane handling (hardened further by order 437 if still open). This order only adds the missing `http.js` central branch; do not touch `cdn-object.js`. |
| "Is `retry-after: 30` the right value, or should I ask?" | No, reuse the exact value the DB-outage branch already uses (`res.setHeader('retry-after', '30')`) for consistency. |

## Report format

State: the three `http.js` locations changed (file + function name), the new test file and its case count, the vitest pass count before and after for the new file plus confirmation the pre-existing `http-*` test files are unaffected, the `check:rules` result, and the commit hash. If the live R2 outage resolved or changed state between your Step 0 re-measurement and completion, say so in one line; it does not change what to ship.
