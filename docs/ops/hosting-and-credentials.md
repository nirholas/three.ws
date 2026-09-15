# Hosting and credential operations

This is the operator record for three.ws hosting, repository integrations, and production
credentials. It exists to prevent three recurring failures: treating `vercel.json` as proof that
Vercel still hosts production, pasting a replacement credential into an issue or terminal command,
and updating one Cloud Run variable in a way that erases the rest.

## Hosting source of truth

Production runs on Google Cloud Run in project `aerial-vehicle-466722-p5`, primarily in
`us-central1`. The public site is served through the Google Cloud load balancer and CDN. Check the
deployed revision at `GET https://three.ws/api/version` and the subsystem roll-up at
`GET https://three.ws/api/healthz`.

`vercel.json` remains a live compatibility manifest. The Cloud Run Express server reads its route,
function, header, and cron declarations, and the scheduler tooling reads the same cron list. The
file name is historical; deleting or casually renaming it breaks production routing and schedule
drift checks. Its `git.deploymentEnabled: false` setting prevents Vercel Git deployments.

The `Vercel - three.ws` check on GitHub pull requests is separate. It is emitted by the installed
Vercel GitHub App even when deployments are disabled. Remove three.ws from that app at
`https://github.com/settings/installations` under **Vercel > Configure**, or uninstall the app if it
serves no repository. This is a GitHub account-administration action; repository push permission is
not enough.

## Authentication checks

These commands print identity and configuration, never credential values:

```sh
gh auth status
gcloud auth list --filter=status:ACTIVE --format='table(account,status)'
gcloud config get-value project
gcloud projects describe aerial-vehicle-466722-p5 --format='value(projectId)'
```

Use `gh auth login` for an interactive GitHub login. Do not put a personal access token in a command
argument, issue, pull request, chat, shell history, or repository file. The repository-administration
tasks in this runbook require an account with `admin` permission on `nirholas/three.ws`.

## Credential boundary

Production secrets belong in Google Secret Manager and reach Cloud Run through `valueFrom`
references. Non-secret configuration may remain a literal Cloud Run environment variable. Inspect
names and storage modes without reading values:

```sh
node scripts/read-service-env.mjs --names
gcloud secrets list --project aerial-vehicle-466722-p5 --format='value(name)'
```

Never use `--set-env-vars` or `--set-secrets` for a single change; both can replace the complete
configuration. Use `--update-env-vars` and `--update-secrets`.

### R2 mapping

The object-storage adapter uses S3-compatible names:

| Variable | Secret? | Production source |
|---|---|---|
| `S3_ENDPOINT` | No | Cloud Run literal |
| `S3_BUCKET` | No | Cloud Run literal |
| `S3_PUBLIC_DOMAIN` | No | Cloud Run literal |
| `S3_ACCESS_KEY_ID` | Yes | Secret Manager |
| `S3_SECRET_ACCESS_KEY` | Yes | Secret Manager |

The long-lived R2 credential needs object read/write access only to the production bucket. Do not
grant account administration or cross-bucket access to the application credential.

### Safe R2 rotation

Create the replacement in the provider console, then transfer each value from a private local file
or standard input. Never paste it into the command itself. The examples below assume files outside
the repository with mode `0600`:

```sh
gcloud secrets describe s3-access-key-id --project aerial-vehicle-466722-p5 >/dev/null 2>&1 || \
  gcloud secrets create s3-access-key-id --project aerial-vehicle-466722-p5 --replication-policy=automatic
gcloud secrets describe s3-secret-access-key --project aerial-vehicle-466722-p5 >/dev/null 2>&1 || \
  gcloud secrets create s3-secret-access-key --project aerial-vehicle-466722-p5 --replication-policy=automatic

gcloud secrets versions add s3-access-key-id \
  --project aerial-vehicle-466722-p5 --data-file=/private/path/r2-access-key-id
gcloud secrets versions add s3-secret-access-key \
  --project aerial-vehicle-466722-p5 --data-file=/private/path/r2-secret-access-key

gcloud run services update three-ws-api \
  --project aerial-vehicle-466722-p5 \
  --region us-central1 \
  --update-secrets S3_ACCESS_KEY_ID=s3-access-key-id:latest,S3_SECRET_ACCESS_KEY=s3-secret-access-key:latest
```

Wait for the revision to become Ready, then verify the storage credential without uploading user
data:

```sh
curl -fsS -X POST https://three.ws/api/forge-upload \
  -H 'content-type: application/json' \
  -H 'x-forge-client: ops-storage-check' \
  --data '{"content_type":"image/png","size_bytes":1024}'
```

A healthy response is `200` with `method: "PUT"` and `expires_in`; do not print or share the signed
`upload_url`. `503 storage_unavailable` means the bucket rejected the credential. Revert Cloud Run
to the previous secret version before investigating scope, bucket, endpoint, or signature mismatch.
Only revoke the old provider credential after the production check passes.

## Exposed-credential incident

A credential pasted into chat, an issue, a pull request, a terminal command, or a committed file is
compromised even if the message is later deleted. The response is rotation, not concealment:

1. Revoke the exposed credential at the provider.
2. Create a least-privilege replacement through the provider's secure console.
3. Add a new Secret Manager version without printing the value.
4. update the Cloud Run secret reference and wait for a Ready revision;
5. verify the exact dependent feature;
6. revoke the prior production credential after verification;
7. review provider audit logs for use after the exposure time;
8. record names, timestamps, scope, and verification outcome, never values.

For GitHub, revoke both classic and fine-grained personal access tokens from account settings. For
Cloudflare, revoke the API token and the R2 S3 credential separately. For npm, revoke the automation
token, create a scoped replacement with the narrowest required package permissions, and review the
account's token activity.

The pre-push guard at `scripts/check-secrets.mjs` rejects provider token formats and R2 credential
pairs in added content. The runtime `redactUrlSecrets` guard also masks those formats when they
arrive inside free-form text destined for structured logs. Both are defense in depth, not a
substitute for rotation after disclosure.

## Production verification after any credential change

Run the narrow feature check first, then the platform sweep:

```sh
curl -fsS https://three.ws/api/version
curl -fsS https://three.ws/api/healthz
npm run triage:gcp -- --json --deep --since 1h
```

Interpret a mass page failure alongside reachability. If `/api/version`, `/api/healthz`, and the home
page all answer immediately while a single deep sweep reports every page failed, repeat the pages
probe before changing routes; a shared probe timeout is not hundreds of independent routing bugs.

## Current incident record: 2026-09-15

- GCP authentication succeeded for `aerial-vehicle-466722-p5`.
- All 47 Cloud Run services reported Ready.
- All 117 declared cron jobs matched Cloud Scheduler and loaded successfully.
- The public health, version, and home endpoints returned `200` on independent probes.
- The deep sweep's 822 page failures, version timeout, and TLS timeout shared one transient probe
  window and were not reproduced independently.
- During revision `three-ws-api-00430-bbn` rollout, `POST /api/forge-upload` returned
  `503 storage_unavailable`. After the revision became Ready, the same storage preflight returned
  `200` with a presigned `PUT` URL. No object or user data was uploaded. Treat the replacement R2
  credential as operational, and revoke every credential exposed during the incident.
- The x402 self-facilitator reported 2,011 `payer_fee_unfunded` verification rejects and 139
  `fee_wallet_below_floor` settlement failures. Funding or moving on-chain value remains an
  owner-confirmed action under the transaction confirmation policy.
- GitHub pull requests still receive the obsolete Vercel App status. It did not prevent the approved
  marketing pull request from merging, but the app should be removed to eliminate the false failure.

No credential value belongs in this record.
