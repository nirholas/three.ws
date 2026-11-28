# GCP migration manifest: what moves to `three-ws`, what stays behind

Owner decision of 2026-11-27: move every three.ws piece the product needs from
project `aerial-vehicle-466722-p5` (the old project) to project `three-ws` (the
new project), and leave everything else behind to be retired. This file is the
single list of both. Update the Status column as each piece lands.

Related: [gcp-project-migration.md](gcp-project-migration.md) (how the API itself
moved, the load balancer, the cutover checklist),
[forge-protected-lanes.md](forge-protected-lanes.md) (rules for `model-trellis`).

Evidence for every row: Cloud Monitoring over 2026-10-27 to 2026-11-26
(`run.googleapis.com/request_count` and
`run.googleapis.com/container/billable_instance_time`), and the Forge lane
counters at `https://three.ws/api/nvidia/stats` read on 2026-11-26.

## Gate: billing must be able to run GPUs

The new project bills to `017D74-E15D20-A83802`, a free trial. A free trial has
no GPU quota, and its $300 would not cover a week of the fleet below. The startup
credits belong to the old billing account `01B467-A61905-9A97D2`, not to the old
project. Linking project `three-ws` to that account (option 1 in
[gcp-project-migration.md](gcp-project-migration.md)) lets every row below move
while the credits keep paying. Nothing in the GPU rows can deploy until billing
is settled.

The CPU rows are blocked too. Measured on 2026-11-27: the trial's Cloud Run quota
is 20 vCPU and 40 GiB per region for the whole project, and `three-ws-api`
already reserves 10 vCPU and 40 GiB at its max of 5 instances. The first worker
deploy (`rembg-service`, 4 CPU / 16Gi, max 4) was refused with
`CpuAllocPerProjectRegion requested: 400000 allowed: 20000`. Fitting under that
quota would mean cutting every worker's max instances, which makes the product
worse, so the deploys wait for billing instead.

### Done ahead of the billing change (2026-11-27)

- **Images:** the live digest of all 18 services is copied into
  `us-central1-docker.pkg.dev/three-ws/workers/<service>:migrated`
  (`granite-guardian` into the europe-west4 `workers` repository), with the same
  digests as the old revisions. Both repositories keep the newest 3 versions and
  delete anything older than 30 days.
- **Runtime identity:** `workers@three-ws` replaces the old
  `avatar-reconstruction-sa`, which held Cloud Run admin, Storage admin and Cloud
  Build rights it never used. The new account holds only: object admin on
  `three-ws-avatar-reconstructions` and `three-ws-garments`, object viewer on
  `three-ws-model-weights` (no worker writes there), Firestore user and Vertex
  user on the old project (where the reconstruction jobs and the Imagen calls
  live), the `avatar-reconstruction-key` secret, and log, metric and trace
  writers. Services that ran as the old `three-ws@` account run as
  `three-ws@three-ws`.
- **Secrets:** the six the bots need (`okx-chat-bot-database-url`,
  `okx-chat-bot-llm-gateway-token`, `pulse-database-url`,
  `pulse-solana-ws-urls`, `pulse-solana-rpc-urls`, `pumpfun-claims-bot-token`)
  are copied, each value hash-checked against the old one.
- **Configs:** each new service is generated from the live old service's own
  config (CPU, memory, GPU, CPU allocation, concurrency, timeout, probes,
  bucket mounts, env, secret references), changing only the image path and the
  service account. Two deliberate differences, both in `three-ws-multiplayer`:
  it reaches Redis on the `three-ws-redis` VM over Direct VPC egress instead of
  the old connector, and `HOLDER_PASS_SECRET` comes from Secret Manager instead of
  a plain env value (same value, checked by hash).
- **Build access:** `three-ws-build@three-ws` can read the old project's
  registries, which the image copy used.

### Services that must never run in both projects

`pulse`, `pumpfun-claims-bot` and `okx-chat-bot` post to channels or write to
the database on their own loop. Two copies would double every post. They move
in one step at cutover: stop the old one, then deploy the new one. Every other
service is called only through an API env var, so its new copy can run beside
the old one until the switch.

## How each worker moves

The API reaches every worker through one env var on `three-ws-api` (listed per
row). That makes each move reversible in one command:

1. Copy the image that is serving now, by digest, into
   `us-central1-docker.pkg.dev/three-ws/workers/<service>`. Only the live digest
   moves, never the history (the old registry holds about 870 GB of old builds).
2. Deploy it in the new project with the same region, CPU, memory, GPU,
   concurrency, timeout, env and secrets as the live revision, under a runtime
   service account in `three-ws`, at min 0.
3. Smoke it directly (health route plus one real request).
4. Point the API's env var at the new URL with `--update-env-vars`. Rolling back
   is the same command with the old URL.
5. Watch a day of traffic, then set the old service to min 0. Deleting the old
   service needs the owner's yes.

`model-trellis` follows the same steps with stricter rules, because it is a
protected lane: the image digest, the Cloud Run config, the request the API
sends and its place in `api/_lib/forge-tiers.js` stay byte-for-byte the same.
Only the URL in `MODEL_TRELLIS_URL` changes. Before the switch, the new
service must pass the lane's own smoke test. After it, re-measure the lane with
the command in [forge-protected-lanes.md](forge-protected-lanes.md); if success
drops below the 7-day figure (95.5%), set the URL back.

## Moving to `three-ws`

### Already moved

| Piece | Where it is now | Status |
| --- | --- | --- |
| `three-ws-api` | `three-ws`, us-central1 | Built and verified; serves the public once DNS moves. Runs older code than the live service (revision `00004` of 2026-11-27 13:41 vs the old project's `00561` of 23:33), so cutover step 6 (deploy current `main`) is required |
| Secrets (87 the API reads) | Secret Manager in `three-ws` | Copied, every value hash-checked; re-checked 2026-11-28, no drift |
| Secrets (39 more, 2026-11-28) | Secret Manager in `three-ws`, label `migrated-from=aerial-vehicle-466722-p5` | Copied, every value hash-checked. See "2026-11-28 sweep" below |
| Redis for the API | VM `three-ws-redis` (e2-small), Direct VPC egress | Live on the new API since revision `three-ws-api-00003-tjr` |
| Load balancer and certificate | `three-ws-ip` 136.82.11.20 | Built; certificate `ACTIVE`; waits on the DNS A records |
| Crons | One `three-ws-scheduler-tick` job | Created at cutover, never in both projects |
| Vertex AI access | `vercel-inference@aerial-vehicle-466722-p5` holds `aiplatform.user` on `three-ws` | Granted 2026-11-28, verified with real calls. See "2026-11-28 sweep" below |
| Monitoring | Uptime check `three.ws API healthz`, policies `Event: three.ws is DOWN` and `Event: three-ws-api 5xx rate elevated`, email channel | Created 2026-11-28 (mirrors the old project's) |

### Required (the site breaks or data is lost without these)

| Service | Old region | 30-day requests | 30-day instance-hours | API env var | Status |
| --- | --- | --- | --- | --- | --- |
| `model-trellis` | us-central1 | 362,196 | 1,033 | `MODEL_TRELLIS_URL` | Image and config ready; waits on billing (protected lane) |
| `model-rig` | us-central1 | 29,643 | 805 | `GCP_UNIRIG_URL` | Image and config ready; waits on billing |
| `rembg-service` | us-central1 | 58,727 | 748 | `GCP_REMBG_URL` | Image and config ready; waits on billing |
| `granite-guardian` | europe-west4 | 101,963 | 317 | `GRANITE_GUARDIAN_URL` | Image and config ready; waits on billing |
| `three-ws-multiplayer` | us-central1 | 222,873 | 716 | `MULTIPLAYER_INTERNAL_URL` | Image and config ready (uses the new Redis VM); waits on billing |

`model-trellis` is the lane that serves Forge: 877 finished jobs in the 7 days to
2026-11-26 at 95.5% success, out of about 900 across every lane. Its weights live
in `three-ws-model-weights`.

### Live features with light use

| Service | Old region | 30-day requests | 30-day instance-hours | API env var | Status |
| --- | --- | --- | --- | --- | --- |
| `model-text2motion` | us-east4 | 12,347 | 528 | `GCP_TEXT2MOTION_URL` | Image and config ready; waits on billing |
| `model-triposg` | us-central1 | 35,414 | 412 | `GCP_TRIPOSG_URL` | Image and config ready; waits on billing |
| `segment-service` | us-central1 | 9,014 | 709 | `GCP_SEGMENT_URL` | Image and config ready; waits on billing |
| `remesh-service` | us-central1 | 7,736 | 710 | `GCP_REMESH_URL` | Image and config ready; waits on billing |
| `stylize-service` | us-central1 | 7,278 | 709 | `GCP_STYLIZE_URL` | Image and config ready; waits on billing |
| `garment-forge` | us-central1 | 4,330 | 716 | `GCP_GARMENT_FORGE_URL` | Image and config ready; waits on billing |
| `avatar-reconstruction` | us-central1 | 675 | 679 | `GCP_RECONSTRUCTION_URL` | Image and config ready; waits on billing |
| `avatar-reconstruction-rtx` | europe-west4 | 2,220 | 7 | none (called by `avatar-reconstruction`) | Image and config ready; waits on billing |
| `pulse` | us-central1 | 3,254 | 538 | `PULSE_URL` | Image, secrets and config ready; moves at cutover |
| `liquidation-collector` | us-central1 | 378 | 682 | `LIQUIDATION_COLLECTOR_URL` | Image and config ready; waits on billing |
| `pumpfun-creator-rewards` | us-central1 | 12,733 | 1 | none (called on its own schedule) | Image and config ready; waits on billing |
| `pumpfun-claims-bot` | us-central1 | 4 | 678 | none (feeds `/api/agents/pumpfun`) | Image, secrets and config ready; moves at cutover |
| `okx-chat-bot` | us-central1 | 121 | 680 | none (health read from its logs) | Image, secrets and config ready; moves at cutover |

`model-triposg` is the Forge fallback lane and fails more often than it
succeeds (17 done, 26 failed in 7 days). It moves as it is; fixing it is
separate work.

Cloud Run jobs that move: `vanity-grinder` and `three-ws-x-partners`. Their live
images are copied by digest to `us-central1-docker.pkg.dev/three-ws/workers/<job>:migrated`
and their secrets are in `three-ws` (2026-11-28). `three-ws-x-partners` runs
daily from the old Scheduler job `three-ws-x-partners-daily`, which is not a
`vercel.json` cron, so the tick never replaces it: recreate it in `three-ws`
when the job moves, and pause the old one in the same session.

### Efficiency changes made during the move

The move redeploys each worker anyway, so these land with it. None changes what
a user gets:

- **CPU allocation stays as it is.** `segment-service`, `remesh-service`,
  `stylize-service`, `garment-forge`, `rembg-service` and
  `avatar-reconstruction` bill 20 to 24 hours a day for a few thousand requests
  a month, but each one answers `202` and finishes the job in a FastAPI
  background task. Billing CPU only during requests would freeze those jobs, so
  the saving needs a code change (for example, Cloud Tasks pushing each job as
  its own request) and is not part of the move.
- **Least-privilege runtime account** (`workers@three-ws`, above).
- **One image per worker, not every build.** The new registry gets a cleanup
  policy that keeps the newest versions and anything deployed.
- **No second Redis proxy.** The old site's Redis path (`three-ws-redis-proxy`
  at min 1, an internal load balancer and a VPC connector) is replaced by the
  VM and Direct VPC egress the API already uses.

### Buckets: kept by name, used from `three-ws`

A bucket cannot change projects, and bucket names are global, so a copy in
`three-ws` would need a new name. That name is the problem:
`three-ws-avatar-reconstructions` appears in 82 source files and
`three-ws-model-weights` in 110, and stored user links (avatars, generated
models, garments) point at public URLs that contain the bucket name. Renaming
would break every stored link. Storage for all of them is about $23 a month, and
reads from a Cloud Run service in the same region cost nothing extra across
projects, so these buckets stay in the old project under their own names. The
new services are granted access instead:

| Bucket | Used by | Access from `three-ws` |
| --- | --- | --- |
| `three-ws-avatar-reconstructions` | Every Forge and avatar worker writes results here (242 GB, public read) | `workers@three-ws` object admin |
| `three-ws-model-weights` | Bucket mounts in `model-trellis`, `model-rig`, `model-triposg`, `model-text2motion`, `granite-guardian` (413 GB) | `workers@three-ws` object viewer |
| `three-ws-garments` | `garment-forge` publishes here (public read) | `workers@three-ws` object admin |
| `three-ws-storage-fallback` | The API | `three-ws@three-ws` object admin |
| `three-ws-x-content-bundles` | The API | `three-ws@three-ws` object admin |
| `three-ws-desktop-releases` | The new load balancer, through an internet NEG | Public read |
| `three-ws-db-backups`, `three-ws-db-archive`, `three-ws-news-archive` | Backup and archive jobs | Granted when those jobs move |
| `three-ws-okx-bot-state` | `okx-chat-bot` (116 GB) | Granted when the bot moves at cutover |

This keeps the old project alive for as long as these buckets live in it,
under the old billing account. If the old project is ever closed, each bucket
moves with a same-name swap: copy to a temporary bucket, delete the original,
create the name in `three-ws`, copy back. That deletes the original, so it
needs the owner's yes and a short write freeze per bucket.

## 2026-11-28 sweep: gaps the first manifest missed

A full diff of both projects (services, jobs, Scheduler, secrets, enabled APIs,
buckets, monitoring, IAM) on 2026-11-28 found these. Reproduce the secret diff
with `comm -23` over `gcloud secrets list --format='value(name)'` of each
project.

- **Vertex AI was broken in the new project (fixed).** The API signs Vertex
  calls with the key in `GCP_SERVICE_ACCOUNT_JSON`
  (`api/_lib/gcp-auth.js` prefers it over the metadata server), and that key
  belongs to `vercel-inference@aerial-vehicle-466722-p5`, which held no role in
  `three-ws`. Every Vertex call from the new API (Gemini, Imagen, embeddings,
  Gemini TTS, the Forge reference image and quality gate) answered
  `PERMISSION_DENIED`. That account now holds `roles/aiplatform.user` on
  `three-ws`; a real Gemini and embedding call as that identity returns 200.
  The identity still lives in the old project. Replacing it with a key for an
  account in `three-ws` needs the org policy
  `iam.managed.disableServiceAccountKeyCreation` lifted for the project, since
  `ai-image-lanes.js` and the signed URLs in `storage-fallback.js` require a key.
- **Model access on the trial billing account.** Tested 2026-11-28 in
  `three-ws`: `gemini-3-flash-preview` (global), `gemini-2.5-flash-image`
  (global), `gemini-2.5-flash-preview-tts`, `gemini-2.5-flash-tts` and
  `text-embedding-005` answer. `gemini-2.5-flash`, `gemini-2.5-flash-lite` and
  every Imagen model (`imagen-4.0-generate-001`, `-fast`, `-ultra`,
  `imagen-3.0-generate-002`) return 404 "publisher model not found". The code
  pins `gemini-2.5-flash` and `imagen-4.0-generate-001`. Re-test these right
  after the billing change; if they still 404 on a paid account, the pins move
  to the models that answer, as a code change with its own tests.
- **Secrets the first copy skipped.** The first copy took only what
  `three-ws-api` reads. These 39 were copied on 2026-11-28: the two
  `vanity-grinder` needs (`JWT_SECRET`, `WALLET_ENCRYPTION_KEY`); keys that
  cannot be regenerated (the Seeker Android release keystore and its password,
  the four `SOLANA_PROGRAM_KEYPAIR_*` program keys,
  `SOLANA_DEVNET_DEPLOY_AUTHORITY`, the x402 buyer and receiver keys, the two EVM
  relay and pay-to keys, the retired sniper's master and funder wallets, two test
  wallets); and the secrets of three.ws workers and services that are not
  deployed today (`agora-citizens`, `autopilot`, `agent-orders`, `deploy/world`,
  `cad-forge`, `longcat`, the second Hugging Face and NVIDIA keys, the R2 keys
  for the pano capture scripts, the claims bot env, a QuickNode RPC URL, and the
  three retired claim bots' tokens). Left behind on purpose: the old Redis URIs
  (replaced by the VM) and every secret of the owner's other projects.
- **Scheduler jobs outside the tick.** Besides `three-ws-x-partners-daily`
  (above), `db-backup-daily` runs a Cloud Build in the old project every day at
  06:30 UTC (`deploy/db-backup/`, `scripts/schedule-db-backup.mjs`). Neither
  `--tick` nor `--pause` touches it, so backups keep running from the old
  project. Move it with the backup buckets.
- **Monitoring.** The old project's uptime checks and alert policies covered
  three.ws, and the 5xx policy watches the old `three-ws-api`, so it goes blind
  at cutover. The new project now has the healthz uptime check, the DOWN policy
  and the 5xx policy, emailing the same address. The `three.ws world server`
  check targets the old `three-ws-multiplayer` URL; add it in `three-ws` when
  multiplayer moves.
- **Buckets checked and not needed:** `three-ws-sandbox` is empty and no sandbox
  runner is configured. `three-ws-veo` is used only by local scripts.
  `three-ws-autopilot`, `three-ws-human-tasks`, `three-ws-lib-releases` and
  `world-three-ws-data` have no reader in the API.

## Staying in the old project

### Kept there on purpose

- **KMS key `wallet-backup`** (key ring `x402-wallet-custody`, us-central1) and
  the `cryptoKeyDecrypter` grant to `three-ws@three-ws`. KMS keys cannot be
  exported, and every wallet backup sealed before 2026-11-25 names this key.
  Destroying it or the grant makes those backups unreadable. It stays as long
  as any old backup exists.
- **Services, buckets, a Cloud SQL instance and load balancers that belong to
  other projects.** They are not three.ws and are out of scope.

### Left behind to retire (three.ws, but nothing needs them)

Each of these is set to min 0 and deleted only with the owner's yes. A lane the
API still names (env var in brackets) is removed from the API's config first,
so Forge never routes to it.

- **Expensive and barely used:** `model-hunyuan3d-21-rtx` (RTX PRO 6000, 698
  instance-hours for 8 Forge jobs in 30 days, `GCP_HUNYUAN3D_URL`) and
  `model-pixal3d` in europe-west4 and us-central1 (3 done, 8 failed in 7 days,
  `MODEL_PIXAL3D_URL`).
- **Always on, nobody calls them:** `agent-sniper` (0 requests),
  `pumpfun-claim-bot`, `pumpfun-channel-bot` and `pumpfun-allclaims-bot` (0 to 4
  requests, duplicates of `pumpfun-claims-bot`), `wallet-sleuth` (16 requests),
  `model-video2motion` (313 requests, 681 instance-hours,
  `GCP_VIDEO2MOTION_URL`).
- **Second-region copies with almost no traffic:** `model-trellis` us-east4
  (174), `model-triposg` europe-west4 (122), `model-rig-nonhuman` (us-central1
  7,551 and us-east4 21; folded into `model-rig`'s lane), `model-text2motion`
  us-central1 (21), `model-hunyuan3d` us-central1 and us-east4,
  `model-triposr` us-central1 and us-east4, `model-triposplat` us-central1 and
  europe-west4 (`MODEL_TRIPOSPLAT_URL`).
- **Models with almost no use:** `model-trellis2` (2 Forge jobs in 30 days),
  `model-hunyuan3d-21`, `model-cosmos` (`COSMOS_WORKER_URL`),
  `model-cosmos-reason`, `model-anigen`, `model-asl-recognition`
  (`GCP_ASL_RECOGNITION_URL`), `usd-export-service` (`GCP_USD_EXPORT_URL`),
  `chain347-video2motion`, `chain347-pano2splat`, `chain347-panodepth`.
- **Bench, lab, staging, canary and test services:** `model-trellis2-bench-1`,
  `-bench-2`, `-bench-3`, `model-trellis2-lab`,
  `avatar-reconstruction-dense-staging`, `model-hunyuan3d-21-rtx-canary`,
  `three-ws-multiplayer-redis-test`, `avatar-reconstruction-rtx` us-central1,
  `model-anigen` us-central1, and every verify, probe and selftest job.
- **The old site's Redis stack**, after cutover: Memorystore `three-ws-redis`,
  `three-ws-redis-proxy`, its internal load balancer and VPC connector.
- **The old `three-ws` load balancer and IP 136.68.246.178**, after DNS TTLs
  expire.
- **Stopped VMs and orphaned disks:** 17 TERMINATED VMs (about 2.6 TB of disk)
  and Workstation disks `workstations-88abd248...` and
  `workstations-f09408b1...`. Snapshot first, then delete.
  `workstations-d4594ca8-c380-4e8b-b57e-fd42e1ee5170` is kept by owner decision.
- **Idle static IPs:** one unused reservation and `trellis-nim-ip`.
- **Old container images:** about 870 GB in Artifact Registry; only the live
  digests above are copied.
- **Buckets nothing reads:** the winget staging buckets,
  `three-ws-ngc-validation`, `three-ws-cosmos-worker-euw4`,
  `three-ws-capture-fixtures`, `three-ws-pano-captures` and
  `three-ws-model-weights-euw4` (116 GB, weights for europe-west4 copies that are
  retired above, except `granite-guardian`, which is checked before this bucket
  goes).

## Code that still names the old project

These fall back to `aerial-vehicle-466722-p5` when `GOOGLE_CLOUD_PROJECT` is
unset. The new API sets `GOOGLE_CLOUD_PROJECT=three-ws`, so they resolve to the
new project in production. The defaults change once the old project holds no
three.ws service: `api/_lib/cloud-domains.js`, `api/_lib/tracing.js`,
`api/_lib/sandbox/config.js`, `api/_lib/agent-vitals/sniper-probe.js`, and the
operator hints in `api/_lib/ops/subsystem-health.js`. `GCP_BILLING_PROJECT`
stays on the old project until a billing export exists in `three-ws`.
