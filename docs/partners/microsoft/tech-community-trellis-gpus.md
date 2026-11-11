# Tech Community article: running TRELLIS on Cloud Run GPUs

Draft for the Microsoft Tech Community (AI or developer blog space). Written 2026-11-11 from production data; every number has its source in [sources.md](./sources.md). Posting is an owner step.

## Before posting

1. Re-run the queries in [sources.md](./sources.md) and replace every number in the article with the fresh value. The counts grow daily.
2. Check whether TRELLIS.2 is taking production traffic: `gcloud run services describe three-ws-api --region us-central1` must list `MODEL_TRELLIS2_URL`, `curl -s https://model-trellis2-lp642k3kpa-uc.a.run.app/health` must report `"ready":true`, and `select count(*) from forge_creations where backend='trellis2'` must be above zero. On 2026-11-11 none of the three held.
3. Once all three hold, update these sentences: the second paragraph of the introduction ("TRELLIS.2 is deployed ... not yet taking production traffic"), the opening of "Bringing up TRELLIS.2" ("deployed, not yet serving"), and the "Where it stands" section. Add a TRELLIS.2 row of measured timings from `forge_creations` beside the TRELLIS table, and only then retitle the post around TRELLIS.2.
4. Run `node scripts/microsoft-pack/check-wording.mjs docs/partners/microsoft/tech-community-trellis-gpus.md`.

---

# Running Microsoft Research's TRELLIS on Cloud Run GPUs: 29,147 models and the road to TRELLIS.2

At three.ws, a photo becomes a textured 3D model. The engine behind most of those models is TRELLIS from Microsoft Research, released under the MIT license, which we self-host on NVIDIA L4 GPUs on Google Cloud Run. Since our self-hosted TRELLIS worker went live on 2026-07-08 it has accepted 35,148 jobs and finished 29,147 GLB files, a large share of the 53,878 models our Forge has generated across all its lanes.

Its successor, TRELLIS.2 (a 4-billion-parameter flow transformer over O-Voxel structured latents, also MIT), is deployed on its own L4 service but not yet taking production traffic. This post covers both: what running TRELLIS at volume taught us, and what bringing up TRELLIS.2 required. All the code is open source in [`workers/model-trellis/`](https://github.com/nirholas/three.ws/tree/main/workers/model-trellis) and [`workers/model-trellis2/`](https://github.com/nirholas/three.ws/tree/main/workers/model-trellis2).

## The shape of the service

Each model runs in a FastAPI container on Cloud Run with one NVIDIA L4 (24 GB). One inference runs at a time per GPU (`MAX_CONCURRENT=1`), so the instance count is the number of concurrent generations. The TRELLIS service scales to three instances; the TRELLIS.2 service, with 8 vCPU and 32 GiB of memory, scales to two, with a 900-second request ceiling.

Work is asynchronous. `POST /infer` returns `202` with a task id, the caller polls `GET /tasks/{id}`, and the finished GLB lands in Cloud Storage. Because Cloud Run spreads a service across containers with no session affinity, the durable task record is a JSON blob in the bucket, not process memory, so a poll that lands on a different container still finds the job.

Here is what production looks like over the last 30 days for TRELLIS, measured from our `forge_creations` table as submit-to-completion wall time. That includes queueing and any cold start, not just GPU time:

| Tier | Completed jobs | Median time | Median GLB size |
|---|---|---|---|
| draft | 1,248 | 136 s | 1.52 MB |
| standard | 1,833 | 250 s | 6.06 MB |
| high | 257 | 608 s | 17.15 MB |

The tiers are named sampler presets in `request_policy.py`:

```python
TIER_PRESETS = {
    "draft":    {"ss_steps": 12, "slat_steps": 12, "ss_cfg": 7.5, "slat_cfg": 3.0, "simplify": 0.95, "texture_size": 1024},
    "standard": {"ss_steps": 25, "slat_steps": 25, "ss_cfg": 7.5, "slat_cfg": 3.0, "simplify": 0.90, "texture_size": 2048},
    "high":     {"ss_steps": 40, "slat_steps": 40, "ss_cfg": 7.5, "slat_cfg": 3.0, "simplify": 0.75, "texture_size": 4096},
    "max":      {"ss_steps": 50, "slat_steps": 50, "ss_cfg": 8.5, "slat_cfg": 4.5, "simplify": 0.50, "texture_size": 4096},
}
```

## Lesson 1: never latch the first load failure

On 2026-09-02 a single transient HTTP 403 during model load took our default image lane down for 12 hours. TRELLIS builds its image conditioner with `torch.hub.load("facebookresearch/dinov2", ...)`, and without a pinned branch torch.hub asks GitHub for the default branch on every load. Cloud Run egresses from shared IP ranges that GitHub rate-limits, so one load hit "rate limit exceeded". The worker cached that error in memory, every later task failed against it instantly, and a minimum of one warm instance kept the dead container in rotation.

Two fixes went in. First, the dinov2 checkout and checkpoint are baked into the image and torch.hub is pointed at them, which removes the network call entirely:

```python
def _load_local_first(repo_or_dir, model, *args, **kwargs):
    if isinstance(repo_or_dir, str) and repo_or_dir.startswith(DINOV2_HUB_REPO):
        kwargs["source"] = "local"
        return original_load(DINOV2_LOCAL_DIR, model, *args, **kwargs)
    return original_load(repo_or_dir, model, *args, **kwargs)
```

Second, the load retries with exponential backoff, and the error only latches once the whole budget (four attempts by default) is spent. From then on `/health` answers 503 and `/infer` refuses work, so the platform router takes the lane out of rotation and fails over instead of queueing jobs behind a broken instance:

```python
delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
```

On the platform side, a lane that fails at submit is put in a 90-second cooldown in a shared cache, so every API instance skips it, not just the one that saw the failure.

## Lesson 2: recycle instances before memory does it for you

The postprocess that turns TRELLIS output into a textured mesh uses native libraries (xatlas, nvdiffrast, open3d) that keep some of what they allocate. nvdiffrast's rasterizer allocates GPU memory through its own `cudaMalloc`, outside PyTorch's caching allocator, so VRAM only ratchets one way. Left alone, an instance eventually fails its own liveness probe in the middle of a job.

The worker records a host memory and VRAM baseline right after the model loads, compares against it after every job, and when either has grown past its threshold it drains: new `/infer` calls get a 503 so the caller fails over, queued jobs finish, and only then does the process send itself `SIGTERM`. Cloud Run starts a fresh container in its place. A restart between jobs costs one model load; an out-of-memory kill mid-job costs that job and the one behind it.

Two smaller guards came from the same incident log. The texture bake builds a mip stack and hard-fails on any non-power-of-two size (a 3072 request killed every generation on 2026-07-16), so requested sizes are snapped down to a power of two. And a raw extraction can be far denser than the bake can handle, so decimation is raised just enough to keep the mesh at or under 150,000 faces:

```python
def effective_simplify(raw_faces: int, simplify: float, max_faces: int = MAX_BAKE_FACES) -> float:
    if raw_faces <= 0 or raw_faces * (1 - simplify) <= max_faces:
        return simplify
    return min(0.999, max(simplify, 1 - max_faces / raw_faces))
```

## Bringing up TRELLIS.2

TRELLIS.2 is a bigger model with a different output path, and three problems surfaced before the first generation.

**Weights that do not fit the disk.** The checkpoint tree is about 15 GiB. Cloud Run's filesystem is in memory, and next to a 32 GiB job budget it cannot hold the whole tree. We tried the Cloud Storage FUSE mount, but it stalled on the random reads safetensors makes. The worker therefore wraps TRELLIS.2's per-model loader so each checkpoint streams from the bucket with plain sequential reads, loads, and is deleted before the next one starts:

```python
def streaming(path: str, **kwargs):
    name = path[len(config_dir) + 1:]
    scratch = os.path.join(scratch_root, "stream")
    local = os.path.join(scratch, name)
    os.makedirs(os.path.dirname(local), exist_ok=True)
    try:
        for ext in (".json", ".safetensors"):
            blob = bucket.get_blob(f"{prefix}/{name}{ext}")
            if blob is None:
                raise FileNotFoundError(f"gs://{bucket_name}/{prefix}/{name}{ext} is not staged")
            blob.download_to_filename(local + ext)
        return original(local, **kwargs)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
```

Peak disk is one checkpoint. The image conditioner and background matte (about 1.7 GB together) stay resident for the instance's life. One trap worth knowing: the upstream loader catches any exception and retries with the bare model name as a Hugging Face Hub id, which hides the real error behind "cannot find the requested files in the local cache". Our wrapper logs the first failure with its traceback and refuses the Hub retry, so the root cause is what shows up in the logs.

**Alpha declared opaque.** O-Voxel bakes opacity into the base colour texture's alpha channel but declares every material `OPAQUE`, so glass and leaves render as solid cards. Forcing `BLEND` on everything makes solid assets halo at their edges. The worker measures how much of the texture is genuinely translucent:

```python
TRANSLUCENT_BELOW = 245
TRANSLUCENT_MIN_FRACTION = 0.01

def alpha_mode_for(alpha: np.ndarray) -> str:
    plane = np.asarray(alpha)
    if plane.size == 0:
        return "OPAQUE"
    translucent = float(np.count_nonzero(plane < TRANSLUCENT_BELOW)) / plane.size
    return "BLEND" if translucent >= TRANSLUCENT_MIN_FRACTION else "OPAQUE"
```

Stray translucent texels at UV seams stay below the 1% threshold, so a solid object never becomes a sorted-transparency one. Every GLB then goes through `gltfpack -cc` for meshopt compression with quantised geometry, while texture compression stays off so the baked PBR maps and their alpha stay byte-exact.

**Resolution versus a 24 GB card.** TRELLIS.2 generates on a 512, 1024 or 1536 O-Voxel grid; the 1024 and 1536 pipelines cascade from a coarse 512 structure, which is how they fit on an L4 at all. Each resolution has a bake preset: 2048-pixel textures and 300,000 faces at 512, 4096 pixels and one million faces at 1024, 4096 pixels and 1.5 million faces at 1536. If the GPU cannot hold a request, the worker frees memory and retries one size down rather than failing the job:

```python
except torch.cuda.OutOfMemoryError:
    await loop.run_in_executor(None, _release_gpu_memory)
    smaller = step_down(served)
    if smaller is None:
        raise
    served = smaller
```

The task record reports both `resolution` and `resolution_served`, so the platform never presents a stepped-down model as the one it asked for. It also records `queue_ms` and `gpu_ms` separately, which is what will let us publish real GPU time for TRELLIS.2 rather than wall time.

**License hygiene.** TRELLIS.2 is MIT, but its default background-removal model is licensed for non-commercial use only. The worker rewrites the pipeline config at load time to use BiRefNet (MIT) instead, and loads the conditioner and matte from the staged tree so serving never touches the Hub. The upstream files stay untouched in the weights bucket.

## Where it stands

The TRELLIS.2 service is deployed on an L4, but on 2026-11-11 its health endpoint reports the pipeline not loaded, and our API has not been pointed at it. Routing is designed for exactly this: a lane is only eligible once its URL is configured, the router skips a lane that is down or cooling off after a failure, and a failed TRELLIS.2 job is redispatched to the TRELLIS worker, which holds the same reference image. When TRELLIS.2 starts taking traffic we will publish its measured timings beside the TRELLIS numbers above.

## Try it

- Upload a photo at [three.ws/forge](https://three.ws/forge).
- Connect any MCP client to `https://three.ws/api/mcp-studio`; the generation tools need no key.
- Run either worker on a 24 GB NVIDIA GPU: Dockerfiles, tests and READMEs are in [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws).

Thanks to the TRELLIS and TRELLIS.2 teams at Microsoft Research for releasing models under a license that lets them run as production infrastructure.

*TRELLIS and TRELLIS.2 are released by Microsoft Research under the MIT license. Microsoft is a trademark of the Microsoft group of companies.*
