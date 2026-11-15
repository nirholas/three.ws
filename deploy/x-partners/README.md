# X content runner

The image and schedules that run the authoring side of the @trythreews pipeline unattended. One image, two Cloud Run Jobs, picked by `X_RUNNER_TASK`:

| Job | Task | Schedule (UTC) | What it does |
|---|---|---|---|
| `three-ws-x-refill` | `refill` | 06:20 daily | `x-content advance --refresh --ship`: films, reviews and releases drafts by policy, renews every approved post whose reel, head or review expired before it went out (keeping its approval when the copy is unchanged), sends an ops alert listing anything it could not renew, and ships the result as bundles. See [docs/x-content-pipeline.md](../../docs/x-content-pipeline.md). |
| `three-ws-x-partners` | `partners` | 08:10 daily | The partner spotlight (`x-partners daily`). What the series is and how it decides what to post is in [docs/x-partner-series.md](../../docs/x-partner-series.md). |

| File | Purpose |
|---|---|
| [Dockerfile](Dockerfile) | The repo with devDependencies kept, Chromium for the locked Playwright version, ffmpeg (via `ffmpeg-static`), and the COLRv1 emoji font the reel check requires. The production image has none of these on purpose. |
| [run.sh](run.sh) | Dispatches on `X_RUNNER_TASK`. `partners` pulls production's overlay (`x-bundle pull`) so the rotation sees what already shipped, then runs `x-partners daily --days $X_PARTNERS_DAYS --overlay <dir> --ship`. `refill` runs `x-content advance --refresh --ship`. |
| [cloudbuild.yaml](cloudbuild.yaml) | Builds the image into `cloud-run-source-deploy/x-partners` from the repo root. |
| [scripts/create-x-partners-job.mjs](../../scripts/create-x-partners-job.mjs) | Builds the image, creates the chosen Cloud Run Job with the `three-ws-api` service's environment (Secret Manager references stay references) plus its task variables, and schedules it. |

```bash
node scripts/create-x-partners-job.mjs                                 # partner job: print the plan, change nothing
node scripts/create-x-partners-job.mjs --apply                         # build, create or update the partner job and its schedule
node scripts/create-x-partners-job.mjs --job refill --apply --skip-build   # the refill job, on the image just built
node scripts/create-x-partners-job.mjs --job refill --run-now          # the same, then start one run
```

Shipping a bundle publishes to @trythreews, so applying either job is an owner decision. Nothing posts on its own until production has `X_CONTENT_AUTO_PUBLISH=true`, and every released item still sits behind the queue's veto window.

Each job runs as `three-ws@`, takes 2 CPU and 4 GiB, times out after three hours, and never retries: a failed run is picked up by the next day's. Rebuild the image (`--apply` without `--skip-build`) after the queue, the registry or the engine changes, because both jobs film, draft and review from the code and queue baked into it.
