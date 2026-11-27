# Forge protected lanes: keep what works, fix everything else

Owner directive, 2026-11-26: **a Forge lane that is measurably working is not switched, reordered, re-tuned, swapped or redeployed while fixing something else. Everything that is not working gets fixed.**

Forge turns a prompt, a photo or a sketch into a 3D model by passing the request down a chain of engines ("lanes"). Most of the traffic lands on one lane that works well. The cheapest way to make Forge worse is to "improve" that lane while chasing a bug somewhere else. This page says which lanes are protected, how that is measured, and what a protected lane does and does not allow.

## The rule

1. **Measure before you touch anything.** Run the command under "Re-measure" below. A status line in a doc, a prompt or a commit message is not a measurement.
2. **A lane is protected when** the last 7 days on `GET https://three.ws/api/nvidia/stats` show at least 20 finished jobs (`done + failed`) and `success_pct` of 85 or more. `trellis_selfhost` is also protected by name, whatever a single bad day shows.
3. **A rung that is the only one serving its step is protected in position.** Fix bugs inside it. Do not remove it, reorder it, or put an unproven rung in front of it.
4. **A feature that passes your live test is protected.** If you exercised it on production and it worked, its code path is not yours to restructure in the same session.
5. **Everything else is open.** A lane that fails more than it succeeds, a rung that is down, a feature that errors: diagnose it, fix it test-first, and add a fallback behind it.

## What "protected" forbids

For `trellis_selfhost` this means, concretely:

- No edits to the worker: [workers/model-trellis/](../../workers/model-trellis/) (code, Dockerfile, Cloud Build files, requirements).
- No change to its Cloud Run service (image, GPU, concurrency, memory, timeouts, env, min or max instances). The 2026-11-25 spend cut also stands: instance floors are never raised without an owner yes.
- No change to its place in the chain or its definition in [api/_lib/forge-tiers.js](../../api/_lib/forge-tiers.js): the `trellis_selfhost` backend entry, its position in `FREE_FALLBACK_FOR_PATH`, `SELF_HOST_IMAGE_LANES`, the `FORGE_SELFHOST_PRIMARY` behavior, and the default table `DEFAULT_BACKEND_FOR_PATH`.
- No change to its sampler settings, `SELFHOST_TRELLIS_QUALITY`, or the request body the API sends to it.
- No change to the shape of what it returns or how its job is polled and finalized.
- No promoting another lane ahead of it, and no demoting it behind a lane with worse numbers.

## What "protected" still allows

- Tests that pin its current behavior, so a later change cannot move it by accident.
- Logging and metrics that read what it does without changing what it does.
- A fallback placed **behind** it, taken only when it has already failed.
- Fixes in the steps before it (prompt direction, the reference image, uploads) and after it (the viewer, exports, the editing tools), as long as the request that reaches the lane is unchanged for inputs that worked before.
- A real bug fix inside a protected lane **only** with a failing test that reproduces the bug, a diff limited to that bug, and the owner's explicit yes before it is committed. Report it; do not gate the rest of your work on it.

## Measured state, 2026-11-26 20:41 UTC

Source: `/api/nvidia/stats` and `/api/forge?health=1` on production. Re-measure before relying on any line here.

Protected:

- **`trellis_selfhost`** (Microsoft TRELLIS `trellis-image-large` on our own NVIDIA L4, us-central1): 911 done and 65 failed in 7 days, 93.3%. It carried 103 of the 143 jobs in the last 24 hours. Median about 150 seconds.
- **The keyless text-to-image rung** in [api/_mcp3d/text-to-image.js](../../api/_mcp3d/text-to-image.js): on this date it was the only rung producing reference images for text prompts, because the rungs ahead of it were refused for billing or credits or were timing out. Protected in position.

Not protected (broken or unproven; fix these):

- `triposg` (sketch to 3D): 25 done and 35 failed in 7 days, 41.7%. Read this figure with care: the lane's backend column also counts photo jobs that landed on TripoSG as the last failover rung (path `image`). Over 30 days the sketch path itself finished 54 of 56 jobs (96.4%), and the two failures were orphaned tasks. The real weak points were unguarded input (blank, dot and full-frame drawings), a dead end when the engine was down, and a healthy lane being cooled for a drawing it could not read; all three are fixed (2026-11-27, see [forge-pipeline.md](../forge-pipeline.md), Sketch to 3D).
- `pixal3d` ("Match my photo"): 2 done and 9 failed in 7 days, 18.2%, and the two successes took about 16 minutes each.
- `trellis2` (the configured first choice): no jobs in 7 days, 2 done and 2 failed in 30 days. Not failing: `MODEL_TRELLIS2_URL` was never set on `three-ws-api`, so the lane is skipped (re-measured 2026-11-26, [trellis2-lane-decision.md](./trellis2-lane-decision.md)).
- `trellis_nvcf` (TRELLIS hosted by NVIDIA): no jobs in 7 days, 60.7% over 30 days.
- `hunyuan3d`: no jobs in 7 days, 8 done and 0 failed in 30 days. Too few to call working.
- The text-to-image rungs ahead of the keyless one, and the prompt-direction LLM chain, were all down on this date.

The 93% covers only jobs that reached a lane. A text prompt that fails while its reference image is being made never creates a job, so it appears in no lane's failure count.

## Re-measure

```bash
npm run forge:lanes              # every Forge lane, last 7 days, PROTECTED or open, from live production stats
npm run forge:lanes -- --check   # also compares with the "Measured state" list above; exits 1 when they disagree
npm run forge:lanes -- --json    # the same rows, machine-readable
curl -s 'https://three.ws/api/forge?health=1' | head -c 2000
```

The script ([scripts/forge-protected-lanes.mjs](../../scripts/forge-protected-lanes.mjs)) reads the public, read-only `GET https://three.ws/api/nvidia/stats` and applies the rule above. Point it at another server with `FORGE_STATS_ORIGIN`, for example `FORGE_STATS_ORIGIN=http://localhost:3000 npm run forge:lanes`. Exit code 2 means the stats could not be read or this page's "Measured state" section could not be parsed, so keep the `## Measured state, <date>` heading and the `Protected:` list in their current form.

When the measurement changes which lanes are protected, update the "Measured state" section and its date in the same change.

## The tests that hold it in place

[tests/api/forge-protected-lanes.test.js](../../tests/api/forge-protected-lanes.test.js) pins everything listed under "What protected forbids" for `trellis_selfhost`, and the keyless rung's position:

- the backend entry, its slot in `FREE_FALLBACK_FOR_PATH`, `SELF_HOST_IMAGE_LANES`, `DEFAULT_BACKEND_FOR_PATH` and the self-host lane chain;
- production routing (photo and text, every tier, with and without `FORGE_SELFHOST_PRIMARY`, health-aware routing);
- every value in `SELFHOST_TRELLIS_QUALITY` and the ETA it produces;
- the exact request the API sends the worker for a fixed photo (default options, draft with a seed, turnaround views, high tier), with only the outbound fetch stubbed;
- the poll and status contract (`/tasks/:id`, status mapping, the missing-task grace window);
- the text-to-image ladder order, with the keyless rung after every keyed rung and ahead of Replicate.

Every failure message points back to this page and says the owner's yes is required. If one goes red, you moved a protected lane: undo the change, or bring the owner a failing test that shows the real bug.

```bash
npx vitest run tests/api/forge-protected-lanes.test.js
```
