# Storage fallback bucket config

`three-ws-storage-fallback` (us-central1, private) takes every write the primary
object store (Cloudflare R2) refuses for an infrastructure reason. The runtime
side lives in [`api/_lib/storage-fallback.js`](../../api/_lib/storage-fallback.js);
the triage notes are in
[`docs/ops/production-log-triage.md`](../../docs/ops/production-log-triage.md).

## CORS (`cors.json`)

While R2 refuses our credential, `presignUpload()` signs browser uploads for this
bucket (GCS V4, signed over `content-type;host`). The browser PUTs cross-origin,
so the bucket needs a PUT rule for the web origins. Reads never come from the
browser directly: the bucket is private and served through `/cdn/<key>`, so there
is no GET rule. GCS CORS has no subdomain wildcards, so every origin is listed.

Apply (idempotent):

```bash
gcloud storage buckets update gs://three-ws-storage-fallback \
  --cors-file=deploy/storage-fallback/cors.json \
  --account nich@sperax.io --project aerial-vehicle-466722-p5
```

Check: `gcloud storage buckets describe gs://three-ws-storage-fallback --format="json(cors_config)"`.

## Who signs

The service-account key in `GCP_SERVICE_ACCOUNT_JSON` signs locally; without it
the runtime identity signs through IAM `signBlob` (the runtime service account
holds Token Creator on itself). Either identity needs `roles/storage.objectAdmin`
on the bucket, which both have.
