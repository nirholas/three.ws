---
title: "Open-weight text-to-3D in production: lanes, failover, and the GPU workers behind a free 3D forge | three.ws"
venue: AWS Builder Center
account: three.ws (official organization account, byline "three.ws")
status: draft, owner approval required before publishing (external-channel gate in CLAUDE.md)
description: "How a sentence becomes a textured GLB on three.ws: a reference picture first, then a reconstruction lane picked by a health-aware router over our own TRELLIS, Hunyuan3D and TripoSG GPU workers, three layers of failover when a worker dies mid-job, honest cold starts, weight staging that survives a RAM-backed /tmp, the meshopt files our own workers could not read, and the per-generation ledger that tells us what actually happened. Real code, real numbers, and the limits."
tags: [machine-learning, generative-ai, gpu, open-source, 3d]
index: docs/aws-builder-center.md
---

# Open-weight text-to-3D in production: lanes, failover, and the GPU workers behind a free 3D forge

Type "a small cast-iron teapot with a bamboo handle" into the [three.ws Forge](https://three.ws/forge) and about a minute later you can orbit a textured GLB of it, view it in AR, or download it. No account and no key. Over the seven days to 8 October 2026 the Forge ran 5,262 generations; 4,889 finished. 147 jobs failed partway through on one engine and finished on another, without the user doing anything.

That last number is what this article is about. Running one open-weight 3D model behind an API is a weekend. Running several as a product, where the chosen model can be cold, half-loaded, or gone when the request arrives, is mostly about everything around the model: which engine a request goes to, what happens when that engine fails after it has accepted the job, how a cold start is reported honestly, how 18 GiB of weights get onto a GPU container without killing it, and how you find out afterwards what really happened.

We run [three.ws](https://three.ws), an open-source (Apache-2.0) platform for 3D AI agents. Every code sample below is an excerpt from [the repository](https://github.com/nirholas/three.ws), with the file named.

**Status, plainly, because AWS builders check.** three.ws is a verified AWS Partner. The Forge itself does not run on AWS, and we would rather say that than let a partner article imply otherwise. The API runtime and every self-hosted GPU worker in this article run on Google Cloud Run in `us-central1`, with NVIDIA L4 and NVIDIA RTX PRO 6000 GPUs attached to the Cloud Run services and model weights held in Cloud Storage. Two hosted rungs sit behind our own workers: NVIDIA's hosted inference and Hugging Face Spaces. Finished models are written through the AWS SDK for JavaScript v3 S3 client to an S3-compatible bucket (Cloudflare R2 in production). Section 14 says which parts we think map onto AWS, and that we have not run them there.

**Contents**

1. What one request does
2. A picture comes before the shape
3. One registry, one ordering, and a router that reads health
4. A health check has to read the right field
5. Three layers of failover
6. The 404 that was not a failure
7. GPU workers on Cloud Run: one contract, many models
8. Cold starts, said out loud
9. Weights: the stalled mount and the RAM-backed /tmp
10. Every generation is a row
11. Meshopt: the format we ship is the format our workers could not read
12. Vendored code, and the check that keeps it honest
13. What we would build differently
14. What to lift from this
15. Try it

---

## 1. What one request does

A text prompt to the Forge travels this path:

```
prompt
  |  rewrite into a reconstruction-friendly description
  v
reference image ladder  (Vertex Gemini, then FLUX lanes, then a keyless rung)
  |  one centered subject, plain background, even light
  v
health-aware lane router  (our TRELLIS / Hunyuan3D / TripoSG workers, hosted rungs)
  |  submit; failover at submit time if the lane refuses
  v
GPU worker  (POST /infer -> 202, task state in Cloud Storage)
  |  poll; failover at poll time if the job fails after acceptance
  v
durable copy + quality score + forge_creations row  ->  GLB in the viewer
```

A photo skips the first two boxes, because the photo is the reference. A sketch skips them too and goes to the one lane built for drawings (TripoSG's scribble pipeline). Two request axes, both resolved in [`api/_lib/forge-tiers.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-tiers.js), shape everything after that: the **path** (`image`, `geometry`, `sketch`) and the **tier** (`draft`, `standard`, `high`), which sets a polygon target of 12,000, 30,000 or 200,000 and, on our own TRELLIS worker, the sampler budget.

## 2. A picture comes before the shape

The open-weight reconstruction models we run (TRELLIS, Hunyuan3D 2.1, TripoSG) are image-conditioned: they read a picture, not a sentence. So a text prompt is first painted as a reference image, and the realism of the final mesh is set almost entirely by that one image. The module that builds it, [`api/_lib/forge-reference-image.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-reference-image.js), asks for a single centered subject on a plain seamless studio background, soft shadowless light, and real-world materials, because that is what reconstructs into a mesh that looks real.

The picture has its own failover ladder, and its most useful property is not the order of the rungs but the budget they share. Every lane is bounded on its own (90 seconds for Vertex, 60 for the hosted FLUX lane), but in August a stalled leading lane would burn its whole window, then the next lane would burn its own, and the caller's connection was gone before a 3D job even existed. The ladder now shares one budget (60 seconds by default), and a lane that still has a fallback behind it is capped so it hands off with real time to spare. From [`api/_mcp3d/text-to-image.js`](https://github.com/nirholas/three.ws/blob/main/api/_mcp3d/text-to-image.js):

```js
export function laneTimeoutMs(ownCeilingMs, { budgetMs, remainingMs, laneRemains }) {
	if (remainingMs <= 0) return 0;
	let cap = remainingMs;
	if (laneRemains) cap = Math.min(remainingMs, Math.max(budgetMs * 0.25, remainingMs * 0.6));
	return Math.max(0, Math.min(ownCeilingMs, Math.floor(cap)));
}
```

A leader never takes more than 60% of what is left while another lane waits behind it.

Here is the honest part. The code puts Vertex AI's Gemini image model first, because it draws the most photoreal reference. Our generation ledger (section 10) records which model drew every reference. Over the 60 days to 8 October, the last reference Gemini drew is dated 13 August: **none since**. In that window FLUX.1-dev on NVIDIA's hosted inference drew 22,690 references and a keyless public FLUX endpoint, the last rung, drew 3,649. From 3 to 5 October the keyless rung was the only one serving at all. The ladder did its job: nobody's generation failed because the top rung was down. It also hid an eight-week outage of the rung we consider best, which is the first item in section 13.

One more detail from the same path, because it surprised us. "Plain background" is not "transparent background". On 8 September we rendered six text personas through the TRELLIS lane and found the reconstruction fusing the plain backdrop in as geometry: four of six figures stood on a full-footprint slab of reconstructed backdrop, and two of them lost the figure entirely, leaving a bare plane. So every non-draft TRELLIS job now goes through our background-removal worker first, from [`api/forge.js`](https://github.com/nirholas/three.ws/blob/main/api/forge.js):

```js
						matte: tier.id !== 'draft',
```

The worker treats that matte as best-effort: if the background-removal call fails, it reconstructs from the original image rather than failing the job.

## 3. One registry, one ordering, and a router that reads health

Every engine is one entry in a registry, `BACKENDS` in `forge-tiers.js`. An entry declares which paths it serves, whether it accepts user photos, which environment variables must exist for it to be live, a base ETA, and, for our own workers, a cold-start budget. A lane is "configured" only when its environment is present, so a partial deployment degrades by dropping lanes rather than by advertising engines that cannot answer.

The engines that matter here:

| Lane id | What runs | Where |
|---|---|---|
| `trellis_selfhost` | Microsoft TRELLIS (image-large), single-hop image to textured GLB | our Cloud Run worker, NVIDIA L4, min 1, max 3 instances |
| `hunyuan3d` | Tencent Hunyuan3D 2.1, shape DiT plus a PBR paint pass | our Cloud Run worker, NVIDIA RTX PRO 6000, min 1, max 1 |
| `triposg` | VAST TripoSG, geometry only, no textures | our Cloud Run worker, NVIDIA L4, scales to zero |
| `nvidia` | TRELLIS on NVIDIA's hosted inference, text only | hosted |
| `huggingface` | community Spaces chaining Hunyuan3D 2.1, Hunyuan3D 2, TRELLIS, TripoSR | hosted |

The instance counts are what `gcloud run services describe` returned on 8 October, not just what the build files request. Engines that need the caller's own API key also live in the registry, but the router never picks them; they run only when a user names one.

The ordering is one function, `freeLaneCandidates`, and both the plain resolver and the health-aware resolver walk it, so they cannot drift apart. Draft and Standard name our TRELLIS worker; High names our Hunyuan3D worker; behind the named engine comes a fallback chain of `trellis_selfhost`, `hunyuan3d`, `huggingface`, `nvidia`. A photo filters out the text-only hosted lane. At the High tier a prompt that clearly reads as hard-surface (a robot, a vehicle, furniture) swaps TRELLIS ahead of Hunyuan3D, because single-hop reconstruction is crisper on mechanical shapes, while a prompt that trips both classifiers ("a knight in mecha armor") stays organic and keeps Hunyuan3D first. In production a flag, `FORGE_SELFHOST_PRIMARY`, hoists every self-hosted lane ahead of every hosted one, so requests are served on the GPUs we control before any external free allocation.

Then health tempers preference, never the reverse. From `forge-tiers.js`:

```js
export function defaultBackendForHealthAware(p, tierId, userImages, health, subjectClass = null) {
	const candidates = freeLaneCandidates(p, tierId, userImages, subjectClass);
	if (!candidates.length) return DEFAULT_BACKEND_FOR_PATH[p];
	const statusOf = (id) => health?.[id];
	const preferred = candidates.find((id) => {
		const s = statusOf(id);
		return s === 'ok' || s == null || s === 'unknown';
	});
	if (preferred) return preferred;
	const usable = candidates.find((id) => statusOf(id) !== 'down');
	if (usable) return usable;
	return DEFAULT_BACKEND_FOR_PATH[p];
}
```

Take the first lane that is healthy or simply unknown, because missing telemetry must never demote a preferred lane. Otherwise take the first that is not confirmed down, because a degraded lane beats a dead end. Only when every candidate is confirmed down, fall back to the standing default. The function is pure: the caller gathers a cached health snapshot and passes it in, and if gathering the snapshot throws, the request keeps the environment-resolved lane and behaves exactly as it did before health routing existed.

## 4. A health check has to read the right field

The snapshot comes from [`api/_lib/forge-lane-health.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-lane-health.js). For each self-hosted lane it does an authenticated GET against the worker's `/health` with a 2.5-second timeout, reads a round trip under 1.2 seconds as warm, and caches the result per instance for 20 seconds so a burst of generations shares one probe. A separate shared cooldown records lanes that just failed a real job; a cooled lane is reported down without spending a probe.

Until 11 August that probe hit the worker's root URL and scored anything under HTTP 500 as healthy. No worker serves its root, so every probe got a 404 and called it "ok". Worse, a worker whose model load had failed answered that 404 identically to a working one, so routing kept sending generations to a lane that could only fail them. The fix reads the body:

```js
	if (body.load_error) return { id: backendId, status: 'down', warm: false, latencyMs };
	const readiness = [body.ready, body.pipeline_loaded, body.model_loaded].find((v) => typeof v === 'boolean');
	if (readiness === false) return { id: backendId, status: 'ok', warm: false, latencyMs };
	return { id: backendId, status: 'ok', warm, latencyMs };
```

The field names differ by worker generation (`ready` and `pipeline_loaded` on TRELLIS and Hunyuan3D, `model_loaded` on TripoSG), and the probe accepts all three instead of forcing a migration. A worker that is up but still loading is routable but never warm, which is what makes section 8 possible.

The lesson generalizes: **a port answering is not a model answering.** Separate `ok` (the process is up) from `ready` (the weights are on the GPU), and route on the second.

## 5. Three layers of failover

Submit-time failure is the easy case. When a worker refuses a submit with a 429, a 5xx, or no answer at all, the handler marks the lane unhealthy in the shared cooldown for 90 seconds, so every instance steers new requests around it, and moves the request to the next lane with the reference image it already holds. Genuine input or configuration errors are not retried; only "upstream unavailable" is.

The hard case is a worker that accepts a job with a 202 and fails it minutes later. By then the request that started it is long gone; the failure surfaces on some later `GET /api/forge?job=...` poll, in a different process, with no request body. Until mid-July that poll dead-ended. Now three layers stand behind it.

**Layer one: the server continues the job on another lane.** The poll handler recovers the original prompt and the stored reference image from the generation's database row, resubmits to the next lane, creates a successor row, and binds the old job handle to the new one in Redis. The client keeps polling the same id. From [`api/_lib/forge-failover.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-failover.js):

```js
export const MAX_FAILOVER_HOPS = 3;
```

```js
const ASYNC_REDISPATCH_ORDER = ['trellis_selfhost', 'hunyuan3d', 'trellis', 'triposg'];
```

A job gets its first lane plus up to three backups. Only lanes with an asynchronous submit and status API qualify: Hugging Face Spaces block for the entire generation, and the hosted NVIDIA lane takes text only while a poll-time rescue always rebuilds from the stored picture, so neither can be a rescue rung. In production the third entry, a paid hosted TRELLIS lane, is not configured, so the live chain is our TRELLIS worker, our Hunyuan3D worker, then TripoSG. TripoSG closes it because it returns an untextured mesh: it runs only once every textured lane has failed or is marked down. It earned the slot during an outage from 18 to 28 September that took the Hunyuan3D and TRELLIS workers down together; without it, roughly 400 photo jobs a day ended in a hard failure while the TripoSG worker sat healthy.

The one ordering decision we would defend hardest is in the poll handler, [`api/forge.js`](https://github.com/nirholas/three.ws/blob/main/api/forge.js): report "running" only after the successor is durably chaseable.

```js
					const bound = await bindJobSuccessor(jobId, {
						handle: submitted.handle,
						backend: nextLane,
						hop: hop + 1,
						attempted,
					});
					if (bound) {
```

If the Redis write fails, the handler falls through to a designed failure instead. Answering "running" for a successor nobody can find would have the client poll a dead handle until it times out, which turns a clean failure into a hang. A failover must never do that.

**Layer two: the failure names its own way out.** When no successor is possible (cap reached, no stored image, nothing configured), the failed response carries `retryable: true` and `retry_backends`: the ordered, configured lanes a fresh request could still use. The Forge page hops to the first one automatically, once per submission, and flips the engine picker so the switch is visible. If that also fails, it shows the remaining lanes as one-click switches.

**Layer three: nobody has to be watching.** A cron, [`api/cron/forge-finalize.js`](https://github.com/nirholas/three.ws/blob/main/api/cron/forge-finalize.js), runs every minute and sweeps rows still marked generating after two minutes. It polls the worker directly, materializes finished models with the same writer the browser path uses, applies the same poll-time failover, sends the completion notification (the attended path never notifies, because the result is already on screen), and after 45 minutes marks anything still unfinished as failed, so no row stays "generating" forever. Close the tab mid-generation and the model still lands in your gallery.

Did it work? Over the same seven days: our TRELLIS worker finished 2,882 jobs and failed 96 attempts, and **93 of those 96 were finished on another lane**. Hunyuan3D finished 312 and failed 67, of which 49 were rescued. TripoSG, the last rung, finished 37 and failed 49, and only 5 of those were rescued, which is what a last rung looks like.

## 6. The 404 that was not a failure

A seven-day sample in July showed image-to-3D failing about 48% of the time, and 410 of 425 TRELLIS failures carried one string: "task not found on gcp service". Every one was a 404 from the worker's task endpoint.

The worker persists each task's queued state to Cloud Storage before it returns the 202, and every poll re-reads Cloud Storage for unfinished records. But the service runs several instances with no session affinity, so a poll seconds after submit can land on an instance before the just-written record is readable there. Treating that first 404 as terminal threw away jobs that were almost always fine, and then spent a failover hop recovering them.

The fix is a pure decision function, [`api/_lib/forge-selfhost-recovery.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/forge-selfhost-recovery.js) (comments trimmed):

```js
export function decideSelfhostMissing({ code, row, ageMs, graceMs = GCP_TASK_MISSING_GRACE_MS } = {}) {
	if (code !== GCP_TASK_MISSING_CODE) return { action: 'passthrough' };

	if (row && row.status === 'done' && row.glb_url) {
		return { action: 'done', glbUrl: row.glb_url };
	}

	if (Number.isFinite(ageMs) && /** @type {number} */ (ageMs) < graceMs) {
		return { action: 'running' };
	}

	return { action: 'fail' };
}
```

Check the database first, because a racing poll may already have stored the mesh. Inside a 90-second grace window, a 404 means "not visible yet", so keep polling. Past it, the task really is orphaned, so fail and let section 5 take over. It matches on a code the provider tags onto the 404, not on the human error string, so the message can change without breaking recovery.

The worker has its own half of the bargain. From [`workers/model-trellis/main.py`](https://github.com/nirholas/three.ws/blob/main/workers/model-trellis/main.py): only terminal records are trusted from the in-memory cache (caching a queued record would freeze it on that instance while another instance advances it), and a queued or running record with no progress for 30 minutes is rewritten as failed with a message that says why. An endless poll becomes a designed failure the router can act on.

## 7. GPU workers on Cloud Run: one contract, many models

Each self-hosted lane is its own Cloud Run service: a small FastAPI process wrapping one model, with one GPU attached. What lets the router treat them as interchangeable rungs is that they all speak one contract:

```
POST /infer       -> 202 {"task_id": "...", "status": "queued"}
GET  /tasks/:id   -> {"status": "queued|running|done|failed", "result_gcs_url": "...", ...}
GET  /health      -> {"ok": true, "ready": true, "load_error": null, ...}
```

Here is what our Hunyuan3D worker's `/health` returned on 8 October:

```json
{"ok":true,"model":"hunyuan3d-2.1","gpu_available":true,"gpu_name":"NVIDIA RTX PRO 6000 Blackwell Server Edition","pipeline_loaded":true,"ready":true,"load_error":null}
```

The deploy is a plain `gcloud run deploy` inside a Cloud Build config. From [`workers/model-trellis/cloudbuild.yaml`](https://github.com/nirholas/three.ws/blob/main/workers/model-trellis/cloudbuild.yaml):

```yaml
      - --gpu=1
      - --gpu-type=nvidia-l4
      - --no-gpu-zonal-redundancy
      - --no-cpu-throttling
      - --cpu=8
      - --memory=32Gi
      - --min-instances=${_MIN_INSTANCES}
      - --max-instances=${_MAX_INSTANCES}
      - --timeout=900
```

Each instance runs one inference at a time (`MAX_CONCURRENT=1`), so instance count is the concurrent-generation count, and task state lives in Cloud Storage so a job submitted to one instance resolves when polled on another.

Two worker behaviours came out of one outage. On 2 September a single transient 403 during the TRELLIS model load was cached as the instance's permanent error. Every later task failed against it instantly, and `min-instances=1` kept that dead instance resident and in rotation for about 12 hours. The load is now retried with exponential backoff, and the error latches only once the whole budget is spent:

```python
    for attempt in range(1, attempts + 1):
        _load_attempts = attempt
        try:
            await loop.run_in_executor(None, _load_pipeline)
            _load_error = None
            _ready.set()
            log.info("TRELLIS pipeline ready (attempt %d)", attempt)
            return
        except Exception as exc:  # noqa: BLE001 - surfaced via /health + task status
            if attempt >= attempts:
                _load_error = safe_error(exc, context="model load")
                log.error("TRELLIS pipeline load FAILED after %d attempt(s): %s", attempt, exc)
                return
```

Once it latches, `/health` answers 503, and the service carries a Cloud Run liveness probe on `/health` (60-second period, three failures), so a genuinely dead container is replaced within about three minutes while an ordinary cold load, which answers 200 while loading, is never killed mid-load.

Beyond the reconstruction lanes we run CPU workers for background removal (**rembg**, the matte step in section 2), retopology and format conversion (**remesh**), and geometric **stylize** and **segment** tools, plus an L4 auto-rigging worker (**rig**). Two more are honest exceptions. **texture** (SDXL plus ControlNet-Depth retexturing) is built and documented but not deployed; the health report lists it as unconfigured. **model-triposr**, about 3 seconds of GPU work warm, is deployed but receives no user jobs today; TripoSR is reachable only through the hosted Spaces chain.

## 8. Cold starts, said out loud

A scale-to-zero GPU worker is cheap and slow to wake. We keep the two textured lanes warm (`min-instances=1`) and let the rest scale to zero, and the product's job is to never pretend a cold start is a fast generation.

Each self-hosted lane declares a cold-start budget. When the health snapshot says the chosen lane is not warm, the ETA the page shows widens by that budget, and while a job is still queued on a cold lane the poll response carries `cold_start: true` with the budget, so the page can show "starting a GPU" instead of a stalled bar. The flag clears on a real signal (the worker reporting "running"), not on a timer. On the page, time spent in a queue does not consume the 12-minute polling budget.

What we measured while writing this. At 04:26:36 UTC on 8 October our public health report probed the TripoSG worker, which was scaled to zero, and got no answer within its 4-second timeout: "down". About a minute later the worker answered, with `model_loaded: false`, and the report called it "degraded". It reported the model loaded at 04:30:14, roughly three and a half minutes after that first probe. The router's cold-start budget for TripoSG is 45 seconds. That number is wrong, and section 13 says what we would do about it.

For contrast, a Draft text prompt submitted to the warm TRELLIS lane the same morning was accepted at 04:37:13 and done by 04:38:15, scored 0.969 by the deterministic mesh check and 85 by the vision check that runs after it.

## 9. Weights: the stalled mount and the RAM-backed /tmp

Every worker mounts the `three-ws-model-weights` Cloud Storage bucket as a volume. Loading straight from that mount looked fine in testing and stalled in production: the model's random-access reads go over the network, and a cold load routinely stalled ("stalled read-req cancelled", "context deadline exceeded"), turning a load of under a minute into 15 or more, or a hard timeout. The TRELLIS worker now streams its roughly 3 GB weight tree to local disk with the storage client, a plain sequential GET per object, and loads from there. If staging fails for any reason it falls back to the mount, so the change can only add reliability.

Hunyuan3D 2.1 taught the second lesson. Its shape model is a single 6.9 GiB checkpoint and its paint model a 3.7 GiB file, and with the image encoder the worker stages about 18 GiB into `/tmp`. On Cloud Run, `/tmp` is memory-backed. Staged weights and loaded weights are charged to the same memory limit, so 18 GiB staged plus a roughly 14 GiB model loaded on top ran into the L4 tier's 32 GiB ceiling, and the instance was killed with signal 9 on every cold start. The port bound and `/health` answered, but no job could ever complete. Two things fixed it:

```yaml
      - --gpu=1
      - --gpu-type=nvidia-rtx-pro-6000
      - --no-gpu-zonal-redundancy
      - --no-cpu-throttling
      - --cpu=20
      - --memory=80Gi
```

That is [`workers/model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml`](https://github.com/nirholas/three.ws/blob/main/workers/model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml). The RTX PRO 6000 tier's platform minimum is 20 CPU and 80 GiB of memory, which clears the ceiling with room to spare. The second fix is the image: Blackwell is compute capability 12.0, and the CUDA 12.4 wheels in the L4 image ship no kernels for it, so the RTX image is built on CUDA 12.8 with its extensions compiled for both 8.9 and 12.0. The same image boots on either GPU, so which card runs it is a deploy flag, not a rebuild. The cost of that choice is build time: a cold build compiles torch extensions for two architectures, and the config allows two hours.

Two smaller habits: pull the previous image before building so `--cache-from` has layers to reuse, and keep the previous model generation deployed. Hunyuan3D 2.0 still runs as its own service, so rolling back is repointing one environment variable.

**On licenses.** "Open-weight" is not one license. TRELLIS, TripoSG and TripoSR are MIT. Hunyuan3D 2.1 ships under Tencent's own license agreement, which carries its own terms; each worker's README records the license of the model it wraps, and we would tell any team to read those terms before choosing which model leads a lane.

## 10. Every generation is a row

The most useful decision in the whole system is boring: every generation writes a row to a Postgres table, `forge_creations`, from the moment it is submitted. The row holds the prompt, the reference image, the model that drew it, the lane (`backend`), the `tier` and `path`, the `status`, the raw provider `error`, the durable GLB, timing, and the user's later verdict (kept, discarded, downloaded, rated). It started in June to stop generated models evaporating when a provider's delivery URL expired; it became the ground truth for every number in this article.

When the poll-time failover shipped, every rescued attempt still counted as a user-visible failure, because nothing recorded the link. In mid-August, 14 of 23 weekly failures were TRELLIS orphans, 13 of them rescued on Hunyuan3D seconds later, and all 14 sat at the top of our error report, sending whoever triaged it after a failure mode the platform already handled. From [`api/_lib/migrations/20260814200000_forge_failover_supersede.sql`](https://github.com/nirholas/three.ws/blob/main/api/_lib/migrations/20260814200000_forge_failover_supersede.sql):

```sql
ALTER TABLE forge_creations
	ADD COLUMN IF NOT EXISTS superseded_by uuid;
```

A plain uuid, not a foreign key, so retention pruning can still delete old rows. Our error report, [`scripts/forge-error-report.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/forge-error-report.mjs), is read-only SQL over this table, and its headline for the week to 8 October was:

```
generations 5262   done 4889   failed 369   still running 4
of those failures, 147 were re-dispatched to another lane and finished there; 222 were lost
success rate 95.7% (recovered attempts are not counted against it)
```

The same table showed us things no probe could. The reference-model column is how we found the eight-week Gemini gap in section 2. The per-lane timing is how we know our TRELLIS worker's Standard tier finishes at a median of 226 seconds (90th percentile 442) against 53 seconds for Draft, measured from submit to completion: Standard spends 35 sampler steps on structure and appearance against Draft's 12, and keeps more of the mesh.

```js
	draft: Object.freeze({ ss_steps: 12, slat_steps: 12, simplify: 0.95, texture_size: 1024 }),
	standard: Object.freeze({ ss_steps: 35, slat_steps: 35, simplify: 0.82, texture_size: 2048 }),
	high: Object.freeze({ ss_steps: 50, slat_steps: 50, simplify: 0.65, texture_size: 4096 }),
```

That is `SELFHOST_TRELLIS_QUALITY` in `forge-tiers.js`. The texture size must be a power of two: when Standard briefly shipped 3072 in July, TRELLIS's texture bake built a mip stack, rejected the size, and every Standard generation failed at the last step.

## 11. Meshopt: the format we ship is the format our workers could not read

Finished models are big. For our own viewers we write a second, web-delivery copy of every mesh over 512 KB, with `EXT_meshopt_compression` geometry and WebP textures capped at 2048 pixels. On six production outputs sampled in September it cut 1.25 to 3.34 MB down to 0.11 to 0.67 MB. It is a second object, never a replacement: the download button returns the original bytes, so a third party with a bare glTF loader is never handed a file it cannot decode. It is written after the row is marked done, fire-and-forget, so a user never waits on it.

Meshopt is also what most three.ws avatars ship as. And the post-generation workers (stylize, remesh, segment, rig, texture) read meshes with trimesh, which has no decoder for `EXT_meshopt_compression`. A compressed asset stores its geometry in compressed buffer views and declares an empty fallback buffer that exists only once something decodes into it, so trimesh dies on the buffer lookup with a bare `IndexError: list index out of range`. In August, `/avatars/michelle.glb` failed every stylize filter in production for exactly that reason.

The fix is to transcode before any reader touches the file, using the same project's own CLI, which decodes what it encoded. From [`workers/stylize/gltf_meshopt.py`](https://github.com/nirholas/three.ws/blob/main/workers/stylize/gltf_meshopt.py):

```python
def uses_meshopt(document: Optional[dict]) -> bool:
    """True when the asset needs a meshopt decode before any reader can use it.

    Checked against both extension lists: an asset that only *uses* the
    extension still stores its geometry in the compressed views, and its
    fallback buffer stays empty until something decodes into it.
    """
    if not document:
        return False
    declared = set(document.get("extensionsRequired") or []) | set(document.get("extensionsUsed") or [])
    return MESHOPT_EXTENSION in declared
```

```python
            proc = subprocess.run(
                [GLTFPACK_BIN, "-i", str(src), "-o", str(dst), "-noq"],
                capture_output=True,
                timeout=GLTFPACK_TIMEOUT_S,
            )
```

Check both extension lists, not just `extensionsRequired`. `-noq` keeps the source quantization so the decoded geometry is what the author shipped. `decode_if_meshopt` returns any non-meshopt payload untouched, so it is safe to call on every input path. The binary is pinned by release and checksum in each worker's image, from [`workers/stylize/Dockerfile`](https://github.com/nirholas/three.ws/blob/main/workers/stylize/Dockerfile):

```dockerfile
ARG GLTFPACK_VERSION=v1.2
ARG GLTFPACK_SHA256=ebc236f5f6c08c7e5c5750476a187d24805d44d8c680449c4b7369c333f817b1
```

The image build then runs the meshopt unit test, so a broken decoder fails the build instead of a user's job. The five workers that load caller-supplied meshes all pin the same version and checksum.

## 12. Vendored code, and the check that keeps it honest

Each worker's Docker build context is its own directory, so `../` is unreachable and a shared Python module cannot simply be imported. We vendor instead: shared modules live as byte-identical copies in every worker that needs them. Today that is `worker_security.py` (the SSRF-safe fetch and bearer check, in 17 workers) and `gltf_meshopt.py` with its test (5 workers each). Two upload helpers are on the list too, ready for the day a second worker needs them.

Copies drift. A fix applied to one copy silently leaves the others on the old behaviour, which this repository has already paid for once. So [`scripts/check-vendored-workers.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/check-vendored-workers.mjs) hashes every copy, treats the most common hash as canonical, and fails naming each drifted file and the exact `cp` to resync it:

```js
	const counts = new Map();
	for (const copy of copies) counts.set(copy.sha, (counts.get(copy.sha) || 0) + 1);
	const [canonicalSha] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
	const canonical = copies.find((c) => c.sha === canonicalSha);
	const drifted = copies.filter((c) => c.sha !== canonicalSha);
```

It runs as `npm run check:vendored` inside the repository's gate. On 8 October it printed `OK: 27 vendored file copies across 36 workers are byte-identical`. "The most common copy wins" is a heuristic; when it guesses wrong, it still names the file to look at.

## 13. What we would build differently

**Alert on a silent top rung.** A failover chain that always succeeds can hide that its best rung has been down for weeks, and ours did. The ledger already records which model served every request. What we lacked was a rule that pages when the preferred rung's share drops to zero, separate from the success rate, which stayed healthy the whole time.

**Measure cold-start budgets instead of guessing them.** TripoSG's budget says 45 seconds; we watched it take about three and a half minutes to load. The Standard-tier ETA the picker shows ("usually ~60s") sits well under the 226-second median the ledger records. Both should be derived from the ledger, per lane and tier, and refreshed, not written once as constants.

**Write recovery state before the first outage, not after.** Successor bindings, the `superseded_by` link, and the 404 grace window all arrived after we had already miscounted or thrown away good jobs. The primitive we would design first next time is "a job id that survives a lane change", because every other recovery feature hangs off it.

**Separate "up" from "ready" from day one.** Every worker eventually grew a `ready` field and a `load_error`, and the router learned to read them, but only after a probe called a 404 healthy and a dead instance stayed in rotation for 12 hours.

## 14. What to lift from this

None of this needs our platform:

1. **One lane registry and one ordering function** that both the plain and the health-aware resolver walk, with health tempering preference rather than replacing it (`freeLaneCandidates` and `defaultBackendForHealthAware`).
2. **A shared timeout budget** for any ladder of providers (`laneTimeoutMs`), so a stalled leader cannot spend the whole request.
3. **A job id that survives a lane change**: bind old handle to new in a store, and answer "running" only after the bind is confirmed.
4. **A per-request ledger row** written at submit, carrying lane, tier, model, status, raw error, and a `superseded_by` pointer. It answers the questions probes cannot.
5. **`gltf_meshopt.py`** if any Python service of yours reads glTF that a browser pipeline compressed. It is about a hundred lines and depends only on a pinned gltfpack.
6. **The vendored-file check** if you ship several Docker images from one repository and share code by copying.

For AWS builders, a note on mapping, with the caveat that we have not run the Forge on AWS. Nothing above is specific to Cloud Run except the deploy flags. The worker contract is plain HTTP, and the task store is the one swap a port needs: the TRELLIS worker already falls back to a local storage backend when its bucket is unset, and its Cloud Storage calls are the only part that would change for Amazon S3. The NVIDIA L4 the TRELLIS and TripoSG workers use is the GPU in the Amazon EC2 G6 family, and the submit-then-poll shape is the same shape Amazon SageMaker asynchronous inference uses. We would expect the lessons in sections 8 and 9, about cold starts and memory-backed scratch space, to transfer to any container platform with GPUs; we have only verified them on ours.

## 15. Try it

Every call below is free and needs no key or account.

```bash
# live health of every lane, the editing workers, and the last 24 hours of outcomes
curl -s 'https://three.ws/api/forge?health=1'

# the lane catalog the Forge page renders, including which engine each tier picks
curl -s 'https://three.ws/api/forge?catalog=1'

# a free Draft generation, then poll the job id it returns until status is "done"
curl -s -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{"prompt":"a weathered brass diving helmet","tier":"draft"}'
curl -s 'https://three.ws/api/forge?job=<job_id from the response above>'

# recent public generations, each with its lane, tier and path
curl -s 'https://three.ws/api/forge-gallery?limit=5'
```

Or use the page: [three.ws/forge](https://three.ws/forge). The teapot from the first paragraph, a Draft from our TRELLIS worker, is at [three.ws/m/d0bf4918-36c5-4716-a476-58b4885e6dc2](https://three.ws/m/d0bf4918-36c5-4716-a476-58b4885e6dc2), and the public gallery is at [three.ws/forged](https://three.ws/forged). The pipeline reference lives at [three.ws/docs/forge-pipeline](https://three.ws/docs/forge-pipeline), and the GPU field report behind the Blackwell move is [on our blog](https://three.ws/blog/image-to-3d-on-nvidia-l4-and-blackwell).

Source: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), Apache-2.0. The workers are under [`workers/`](https://github.com/nirholas/three.ws/tree/main/workers), each with a README covering its contract, its deploy, and the license of the model it wraps.

---

*three.ws is a verified AWS Partner and an open-source platform for 3D AI agents. Previously from us here: [how we metered a SaaS product through AWS Marketplace with the AWS SDK for JavaScript v3](https://builder.aws.com/content/3ESpll50BdSp9eiCEIxcfG9pGUN/how-we-metered-a-saas-product-through-aws-marketplace-with-the-aws-sdk-for-javascript-v3).*
