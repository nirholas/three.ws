# 403. Close the forge_generation blind spot: cron-observed NVIDIA NIM failures never cool the submit-time lane

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order." Runnable now, no gate. Written by the evolve scout lane on 2026-10-13 from the measurements below.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question or an unexecuted plan; a judgment call goes in one line of the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/sign/mint, push/deploy/post, committing content naming a crypto project other than $THREE, destroying unrecoverable data). Nothing in this order needs any of those; the fix is a local code change, tested and committed, with no deploy step in its own definition of done (deploys are owner-gated per CLAUDE.md's deploy runbook; this order stops at "ready to ship").
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code.
- The em-dash and en-dash characters are banned in everything you write.
- Bug fixes are test-first (CLAUDE.md, owner directive 2026-10-10): write the failing test for the exact pure-function gap described below, confirm it fails for the stated reason, then fix, then confirm it passes. Commit the test with the fix.
- Stage explicit paths only (never `git add -A` or `git add .`); re-check `git status` and `git diff --staged` immediately before committing.

## Why this matters (measured 2026-10-13, HEAD `05fdde784`)

**Live symptom, re-measured just now:**

    curl -s https://three.ws/api/healthz | node -e "const d=require('/dev/stdin');console.log(JSON.stringify(d.subsystems.subsystems.find(s=>s.name==='forge_generation'),null,2))"

returned:

```
{
  "name": "forge_generation",
  "status": "down",
  "detail": "0% success (0/15 finished, 6 hours); 15 failed (image path, nvidia lane, mostly \"NVCF request not found or expired\")",
  "metrics": {
    "windowHours": 6, "done": 0, "failed": 15, "attempts": 15, "rate": 0,
    "worstBackend": { "backend": "nvidia", "failed": 15 },
    "topReason": { "reason": "NVCF request not found or expired", "n": 6 }
  }
}
```

The `"image path"` in the detail string is `forge_creations.path`, three.ws's internal name for the default product surface (the main "type a prompt, get a model" flow); it does not mean an image was uploaded. Confirmed with a direct DB query (`api/_lib/db.js` exports `sql`, a Neon tagged-template proxy, not a `query()` function):

    node --env-file=.env --env-file-if-exists=.env.local -e "
    import('./api/_lib/db.js').then(async ({ sql }) => {
      const rows = await sql\`select id, backend, path, error, prompt, preview_image_url is not null as has_image, created_at
        from forge_creations where status='failed' and backend='nvidia' and created_at > now() - interval '8 hours'
        order by created_at desc limit 20\`;
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    });"

Every one of the 15 rows has `has_image: false` and a real text prompt ("Pikachu, centered, standing neutrally...", "a ceramic robot figurine", "masterpiece, best quality, ultra-detailed, 3D model reference sheet..."). Errors split roughly 6 `"NVCF request not found or expired"` and 9 `"generation timed out after 45/46/47 minutes"`, spanning 2026-10-13T14:03 to 17:56 UTC, i.e. a continuous ~4-hour failure stretch on the free text-to-3D lane, not a single blip. Confirmed live and healthy right now with `gcloud run services list --platform=managed --region=us-central1 --project=aerial-vehicle-466722-p5`: the self-host GPU fleet (`model-trellis`, `model-trellis2`, `model-hunyuan3d`, `model-hunyuan3d-21`, `model-triposg`, `model-modly`) is up throughout this window, so this is not a platform-wide outage; it is specific to the free NVIDIA NIM text lane.

**Root cause, read directly in the code (not inferred):**

NVIDIA NIM is the platform's only text-to-3D backend (`api/_providers/nvidia.js` is the one provider exporting `textTo3d`; no self-host or other free lane accepts a bare text prompt, confirmed by grep: `grep -n "textTo3d" api/_providers/*.js` matches nothing else). `api/_lib/forge-failover.js` explicitly excludes nvidia from its poll-time redispatch chain for exactly this reason (its own comment, line ~51): "NVIDIA is excluded (text-only, and a poll-time redispatch always reconstructs from a stored reference image)." So there is no alternate lane to fail a stuck text prompt over to; the only two real defenses are (a) stop feeding new requests into a lane that is currently broken, and (b) give an already-stuck job one real retry before declaring it dead.

Neither defense is wired for the cron-observed failure path:

- `api/forge.js` already has a working submit-time circuit breaker for this exact lane: `NIM_TRELLIS_COOLDOWN_KEY = 'forge-nim-trellis'` (line 178), `markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds(err))` fired on a submit failure (line 624, inside `runNvidiaTextLane`), and read before every new free-text submission (`providersInCooldown([NIM_TRELLIS_COOLDOWN_KEY, ...])` at lines ~1940 and ~2811) to skip straight to the paid/image-intermediate path when the lane is known-bad. This works, but only for failures the *submit* call itself observes synchronously.
- `api/cron/forge-finalize.js` is the ONLY place that ever observes a POLL-time failure on this lane (lines 378-454: the `row.backend === 'nvidia'` branch), because the free lane stores the bare NVCF request id and nothing else ever polls it again after the browser stops. This is exactly the architecture the file's own header describes for self-host lanes ("the worker only declares an orphan long after every browser has stopped polling, so the cron is the ONLY consumer of that failure"), but unlike the self-host branch just above it (lines 299-341, which calls `markLaneUnhealthy(row.backend)` before giving up), the nvidia branch never calls `markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, ...)` anywhere in its own give-up paths: not in the `nvcf_expired` fallthrough (lines 408-441, when the resubmit lock is already held or the resubmit itself fails) and not in the final bare-TTL `markFailed` at lines 460-466.

The measured consequence: across a continuous ~4-hour run of 15/15 failures, the submit-time breaker never once engaged from the cron's side, so every new incoming free-text generation during that entire window kept landing on the same broken lane and kept paying the same dead end, instead of failing over to the paid/`trellis` text-via-image-intermediate path within seconds of the first cron-observed failure. Separately, every stuck job that is not an explicit `nvcf_expired` gets exactly one chance (its own first poll) before being declared dead at the full 45-minute `HARD_TTL_MINUTES`, with no intermediate resubmit attempt, even though the codebase already has the exact mechanism for one: the `nvcf_expired` branch's resubmit (`nvidia.textTo3d({ prompt: row.prompt, tier: resolveTier(row.tier) })` under an `acquireLock` so it only fires once per job, lines 414-439) just never fires for a job that is merely stuck/unresolvable rather than explicitly 404'd.

Not a duplicate of any tracked item: grepped `prompts/finish/_context/production-100-OWNER-ACTIONS.md` for `nvidia`/`NVCF`/`forge-nim`: the only `forge_generation` mention there is an older, already-closed root cause (commit `2f2fedf99`, a Pollinations 402-cooldown bug), unrelated to this. Not the Solana RPC exhaustion (row 24) or the R2 outage (row 36, order 400): this lane's failures carry no RPC or storage error text at all, confirmed by the DB query above. Does not overlap order 400 (`object_storage`), 401 (test suite), 402 (`npm run gate`), or 404 (branch reconciliation): none of those files mention `nvidia`, `NVCF`, or `textTo3d` (confirmed by grep before writing this order).

## Step 0: re-derive the current state

    git log --oneline -1
    curl -s https://three.ws/api/healthz | node -e "const d=require('/dev/stdin');console.log(JSON.stringify(d.subsystems.subsystems.find(s=>s.name==='forge_generation'),null,2))"
    grep -n "NIM_TRELLIS_COOLDOWN_KEY\|markProviderCooldown\|nimCooldownSeconds" api/forge.js | head -20
    grep -n "markLaneUnhealthy\|markProviderCooldown\|HARD_TTL_MINUTES\|nvcf_expired\|row.backend === 'nvidia'" api/cron/forge-finalize.js

If `forge_generation` already reads `ok` or the failure concentration has moved to a different backend, re-read the current `forge_creations` rows with the query in the "Why this matters" section before assuming this order is stale; the underlying gap (cron never cools the submit-time breaker, no stall-resubmit) is a code-structure fact independent of the current failure rate, so fix it regardless, but say in the report whether the live symptom still reproduces.

## Tasks

1. **Export the cooldown key so both files share one source of truth.** In `api/forge.js`, change `const NIM_TRELLIS_COOLDOWN_KEY = 'forge-nim-trellis';` (line ~178) to `export const NIM_TRELLIS_COOLDOWN_KEY = 'forge-nim-trellis';`. `nimCooldownSeconds` (line ~223) is already exported; it safely defaults to `NIM_FORGE_COOLDOWN_SECONDS` (120s) when called with no error object, so `forge-finalize.js` can call `nimCooldownSeconds()` with no argument for a generic cron-observed failure. Do not duplicate the string literal anywhere.

2. **Add a pure, exported decision function next to `decideFailedSweep` in `api/cron/forge-finalize.js`**, in the same no-I/O, fully-testable style:

   ```js
   export function decideNvidiaStall({
       ageMinutes,
       alreadyResubmitted = false,
       attendedBudgetMinutes = ATTENDED_POLL_BUDGET_MINUTES,
       hardTtlMinutes = HARD_TTL_MINUTES,
   } = {}) {
       if (!Number.isFinite(ageMinutes) || ageMinutes < attendedBudgetMinutes) return 'defer';
       if (ageMinutes >= hardTtlMinutes) return 'terminal';
       if (alreadyResubmitted) return 'defer';
       return 'resubmit';
   }
   ```

   Mirror the reasoning already in the file's comments for `decideFailedSweep`: `defer` inside the attended window (a live browser tab is still polling and runs its own recovery), `resubmit` once past that window but before the hard TTL and only if not already resubmitted this job, `terminal` past the hard TTL (the bare TTL check below still reaps it). Write the test for this function FIRST in `tests/forge-finalize.test.js` (beside the existing `decideFailedSweep` tests), covering: defers inside the attended budget; resubmits once past it; does not resubmit twice; goes terminal at/past the hard TTL regardless of the resubmit flag. Run it, confirm it fails (the function does not exist yet), then write the function, then confirm the test passes.

3. **Wire the stall-resubmit into the nvidia poll branch** (`api/cron/forge-finalize.js`, inside the `row.backend === 'nvidia' && nvidia` block, ~lines 378-454). After the existing `status?.status === 'done'` check and before the existing `nvcf_expired` check, add a branch for the case the status call came back non-terminal (still `running`/`queued`, or `status` itself was `null` from the `.catch(() => null)`): compute `ageMinutes` (already in scope) and call `decideNvidiaStall({ ageMinutes, alreadyResubmitted: Boolean(await cacheGet(\`nvcf:stall-resub:${row.replicate_job_id}\`)) })`. On `'resubmit'`: under a NEW lock key distinct from the existing `nvcf:resub:` one (e.g. `acquireLock(\`nvcf:stall-lock:${row.replicate_job_id}\`, NVCF_ALIAS_TTL_S)`, so this can never double-fire with the `nvcf_expired` resubmit path), call `nvidia.textTo3d({ prompt: row.prompt, tier: resolveTier(row.tier) })`; on a returned `taskId`, `cacheSet` it to the SAME alias key the `nvcf_expired` path already uses (`nvcf:alias:${row.replicate_job_id}`) so the next tick (and any attended poller still holding the original handle) picks up the new task transparently, and record `cacheSet('nvcf:stall-resub:' + row.replicate_job_id, '1', NVCF_ALIAS_TTL_S)` so it never fires twice; log with `console.warn` in the same style as the existing `[forge-finalize]` lines; `continue` to the next row (do not fall through to the TTL check this tick). On a thrown error from `textTo3d`, catch it, `console.warn`, and fall through to the cooldown step below.

4. **Cool the submit-time breaker from every cron give-up point for this lane.** Add `markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds()).catch(() => {})` (import `markProviderCooldown` from `../_lib/provider-health.js`, already imported in `forge-finalize.js`'s sibling self-host branch via `markLaneUnhealthy`; import `NIM_TRELLIS_COOLDOWN_KEY` and `nimCooldownSeconds` from `../forge.js`) at BOTH of these points: (a) the `nvcf_expired` fallthrough when the resubmit lock is already held or the resubmit itself throws (the existing `catch (err)` at line ~436, plus the "lock held by a prior recovery" fallthrough path), and (b) immediately before the final bare-TTL `markFailed` call at lines ~460-466, scoped to `row.backend === 'nvidia'` only (do not cool the lane for self-host envelope timeouts, which already have their own `markLaneUnhealthy` call in the branch above). This makes the cron's poll-time observations feed the exact same breaker `forge.js`'s submit path already reads, so a lane that is failing on every poll gets skipped by new submissions within the existing 120-second cooldown window instead of silently accepting new work into it for up to 45 more minutes.

5. **Run the full check.** `npx vitest run tests/forge-finalize.test.js --reporter=verbose` (new tests pass, old ones still pass), then `npm run check:rules -- --paths api/forge.js api/cron/forge-finalize.js tests/forge-finalize.test.js`.

## Definition of done

- [ ] `NIM_TRELLIS_COOLDOWN_KEY` is `export const` in `api/forge.js`; `forge-finalize.js` imports it (and `nimCooldownSeconds`) rather than redeclaring the string.
- [ ] `decideNvidiaStall` is exported from `api/cron/forge-finalize.js`, with a failing-then-passing test in `tests/forge-finalize.test.js` covering defer/resubmit-once/terminal, committed together per the test-first rule.
- [ ] The nvidia poll branch attempts exactly one stall-resubmit (under its own lock, distinct from the `nvcf_expired` lock) before a stuck job reaches the hard TTL.
- [ ] Both give-up points for `backend === 'nvidia'` (the exhausted-expired fallthrough and the bare-TTL timeout) call `markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, ...)`.
- [ ] `npx vitest run tests/forge-finalize.test.js` passes, 0 failures.
- [ ] `npm run check:rules -- --paths api/forge.js api/cron/forge-finalize.js tests/forge-finalize.test.js` exits 0.
- [ ] `git status --short` is empty except files intentionally left for a follow-up, each named in the report.
- [ ] This file is deleted in the closing commit (`git rm prompts/finish/403-auto-forge-nvidia-lane-cooldown-gap.md`) once every box above is checked with real command output, per the retirement rule in `prompts/README.md`.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `forge_generation` already reads `ok` when you start | Re-run the DB query in "Why this matters"; if the failure concentration has genuinely moved off nvidia, the code gap described here is still real and still worth closing (it is a structural blind spot, not a symptom that can self-heal): finish the fix anyway and say so in the report. |
| `gcloud` auth or the production DB is unreachable from this session | Everything in this order is a local code change plus a unit test; neither requires live GCP or DB access to implement or verify. Note the outage in the report and proceed. |
| A vitest run shows an unrelated pre-existing failure in `tests/forge-finalize.test.js` | Triage it separately from this order's own new tests; do not let it block committing this fix. Name it in the report. |
| Unsure whether `nimCooldownSeconds()` (no argument) picks the right duration | It falls through to the 120-second default (`NIM_FORGE_COOLDOWN_SECONDS`), the same value a socket-timeout submit failure already earns; that is the correct conservative choice for a cron-observed failure with no HTTP status to inspect. Do not invent a new constant. |
| The fix is done but you cannot confirm it fixed production | Correct: this order's definition of done stops at tested-and-committed, not deployed. Deploys are owner-gated. Say so plainly in the report; do not claim the live healthz number will change until the next deploy carries this commit. |

## Report format

1. Step 0 output (current HEAD, current `forge_generation` healthz block, grep confirmations).
2. Per task: what changed, file and line ranges touched.
3. Test output: the new `decideNvidiaStall` tests failing first, then passing; the full `tests/forge-finalize.test.js` run; `check:rules` exit code.
4. `git status --short` and the exact commit(s) made.
5. One line confirming this file was deleted in the closing commit, or why not.
6. No trailing questions.
