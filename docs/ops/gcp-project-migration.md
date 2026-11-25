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
| Redis | `three-ws` | VM `three-ws-redis` at 10.128.0.50 behind connector `three-ws-vpc` |
| Secrets | both | All 87 copied; sha256 of every old and new value matched |
| Wallet backup KMS key | both | New envelopes use `projects/three-ws/.../wallet-backup`; old envelopes keep opening with the old key (see below) |
| Model and GPU services | `aerial-vehicle-466722-p5` | Public URLs, called cross-project. The trial has no GPU quota, so they stay |
| GCS buckets `three-ws-storage-fallback`, `three-ws-x-content-bundles` | `aerial-vehicle-466722-p5` | `three-ws@three-ws` has `storage.objectAdmin` on both |
| BigQuery `billing_export` | `aerial-vehicle-466722-p5` | `three-ws@three-ws` has `bigquery.jobUser` + `bigquery.dataViewer`; new service sets `GCP_BILLING_PROJECT=aerial-vehicle-466722-p5` |
| Neon Postgres | external | Same database for both services |
| Cloud Scheduler crons | `aerial-vehicle-466722-p5` | Moved only at cutover, never run in both |

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

## Cutover checklist

1. Lift the org policy (above) and confirm the run.app URL serves publicly.
2. Create the global external load balancer, static IP and Google-managed
   certificate for `three.ws` in `three-ws` (serverless NEG to `three-ws-api`).
3. Move the DNS A record at Namecheap from the old LB IP 136.68.246.178 to the
   new IP. Wait for the certificate to become ACTIVE.
4. Create the crons in the new project, then pause or delete the old ones in the
   same session:
   `GCP_PROJECT=three-ws GCP_SERVICE_URL=https://three-ws-api-360846920264.us-central1.run.app node scripts/create-gcp-scheduler.mjs`
5. Scale the old `three-ws-api` to min 0 once traffic has drained.
