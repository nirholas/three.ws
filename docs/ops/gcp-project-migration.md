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
5. Create the crons in the new project, then pause or delete the old ones in the
   same session:
   `GCP_PROJECT=three-ws GCP_SERVICE_URL=https://three-ws-api-360846920264.us-central1.run.app node scripts/create-gcp-scheduler.mjs`
6. Deploy current `main` to the new project (`GCP_BILLING_PROJECT` only takes
   effect with code from 2026-11-25 on; the running image predates it).
7. Scale the old `three-ws-api` to min 0 once traffic has drained. Keep the old
   LB until DNS TTLs have long expired, then ask the owner before deleting it.
