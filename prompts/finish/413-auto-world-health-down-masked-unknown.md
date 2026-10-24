# 413. Fix world-health observability: a down world.three.ws reports as `unknown`, not `down`

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required for the code fix (one owner decision on the underlying service is filed separately, see Task 3).

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: reproduce with a failing test before touching the fix, confirm it fails for the stated reason, then fix, then confirm green. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them: it edits a cron handler, a health gatherer, and two test files, and files a decision row, nothing more.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

Confirm world.three.ws is genuinely unreachable right now, not a transient blip:

    curl -s -o /dev/null -w "status: %{http_code}\n" https://world.three.ws/status
    curl -s -o /dev/null -w "root: %{http_code}\n" https://world.three.ws/

As measured 2026-10-24: both return `404` (a generic Google Frontend page, not a Hyperfy response). Confirm the platform's own health rollup is hiding this, not reporting it:

    curl -s https://three.ws/api/healthz | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const w=j.subsystems.subsystems.find(s=>s.name==='world');console.log(JSON.stringify(w))})"

As measured 2026-10-24: `{"name":"world","label":"world.three.ws (Hyperfy)","status":"unknown","detail":"no world-health report yet"}`. `unknown` reads as "nobody has checked", which is false: the cron checks every 15 minutes and knows the world is down (see below). `unknown` is also excluded from the `down`/`degraded` roll-up (`UNHEALTHY = ['down', 'degraded']` in `api/_lib/ops/subsystem-health.js`), so this subsystem's failure does not even count against the platform's overall health status.

Confirm the cron itself is already detecting and alerting on the outage (ruling out "the cron isn't running" as the explanation):

    export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' | tail -1)"
    node -e "
    import('./api/_lib/db.js').then(async ({ sql }) => {
      const rows = await sql\`SELECT signature, count, first_seen, last_seen FROM ops_alerts WHERE signature LIKE 'world-health%' ORDER BY last_seen DESC LIMIT 5\`;
      console.log(rows);
      process.exit(0);
    });
    "

Expect to see `world-health:status-http` or `world-health:status-unreachable` with a recent `last_seen`, confirming the cron has been alerting on this correctly all along. The alert firing and the health page saying `unknown` are the two separate, inconsistent facts this order reconciles.

## Root cause

`api/cron/world-health.js`'s handler has two early-return branches for a down world:

1. `if (!r.ok)` (line 92, `/status` answered a non-2xx status)
2. `catch (e)` (line 99, the fetch to `/status` threw, typically a timeout or DNS/connection failure)

Both branches call `sendOpsAlert(...)` (which is why `ops_alerts` correctly shows the outage) and then `return json(res, 200, { status: 'down', ... })` to their own caller, the Cloud Scheduler cron infra (which is why Cloud Scheduler logs show clean 200s every 15 minutes: the cron ran successfully and reported `down` in its own response body). Neither branch calls `cacheSet(WORLD_HEALTH_CACHE_KEY, ...)`. Only the success path at the bottom of the handler (line 188) parks a verdict in the cache:

    await cacheSet(
        WORLD_HEALTH_CACHE_KEY,
        { status: outcome, protected: isProtected, problems, missingCount: missing.length, checkedAt: Date.now() },
        WORLD_HEALTH_TTL_S,
    ).catch(() => {});

`api/_lib/ops/subsystem-health.js`'s `checkWorld()` (lines 332-358) reads that same cache key to answer `/api/healthz`. Because the down branches never write to it, the key is either empty (`status: 'unknown', detail: 'no world-health report yet'`) or holds a stale `ok`/`degraded` verdict from before the outage started, until `WORLD_STALE_MS` (90 minutes) elapses and it falls back to `unknown` again. Compounding this, `checkWorld()` itself has no branch that can ever produce `status: 'down'` even if the cache held one: its only three outcomes are `ok`, `degraded`, and `unknown`. Both halves of this pipeline need the fix; fixing only one leaves the other masking it.

This is a real, currently-live defect in the platform's own observability, independent of why world.three.ws is down. The service backing the `world.three.ws` domain mapping, `hyperfy-world`, was deleted via the Cloud Run API (confirmed by Cloud Audit Logs: `protoPayload.methodName="google.cloud.run.v1.Services.DeleteService"`, actor `nich@sperax.io`, `2026-10-23T02:48:38Z`) while the domain mapping itself remains fully provisioned and now dangles. Whether the owner wants to redeploy or formally retire the world is a decision this order does not make (Task 3 below files it); either way, `/api/healthz` should say `down`, not `unknown`, while it waits for that decision, and should say `ok` immediately if a future redeploy succeeds.

## Task

### 1. Reproduce the bug with failing tests

Open `tests/world-health-asset-sweep.test.js`. It already mocks both dependencies at module scope (`vi.mock('../api/_lib/alerts.js', ...)` and `vi.mock('../api/_lib/cache.js', ...)`) and imports `sendOpsAlert` to assert on it, but never imports `cacheSet`, so no existing test can assert on cache writes. Add the import next to the existing one:

    import { sendOpsAlert } from '../api/_lib/alerts.js';
    import { cacheSet } from '../api/_lib/cache.js';

In `beforeEach`, alongside `sendOpsAlert.mockReset();`, add `cacheSet.mockReset();` so call counts do not leak between tests.

Add two new test cases inside `describe('world-health asset sweep', ...)` (after the existing five):

    it('parks a down verdict when /status answers a non-2xx status', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).endsWith('/status')) return { ok: false, status: 503, json: async () => ({}) };
            throw new Error('must not HEAD any asset when /status itself failed');
        }));
        const body = await run();

        expect(body.status).toBe('down');
        expect(sendOpsAlert).toHaveBeenCalledTimes(1);
        expect(sendOpsAlert.mock.calls[0][0]).toBe('World DOWN');
        expect(cacheSet).toHaveBeenCalledTimes(1);
        expect(cacheSet.mock.calls[0][0]).toBe('world:health');
        expect(cacheSet.mock.calls[0][1]).toMatchObject({ status: 'down', protected: null });
    });

    it('parks a down verdict when /status is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        }));
        const body = await run();

        expect(body.status).toBe('down');
        expect(cacheSet).toHaveBeenCalledTimes(1);
        expect(cacheSet.mock.calls[0][1]).toMatchObject({ status: 'down', protected: null });
    });

Run `npx vitest run tests/world-health-asset-sweep.test.js` and confirm both new cases fail (the `cacheSet` assertions fail because the mock was never called; `cacheSet.mock.calls[0]` is `undefined`). Confirm the failures are these exact assertions, not an unrelated setup error.

Open `tests/subsystem-health.test.js`. Add a new case directly after the existing `it('reports world as DEGRADED (unprotected) from a parked world-health outcome', ...)` block (around line 172):

    it('reports world as DOWN from a parked world-health outcome', async () => {
        await cacheSet(
            'world:health',
            { status: 'down', protected: null, problems: ['HTTP 503'], missingCount: 0, checkedAt: Date.now() },
            3600,
        );
        const health = await gatherSubsystemHealth({ probeDb: false });
        const world = sub(health, 'world');
        expect(world.status).toBe('down');
        expect(world.detail).toMatch(/503/);
        expect(health.down).toContain('world');
    });

Run `npx vitest run tests/subsystem-health.test.js` and confirm this new case fails (`checkWorld()` has no `down` branch, so it falls through to the `degraded`/`ok` checks and currently returns `ok`, since `parked.protected` is `null` not `false` and `parked.status` is `'down'` not `'degraded'`).

### 2. Fix both halves of the pipeline

In `api/cron/world-health.js`, add a best-effort `cacheSet` call to each down branch, matching the shape the success path already writes (`status`, `protected`, `problems`, `missingCount`, `checkedAt`) so `checkWorld()` can read one consistent payload shape regardless of outcome:

    if (!r.ok) {
        sendOpsAlert('World DOWN', `${WORLD_STATUS_URL} returned HTTP ${r.status}`, {
            signature: 'world-health:status-http',
        });
        await cacheSet(
            WORLD_HEALTH_CACHE_KEY,
            { status: 'down', protected: null, problems: [`HTTP ${r.status}`], missingCount: 0, checkedAt: Date.now() },
            WORLD_HEALTH_TTL_S,
        ).catch(() => {});
        return json(res, 200, { status: 'down', protected: null, blueprintCount: 0, reason: `HTTP ${r.status}` });
    }

and in the `catch` block:

    } catch (e) {
        const reason = e?.name === 'TimeoutError' ? 'timeout' : e?.message || 'unreachable';
        sendOpsAlert('World DOWN', `${WORLD_STATUS_URL} unreachable - ${reason}`, {
            signature: 'world-health:status-unreachable',
        });
        await cacheSet(
            WORLD_HEALTH_CACHE_KEY,
            { status: 'down', protected: null, problems: [reason], missingCount: 0, checkedAt: Date.now() },
            WORLD_HEALTH_TTL_S,
        ).catch(() => {});
        return json(res, 200, { status: 'down', protected: null, blueprintCount: 0, reason });
    }

In `api/_lib/ops/subsystem-health.js`'s `checkWorld()`, add a branch for the parked `down` status. Place it right after the staleness check and before the `protected === false` check (a down verdict is more severe than an unprotected one, and the two are mutually exclusive in practice since a down world never had a chance to report its protection state):

    const age = parked.checkedAt ? Date.now() - parked.checkedAt : Infinity;
    if (age > WORLD_STALE_MS) {
        return { ...base, status: 'unknown', detail: 'world-health report is stale' };
    }
    if (parked.status === 'down') {
        return { ...base, status: 'down', detail: (parked.problems || []).join('; ') || 'world unreachable' };
    }
    if (parked.protected === false) {

Re-run both test files: `npx vitest run tests/world-health-asset-sweep.test.js tests/subsystem-health.test.js`. Confirm every case passes, the four new ones included.

### 3. File the owner decision this does not make

The code fix above makes `/api/healthz` tell the truth about world.three.ws regardless of why it is down. It does not decide whether the owner wants the world back. Add this row to the end of the "Open rows" list in `prompts/finish/_context/production-100-OWNER-ACTIONS.md` (follow the existing numbering, i.e. one past the current highest row number; re-check the file first since concurrent agents may have added rows since this order was written):

    | N | world.three.ws has been unreachable since the backing Cloud Run service `hyperfy-world` was deleted via the Cloud Run API by `nich@sperax.io` at 2026-10-23T02:48:38Z (confirmed via `gcloud logging read 'protoPayload.methodName="google.cloud.run.v1.Services.DeleteService"'`), a deliberate recent action, not drift. The `world.three.ws` domain mapping is itself still healthy and provisioned; it now points at a service that no longer exists, which is why it answers a generic 404 instead of a branded error. Decide: redeploy (`bash deploy/world/apply-hardening.sh`, fully scripted and idempotent, documented in `deploy/world/README.md`) or formally retire the surface (remove the domain mapping and any in-product links to it). `/api/healthz` now correctly reports this as `world: down` instead of masking it as `unknown` (order 413). | decision | world.three.ws restoration or retirement | `deploy/world/README.md` |

Use `N` as the next free row number at the time you run this (do not hardcode a number that may already be taken by a concurrent agent's row).

### 4. Lint and verify no regression

    npm run check:rules -- --paths api/cron/world-health.js api/_lib/ops/subsystem-health.js tests/world-health-asset-sweep.test.js tests/subsystem-health.test.js

Fix anything it flags. Run the full neighboring suites once more to catch any regression from the `checkWorld()` branch reordering: `npx vitest run tests/world-health-asset-sweep.test.js tests/subsystem-health.test.js`.

## Done when

- `npx vitest run tests/world-health-asset-sweep.test.js tests/subsystem-health.test.js` passes in full, including all four new cases.
- `git diff` shows exactly: the two `cacheSet` additions in `api/cron/world-health.js`, the one new branch in `checkWorld()` in `api/_lib/ops/subsystem-health.js`, the new test cases in both test files, plus whatever `check:rules` required.
- A new row was added to `prompts/finish/_context/production-100-OWNER-ACTIONS.md` naming the exact `DeleteService` event and the owner's redeploy-or-retire choice.
- The fix, its tests, and the OWNER-ACTIONS row are committed together on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist yet) citing the fix commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The service deletion looks deliberate; maybe nobody wants the world back, so is the observability fix even worth it | The bug stands regardless of why the service is down: `/api/healthz` should never say `unknown` about a failure it has already alerted on 100+ times | Fix the code as scoped; the retire-or-redeploy decision is separate and is filed as a row, not solved by this order |
| Tempted to also run `deploy/world/apply-hardening.sh` to just bring the world back | That is a Cloud Build submission, denied to an unattended session, and it presumes the owner wants a redeploy rather than a retirement | Do not run it. File the decision row instead |
| world.three.ws recovers on its own before you run this (another agent redeployed it) | The observability bug is independent of the world's current state | Re-run Step 0's curl check; if it now returns 200, the tests you write still cover the down path correctly (they stub the failure directly, they do not depend on live state), so finish the order unchanged. If a concurrent fix already landed the same `cacheSet`/`checkWorld()` changes, retire this order without a duplicate code change |
| Can't tell who deleted the service or when | `gcloud logging read` against Cloud Audit Logs is authoritative and already queried for you in the Root cause section | Cite the same event; do not re-run the audit-log query unless you want to double check it, it will not have changed |

## Report format

State: the step-0 curl/healthz/ops_alerts output, the failing-test confirmation before the fix (all four new cases), the exact diff for both source files, the passing-test output after the fix, the OWNER-ACTIONS row number added, and the commit SHA.
