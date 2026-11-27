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
is settled; the CPU rows and buckets can, but would spend trial credit.

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
| `three-ws-api` | `three-ws`, us-central1 | Built and verified; serves the public once DNS moves |
| Secrets (87) | Secret Manager in `three-ws` | Copied, every value hash-checked |
| Redis for the API | VM `three-ws-redis` (e2-small), Direct VPC egress | Live on the new API since revision `three-ws-api-00003-tjr` |
| Load balancer and certificate | `three-ws-ip` 136.82.11.20 | Built; waits on the DNS records |
| Crons | One `three-ws-scheduler-tick` job | Created at cutover, never in both projects |

### Required (the site breaks or data is lost without these)

| Service | Old region | 30-day requests | 30-day instance-hours | API env var | Status |
| --- | --- | --- | --- | --- | --- |
| `model-trellis` | us-central1 | 362,196 | 1,033 | `MODEL_TRELLIS_URL` | Waits on billing (protected lane) |
| `model-rig` | us-central1 | 29,643 | 805 | `GCP_UNIRIG_URL` | Waits on billing |
| `rembg-service` | us-central1 | 58,727 | 748 | `GCP_REMBG_URL` | Not started |
| `granite-guardian` | europe-west4 | 101,963 | 317 | `GRANITE_GUARDIAN_URL` | Waits on billing |
| `three-ws-multiplayer` | us-central1 | 222,873 | 716 | `MULTIPLAYER_INTERNAL_URL` | Not started; its Memorystore moves with it |

`model-trellis` is the lane that serves Forge: 877 finished jobs in the 7 days to
2026-11-26 at 95.5% success, out of about 900 across every lane. Its weights live
in `three-ws-model-weights`.

### Live features with light use

| Service | Old region | 30-day requests | 30-day instance-hours | API env var | Status |
| --- | --- | --- | --- | --- | --- |
| `model-text2motion` | us-east4 | 12,347 | 528 | `GCP_TEXT2MOTION_URL` | Waits on billing |
| `model-triposg` | us-central1 | 35,414 | 412 | `GCP_TRIPOSG_URL` | Waits on billing |
| `segment-service` | us-central1 | 9,014 | 709 | `GCP_SEGMENT_URL` | Not started |
| `remesh-service` | us-central1 | 7,736 | 710 | `GCP_REMESH_URL` | Not started |
| `stylize-service` | us-central1 | 7,278 | 709 | `GCP_STYLIZE_URL` | Not started |
| `garment-forge` | us-central1 | 4,330 | 716 | `GCP_GARMENT_FORGE_URL` | Not started |
| `avatar-reconstruction` | us-central1 | 675 | 679 | `GCP_RECONSTRUCTION_URL` | Not started |
| `avatar-reconstruction-rtx` | europe-west4 | 2,220 | 7 | none (called by `avatar-reconstruction`) | Waits on billing |
| `pulse` | us-central1 | 3,254 | 538 | `PULSE_URL` | Not started |
| `liquidation-collector` | us-central1 | 378 | 682 | `LIQUIDATION_COLLECTOR_URL` | Not started |
| `pumpfun-creator-rewards` | us-central1 | 12,733 | 1 | none (called on its own schedule) | Not started |
| `pumpfun-claims-bot` | us-central1 | 4 | 678 | none (feeds `/api/agents/pumpfun`) | Not started |
| `okx-chat-bot` | us-central1 | 121 | 680 | none (health read from its logs) | Not started |

`model-triposg` is the Forge fallback lane and fails more often than it
succeeds (17 done, 26 failed in 7 days). It moves as it is; fixing it is
separate work.

Cloud Run jobs that move: `vanity-grinder` and `three-ws-x-partners`.

### Efficiency changes made during the move

The move redeploys each worker anyway, so these land with it. None changes what
a user gets:

- **Request-based billing for the idle CPU workers.** `segment-service`,
  `remesh-service`, `stylize-service` and `garment-forge` each bill 20 to 24
  hours a day on 8 CPU / 16Gi for 4k to 9k requests a month, because their CPU
  is allocated even when idle. If a worker does no background work, it is
  redeployed with CPU billed only during requests. A worker that does
  background work keeps its setting.
- **One image per worker, not every build.** The new registry gets a cleanup
  policy that keeps the newest versions and anything deployed.
- **No second Redis proxy.** The old site's Redis path (`three-ws-redis-proxy`
  at min 1, an internal load balancer and a VPC connector) is replaced by the
  VM and Direct VPC egress the API already uses.

### Buckets

| Bucket | Why it moves | Status |
| --- | --- | --- |
| `three-ws-db-backups` | Database backups, cannot be regenerated | Not started |
| `three-ws-db-archive` | Archived rows, cannot be regenerated | Not started |
| `three-ws-avatar-reconstructions` | User outputs (242 GB) | Not started |
| `three-ws-news-archive` | Archived content, cannot be regenerated | Not started |
| `three-ws-storage-fallback` | Live storage fallback; `three-ws@three-ws` already has access | Not started |
| `three-ws-desktop-releases` | Desktop builds, served at `/releases/` | Not started; the new LB reads it through an internet NEG until then |
| `three-ws-x-content-bundles` | Served by the site; `three-ws@three-ws` already has access | Not started |
| `three-ws-model-weights` | Weights for `model-trellis` and other workers (413 GB) | Not started; moves before the workers that read it |
| `three-ws-okx-bot-state` | State for `okx-chat-bot` (116 GB) | Moves with the bot if the bot reads it |

Bucket names are global, so a bucket cannot keep its name in a new project
without being emptied and deleted first. Each one is copied with Storage
Transfer Service to a new name in `three-ws` in the same location (no egress
charge within a location), the readers' env vars are switched, and the old
bucket stays read-only until the owner says yes to deleting it.

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
