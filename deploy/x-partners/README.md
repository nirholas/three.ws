# Partner spotlight runner

The image and schedule that run the daily partner spotlight (`npm run x:partners -- daily`) unattended. What the series is and how it decides what to post is in [docs/x-partner-series.md](../../docs/x-partner-series.md).

| File | Purpose |
|---|---|
| [Dockerfile](Dockerfile) | The repo with devDependencies kept, Chromium for the locked Playwright version, ffmpeg (via `ffmpeg-static`), and the COLRv1 emoji font the reel check requires. The production image has none of these on purpose. |
| [run.sh](run.sh) | One day: `x-bundle pull` materializes production's overlay so the rotation sees what already shipped, then `x-partners daily --days $X_PARTNERS_DAYS --overlay <dir> --ship`. |
| [cloudbuild.yaml](cloudbuild.yaml) | Builds the image into `cloud-run-source-deploy/x-partners` from the repo root. |
| [scripts/create-x-partners-job.mjs](../../scripts/create-x-partners-job.mjs) | Builds the image, creates the Cloud Run Job `three-ws-x-partners` with the `three-ws-api` service's environment (Secret Manager references stay references), and schedules it at 08:10 UTC daily. |

```bash
node scripts/create-x-partners-job.mjs             # print the plan, change nothing
node scripts/create-x-partners-job.mjs --apply     # build, create or update the job and its schedule
node scripts/create-x-partners-job.mjs --run-now   # the same, then start one run
```

Shipping a bundle publishes to @trythreews, so applying this is an owner decision. Nothing posts on its own until production has `X_CONTENT_AUTO_PUBLISH=true`, and every released spotlight still sits behind the queue's veto window.

The job runs as `three-ws@`, takes 2 CPU and 4 GiB, times out after three hours, and never retries: three days are kept in stock, so a failed run is refilled by the next one. Rebuild the image (`--apply` without `--skip-build`) after the registry or the engine changes, because the job films and drafts from the code baked into it.
