# Moving three-ws-api to project `three-ws`

Status as of 2026-11-25. The main site service `three-ws-api` is being moved
from project `aerial-vehicle-466722-p5` (org 530103279143, account
`nich@sperax.io`) to project `three-ws` (number 360846920264, org 643555747585,
account `nich@three.ws`, billing account 017D74-E15D20-A83802 on the free trial).

Both accounts are signed in on the devbox. Pass `--account` on every gcloud call
so commands never hit the wrong project.

Related: [gcp-production.md](gcp-production.md) (the main runbook),
[deploy/redis-vm/README.md](../../deploy/redis-vm/README.md) (the new Redis).

## What runs where

| Piece | Project | Notes |
| --- | --- | --- |
| `three-ws-api` (new) | `three-ws` | https://three-ws-api-360846920264.us-central1.run.app, SA `three-ws@three-ws`, 8Gi, 2 CPU, min 1, max 5 |
| `three-ws-api` (live) | `aerial-vehicle-466722-p5` | Still serves three.ws until DNS moves |
| Redis | `three-ws` | VM `three-ws-redis` at 10.128.0.50, reached over Direct VPC egress (subnet `default`); the `three-ws-vpc` connector is no longer used |
| Secrets | both | All 87 copied; sha256 of every old and new value matched |
| Wallet backup KMS key | both | New envelopes use `projects/three-ws/.../wallet-backup`; old envelopes keep opening with the old key (see below) |
| Model and GPU services | `aerial-vehicle-466722-p5` | Public URLs, called cross-project. The trial has no GPU quota, so they stay |
| GCS buckets `three-ws-storage-fallback`, `three-ws-x-content-bundles` | `aerial-vehicle-466722-p5` | `three-ws@three-ws` has `storage.objectAdmin` on both |
| BigQuery `billing_export` | `aerial-vehicle-466722-p5` | `three-ws@three-ws` has `bigquery.jobUser` + `bigquery.dataViewer`; new service sets `GCP_BILLING_PROJECT=aerial-vehicle-466722-p5` |
| Neon Postgres | external | Same database for both services |
| Cloud Scheduler crons | `aerial-vehicle-466722-p5` | Moved only at cutover, never run in both. In `three-ws` they run as one tick job (`--tick`), not 180 jobs |

The old project's billing must stay on while the GPU services, buckets, KMS key
and billing export live there.

## Do not delete the old KMS key

Each envelope names the key that sealed it (`api/_lib/kms-envelope.js`), and KMS
keys cannot be exported. `three-ws@three-ws` holds `cryptoKeyDecrypter` on
`projects/aerial-vehicle-466722-p5/locations/us-central1/keyRings/x402-wallet-custody/cryptoKeys/wallet-backup`.
Destroying that key, or that grant, makes every older wallet backup unreadable,
and `wallet-custody.js` fails closed when KMS refuses.

## Free-trial limits that shape the deploy

- **Cloud Run memory:** 40 GiB per region, so at most 5 instances at 8Gi.
- **Cloud Build machines:** `E2_HIGHCPU_32` (set in `server/cloudbuild.yaml`) and
  `E2_HIGHCPU_8` are refused. Set `GCP_BUILD_MACHINE_TYPE=e2-medium` and the
  submit passes `--machine-type`, which overrides the config.
- **No GPUs.**

## Deploying to `three-ws`

`server/cloudbuild.yaml` derives the image, runtime SA and build SA from
`$PROJECT_ID`, and the deploy scripts read `GCP_PROJECT`:

```bash
# Before cutover: submit only. deploy:gcp also runs sync-crons, which would
# create a second copy of every cron in the new project.
GCP_PROJECT=three-ws GCP_BUILD_MACHINE_TYPE=e2-medium npm run deploy:gcp:submit
```

After cutover, `GCP_PROJECT=three-ws GCP_BUILD_MACHINE_TYPE=e2-medium npm run deploy:gcp:full`
is the normal path.

## Public access is blocked by an org policy

The new org enforces `iam.allowedPolicyMemberDomains` (domain-restricted
sharing), so `allUsers` cannot be granted `run.invoker` and the service answers
403 to the public. The org admin lifts it for this one project:

```bash
gcloud organizations add-iam-policy-binding 643555747585 \
  --account nich@three.ws --member=user:nich@three.ws --role=roles/orgpolicy.policyAdmin

cat > /tmp/allow-all.yaml <<'EOF'
name: projects/three-ws/policies/iam.allowedPolicyMemberDomains
spec:
  inheritFromParent: false
  rules:
    - allowAll: true
EOF
gcloud org-policies set-policy /tmp/allow-all.yaml --account nich@three.ws

gcloud run services add-iam-policy-binding three-ws-api --region us-central1 \
  --project three-ws --account nich@three.ws --member=allUsers --role=roles/run.invoker
```

Until then, test with an identity token:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token --account nich@three.ws)" \
  https://three-ws-api-360846920264.us-central1.run.app/api/healthz
```

## Load balancer (built 2026-11-25)

Mirrors the old `three-ws-lb`, with two differences forced by the project split.

| Piece | Name |
| --- | --- |
| Static IP | `three-ws-ip` = **136.82.11.20** |
| Site backend | `three-ws-backend` (serverless NEG `three-ws-api-neg`, Cloud CDN with origin cache headers, negative caching, serve-while-stale 86400) |
| Releases backend | `three-ws-releases-backend`: global internet NEG `three-ws-gcs-neg` to `storage.googleapis.com:443`, CDN on |
| URL maps | `three-ws-lb` (hosts `three.ws`, `www.three.ws`), `three-ws-http-redirect` (80 to 443) |
| Certificate | Certificate Manager `three-ws-cert` in map `three-ws-cert-map`, DNS-authorized |
| Proxies and rules | `three-ws-https-proxy`, `three-ws-http-proxy`, forwarding rules `three-ws-https` (443) and `three-ws-http` (80) |

- **Releases go through an internet NEG, not a backend bucket.** A backend
  bucket must be owned by the same project, and the desktop release pipeline
  writes to `three-ws-desktop-releases` in the old project. The route for
  `/releases/` rewrites the host to `storage.googleapis.com` and the path prefix
  to `/three-ws-desktop-releases/releases/`, so the public bucket stays the only
  copy.
- **The certificate uses DNS authorization**, so it turns ACTIVE before DNS
  moves and the cutover has no TLS gap. It needs two CNAMEs at Namecheap:

| Host (Namecheap "Host" field) | Type | Value |
| --- | --- | --- |
| `_acme-challenge` | CNAME | `f7f2a1c4-effc-42ac-afba-8f85888878f4.4.authorize.certificatemanager.goog.` |
| `_acme-challenge.www` | CNAME | `1dfdc7cc-6f02-4711-8bca-925261ae3fa8.19.authorize.certificatemanager.goog.` |

Check the certificate:

```bash
gcloud certificate-manager certificates describe three-ws-cert \
  --project three-ws --account nich@three.ws --format='value(managed.state,managed.authorizationAttemptInfo)'
```

`npm run deploy:gcp:purge-cdn` works unchanged with `GCP_PROJECT=three-ws`,
because the new URL map has the old name.

## Cutover checklist

1. Lift the org policy (above) and confirm the run.app URL serves publicly.
2. Add the two `_acme-challenge` CNAMEs at Namecheap and wait for
   `three-ws-cert` to report `ACTIVE`. Neither step touches the live site.
3. Check the new LB before switching:
   `curl --resolve three.ws:443:136.82.11.20 https://three.ws/api/healthz`
   and `curl --resolve three.ws:443:136.82.11.20 -I https://three.ws/releases/desktop/latest.yml`.
4. Move the `@` and `www` A records at Namecheap from 136.68.246.178 to
   136.82.11.20.
5. Deploy current `main` first (step 6), because the tick endpoint ships with
   it. Then create the single tick job in the new project and pause the old
   per-cron jobs in the same session:
   `GCP_PROJECT=three-ws GCP_SERVICE_URL=https://three-ws-api-360846920264.us-central1.run.app node scripts/create-gcp-scheduler.mjs --tick`
   then `node scripts/create-gcp-scheduler.mjs --pause` against the old project.
   One job instead of 180 saves about $18 a month (see "Crons" in
   [gcp-production.md](gcp-production.md)).
6. Deploy current `main` to the new project (`GCP_BILLING_PROJECT` only takes
   effect with code from 2026-11-25 on; the running image predates it).
7. Scale the old `three-ws-api` to min 0 once traffic has drained. Keep the old
   LB until DNS TTLs have long expired, then ask the owner before deleting it.

## Everything else in the old project (inventory of 2026-11-26)

Measured with the old project's account on 2026-11-26. The old project bills to the
old billing account `01B467-A61905-9A97D2`, which carries the startup
credits (100% of usage in year 1, 20% in year 2, see
[gcp-credits-plan.md](gcp-credits-plan.md)). The new project bills to
`017D74-E15D20-A83802`, a $300 free trial with no GPU quota. The billing export
dataset `billing_export` exists but has no tables (the export was never turned
on), so the costs below are list-price estimates from Cloud Monitoring's
billable instance time over the last 24 hours, not invoices.

### What costs money, by size

- **GPU workers, about $5k a month or more.** Every service is already at min 0;
  traffic keeps them warm. Last 24 hours of billable instance time:
  `granite-guardian` (L4, europe-west4) 24h, `model-trellis` 18h (protected lane),
  `model-rig` 18h, `model-text2motion` (us-east4) 17h, `model-hunyuan3d-21-rtx`
  (RTX PRO 6000) 14h, `model-triposg` 14h, `model-pixal3d` (europe-west4) 12h.
  The rest of the GPU fleet was warm for under 5 hours in 30 days.
- **Large CPU workers, about $2k a month.** `rembg-service` 45h a day (two
  instances), `garment-forge` 24h, `remesh-service`, `segment-service` and
  `stylize-service` 20h each (8 CPU / 16Gi, CPU always allocated),
  `three-ws-multiplayer` 24h.
- **The live `three-ws-api`**: min 2, about 84 instance-hours a day.
- **Stopped VMs that still bill for disks, about $480 a month for nothing
  running.** 17 VMs are TERMINATED, but their disks (1,530 GB pd-ssd, about 900 GB
  pd-balanced, 160 GB pd-standard) bill every month. Two Workstation disks with no
  workstation (`workstations-88abd248...` 1,000 GB, `workstations-f09408b1...`
  200 GB) add about $120. `workstations-d4594ca8...` is kept by owner decision.
  Snapshotting a disk and deleting it keeps the data for the snapshot's used
  bytes only (about $0.05 per GB used), usually a small fraction.
- **Artifact Registry, about 870 GB, about $87 a month.** No cleanup policy: every
  deploy's image is kept forever (`model-trellis` 77 GB, `cloud-run-source-deploy`
  118 GB with 25 `three-ws-api` versions, and so on).
- **Redis for the live site, about $75 a month**: Memorystore `three-ws-redis`,
  `three-ws-redis-proxy` at min 1, the internal LB and the connector. A second
  Memorystore, `three-ws-multiplayer`, adds about $35.
- **Load balancers, about $18 each**: `three-ws`, plus two that are not three.ws.
- **Idle static IPs, about $7 each**: one reserved and unused, plus
  `trellis-nim-ip` (on a stopped VM).
- **Buckets, about 1.1 TB, about $23 a month.** The largest are
  `three-ws-model-weights` (413 GB), `three-ws-avatar-reconstructions` (242 GB),
  `three-ws-okx-bot-state` (116 GB), `three-ws-model-weights-euw4` (116 GB) and
  the Cloud Build source bucket (88 GB, multi-region).

The old project also holds services, buckets, a Cloud SQL instance and two of
the three load balancers that are not three.ws. They stay where they are.

### The billing decision that sets the cost of the move

Credits belong to a billing account, not a project. Moving the GPU and CPU
worker fleet into `three-ws` while `three-ws` bills to the trial account turns
roughly $7k a month of credit-covered usage into cash spend, and the trial
cannot run GPUs at all. The options:

1. **Link project `three-ws` to the old billing account.** Every resource moves
   into `three-ws` and the credits keep paying. Needs a billing admin on
   `01B467-A61905-9A97D2` to link it.
2. **Upgrade the `three-ws` billing account to paid and move everything.** Clean
   separation from the old account, and the full bill is paid in cash.
3. **Move the cheap parts now, keep the GPU and CPU worker fleet in the old
   project while year-1 credits last**, then move it.

### Savings that lose nothing

These cut cost in either project without changing what users get. Each one
deletes something, so each needs the owner's yes:

- Snapshot, then delete, the disks of the 17 stopped VMs and the two orphaned
  Workstation disks (about $600 a month).
- An Artifact Registry cleanup policy that keeps the newest versions of every
  image and anything currently deployed (most of about $87 a month).
- Release the two idle static IPs (about $15 a month).
- After cutover: the old Redis stack, the old `three-ws` LB, and the old
  `three-ws-api` floor (about $100 a month plus the API's idle instances).
