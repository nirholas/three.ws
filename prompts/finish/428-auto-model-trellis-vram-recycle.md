# 428: give model-trellis a VRAM recycle guard before its own liveness probe kills it mid-job

**How to run this:** paste this whole file into a fresh Claude Code session opened in the
`three.ws` repo (any worktree). No TARGET needed; this file is complete on its own.

## Binding operating clause

1. Finish 100%. Never end this task with a question, a plan, or "want me to proceed?". Pick
   the reasonable interpretation and ship it. The only exception is the real production
   deploy of `model-trellis`, which is gate-2 (GPU Cloud Run service): leave that single
   `gcloud builds submit` step for the owner and say so in the report. Everything else,
   including writing and passing new tests, is this agent's job to finish, not describe.
2. No mocks, no fake data, no stub functions, no `TODO`, no commented-out code, no
   `setTimeout` fake-anything, no em dash (`—`) or en dash (`–`) anywhere you write text.
3. This is a bug fix: write a failing test that reproduces the gap FIRST, confirm it fails
   for the right reason, then fix the code, then confirm it passes. Commit the test and the
   fix together.
4. Stage explicit paths only (never `git add -A` or `git add .`). Other agents share this
   worktree and may have unrelated work staged; re-run `git status` and
   `git diff --staged` immediately before your commit to make sure you are only committing
   what you touched.
5. Commit message must describe the diff (see CLAUDE.md "Commit messages"): no "sync",
   "wip", "update", "chore: progress", etc. Something like
   `fix(model-trellis): recycle an instance before VRAM exhaustion kills it mid-job, not after`.

## Why this order exists (measured 2026-10-24)

`model-trellis`'s own `/health` liveness probe killed a live instance mid-inference TODAY:

```
2026-10-24T09:35:02.912342Z ERROR LIVENESS HTTP probe failed 3 times consecutively for
  container "server-1" on port 8080 path "/health". The instance has been shut down.
  Connection failed with status ERROR_TIMEOUT.
```

That kill was preceded and followed by a storm of Cloud Run "malformed response or
connection error" 502s as clients tried to reach the dying instance (same minute, dozens of
occurrences; `gcloud logging read` command to reproduce is in Step 0). This is not a one-off:
the exact failure mode is already diagnosed in the worker's own source, left behind from a
prior incident, at `workers/model-trellis/main.py:829-845` (the `finally:` block of
`_run_job`):

> "Nothing else frees it. Torch's caching allocator holds freed blocks in reserve, and
> nvdiffrast's rasterizer allocates through its own cudaMalloc outside that cache, so an
> instance's usable VRAM only ever shrinks. The instance stays healthy for a while and then
> fails EVERY later job with `Cuda error: 2[cudaMalloc(&m_gpuPtr, bytes);]` out of
> postprocess_mesh's `_fill_holes`, while its health check keeps passing and Cloud Run keeps
> routing to it. That is exactly how this lane died: 1,189 generations on 2026-09-06, then on
> 2026-09-09 thirteen jobs succeeded after a restart and every single job after them failed."

`_release_gpu_memory()` (`main.py:848-858`) already calls `torch.cuda.empty_cache()` and
`torch.cuda.ipc_collect()` after every job, and the comment explains why that is not enough:
nvdiffrast's own `cudaMalloc` calls never go through torch's allocator, so they are
unreachable by `empty_cache()`. VRAM only ratchets down.

The worker already has exactly this pattern for HOST memory: `instance_health.py`'s
`MemorySample` + `should_recycle()`, wired into `main.py`'s `_recycle_if_bloated()`
(`main.py:641-675`), drains and restarts an instance BETWEEN jobs once host RAM has
ratcheted past `RECYCLE_FRACTION` (80%) and grown at least `RECYCLE_MIN_GROWTH` (15%) past
its post-load baseline. That guard reads cgroup memory files; it cannot see GPU device
memory at all, so it never fires on this leak. There is no VRAM equivalent anywhere in the
file (confirmed: `grep -n "memory_allocated\|memory_reserved\|mem_get_info\|VRAM" main.py
instance_health.py` returns nothing today). That is the gap: an instance can be well under
its RAM ceiling while its VRAM is exhausted, so it runs straight into the liveness-probe kill
instead of recycling cleanly between jobs the way the RAM guard already does.

This is a **live production defect** (today's kill is proof, not history) with a **known,
already-diagnosed root cause**, and a **direct, non-owner-gated code fix** that extends an
existing, already-tested pattern in the same file rather than inventing a new one. Per
RUN-ORDER (live defect with a real fix outranks everything not already in flight), this is
this run's top order.

## Step 0: re-derive current state (re-run before touching anything)

```bash
# 1. Confirm the liveness-probe kill is still a live pattern, not historical.
gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="model-trellis" textPayload:"LIVENESS HTTP probe failed"' \
  --project aerial-vehicle-466722-p5 --freshness=168h --limit=50 --format="value(timestamp)"

# 2. Confirm no VRAM-aware guard exists yet (should return nothing).
grep -n "memory_allocated\|memory_reserved\|mem_get_info\|vram\|VRAM" \
  workers/model-trellis/main.py workers/model-trellis/instance_health.py

# 3. Re-read the leak diagnosis and the existing RAM-guard wiring in full.
sed -n '620,680p;825,860p' workers/model-trellis/main.py
sed -n '1,220p' workers/model-trellis/instance_health.py

# 4. Confirm current healthz / test baselines so you know what you touched vs. pre-existing.
curl -s --max-time 15 https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin);[print(s['name'],s['status']) for s in d['subsystems']['subsystems']]"
cd workers/model-trellis && python3 -m pytest test_instance_health.py test_app_contract.py -q
```

If step 1 returns zero rows in the last 168h, the kill has stopped recurring on its own;
still ship the fix (the root cause in the code comment is unchanged and the next heavy job
will reproduce it), but note the gap in your report rather than treating it as resolved.

## Tasks

1. **Add a VRAM sample type and recycle check to `workers/model-trellis/instance_health.py`**,
   next to `MemorySample`/`read_memory`/`should_recycle` (this module is pure stdlib today;
   keep it that way, torch is NOT importable here, the caller passes in numbers it already
   has from `torch.cuda.mem_get_info()`):
   - A `VramSample` dataclass (or reuse `MemorySample`'s shape: `used_bytes`, `limit_bytes`,
     `source="cuda"`, with the same `.fraction` and `.describe()`), built from
     `torch.cuda.mem_get_info()` return values (`free_bytes, total_bytes`; used = total - free).
   - `VRAM_RECYCLE_FRACTION` (env `VRAM_RECYCLE_FRACTION`, default `0.90`, matching the
     tighter ceiling a VRAM OOM implies versus the host-RAM `0.80`) and
     `VRAM_RECYCLE_MIN_GROWTH` (env `VRAM_RECYCLE_MIN_GROWTH`, default `0.10`).
   - Reuse `should_recycle()` as-is if `MemorySample` covers the VRAM shape (preferred, avoids
     duplicating logic); only add a new function if the shapes genuinely diverge.
2. **Wire it into `workers/model-trellis/main.py`:**
   - In `_load_pipeline()` (around line 281-296), after `_memory_baseline = read_memory()`,
     add a `_vram_baseline` sample captured the same way, using
     `torch.cuda.mem_get_info()` when `torch.cuda.is_available()`, else `None`.
   - In `_recycle_if_bloated()` (`main.py:641-675`), after `_release_gpu_memory()` has already
     run for the job (it's called from `_run_job`'s `finally`, which completes before
     `_run_inference`'s `finally` calls `_recycle_if_bloated`), sample current VRAM the same
     way and OR it into the existing recycle decision: recycle if the RAM guard says so, OR
     the VRAM guard says so. Log which guard fired (extend the existing `log.warning(...)`
     call, do not add a second one) so a future incident is diagnosable from logs alone.
   - Guard every new `torch.cuda.*` call behind `torch.cuda.is_available()` exactly like
     `_release_gpu_memory()` already does, so the unit tests (which import this module
     without a GPU) keep working untouched.
3. **Tests first, per the bug-fix-is-test-first rule:** add to
   `workers/model-trellis/test_instance_health.py` (or a focused new test file beside it if
   the VRAM shape diverges enough to need its own helpers) cases mirroring the existing RAM
   ones (`test_recycles_a_ratcheted_instance`, `test_leaves_a_healthy_instance_alone`,
   `test_high_baseline_alone_never_recycles`, `test_unknown_memory_never_recycles`) applied to
   the VRAM sample/threshold. Also add a `main.py`-level test (alongside
   `test_app_contract.py`'s existing patterns, mocking `torch.cuda.mem_get_info` and
   `torch.cuda.is_available` the way that file already mocks CUDA availability) proving
   `_recycle_if_bloated` drains and signals a restart when VRAM alone has ratcheted past
   threshold even though host RAM is nowhere near its ceiling. Run the new tests, confirm
   they fail against the pre-fix code for the right reason (no VRAM path exists yet), then
   make them pass.
4. **Update `workers/model-trellis/README.md`** if it documents the recycle thresholds (grep
   for `RECYCLE_FRACTION` in it first) so the new `VRAM_RECYCLE_FRACTION` /
   `VRAM_RECYCLE_MIN_GROWTH` env vars are discoverable the same way the RAM ones are.
5. Append a `data/changelog.json` entry (internal/reliability category) describing the fix in
   user-relevant terms (Forge image-to-3D jobs on the `trellis` lane failing or stalling less
   often), per CLAUDE.md's Definition of Done. Run `npm run build:pages` after.

## Definition of done (mechanically checkable)

- [ ] `grep -n "mem_get_info" workers/model-trellis/main.py workers/model-trellis/instance_health.py` finds the new code.
- [ ] `cd workers/model-trellis && python3 -m pytest -q` passes, including new VRAM-guard tests, with zero changes to pre-existing test outcomes.
- [ ] The new tests, run against a git stash of just the `instance_health.py`/`main.py` changes (or checked out pre-fix), fail for the VRAM-guard-missing reason, not a setup error. State the before/after pytest output in the report.
- [ ] `_recycle_if_bloated` recycles on VRAM growth alone (synthetic `mem_get_info` returning a shrinking "free" value across calls) even when the RAM sample is healthy, proven by a passing test.
- [ ] No new `torch.cuda.*` call is reachable without a `torch.cuda.is_available()` guard (grep confirms every new call site is inside such a guard or inside a function already gated by one).
- [ ] `npm run check:rules -- --paths workers/model-trellis/main.py workers/model-trellis/instance_health.py workers/model-trellis/test_instance_health.py` clean.
- [ ] `data/changelog.json` has a new entry; `npm run build:pages` run after.
- [ ] Code + tests committed with explicit paths; deploy (`gcloud builds submit` for `model-trellis`) is the one step left for the owner, named plainly in the report.

## Never blocked (pre-answered)

| Blocker | Do this |
|---|---|
| No GPU available in this environment to run real CUDA calls | Mock `torch.cuda.mem_get_info` and `torch.cuda.is_available` in tests, exactly as `test_app_contract.py` already does for other CUDA-gated paths. The unit tests must never require a real GPU; that is why `instance_health.py` is pure stdlib today. |
| Can't verify the fix against a live GPU instance | That requires deploying `workers/model-trellis` to Cloud Run, a gate-2 action. Finish and commit all code and tests so the fix is deploy-ready; name the exact `gcloud builds submit` step as the owner's one remaining action. Do not stall on it. |
| Unsure whether to reuse `MemorySample` or add `VramSample` | Reuse `MemorySample` if its three fields (`used_bytes`, `limit_bytes`, `source`) fit VRAM without a lie in the field names; only branch into a new type if something about VRAM genuinely does not fit (there is no such need identified in this order; default to reuse). |
| Unsure what the right VRAM threshold is since there's no historical VRAM telemetry to calibrate against | Use the defaults specified in Task 1 (`0.90`/`0.10`), tighter than the RAM guard's `0.80`/`0.15` because a VRAM OOM has no graceful fallback (it crashes the job), whereas host RAM pressure degrades first. Make both overridable by env var exactly like the RAM pair, so the owner can tune later without a code change. |
| `npm run check:rules` or `check:claude` fails on an unrelated pre-existing issue | Fix only what your diff touches; if the failure is clearly pre-existing and unrelated, note it in the report rather than scope-creeping into an unrelated fix. |

## Report format

1. Step 0 output: the fresh `gcloud logging read` liveness-kill count for the last 168h, and
   the pre-fix `grep` proving no VRAM guard existed.
2. The diff summary: files touched, one line each.
3. Before/after test output proving the new tests fail pre-fix and pass post-fix.
4. The exact commit hash(es) and message(s).
5. The one named owner action remaining (the `model-trellis` Cloud Run deploy), or "none" if
   somehow not applicable.
