# GitHub issue resolution record: 2026-09-15

This record captures the repository and production audit requested against the
open [three.ws issue tracker](https://github.com/nirholas/three.ws/issues).
Credentials and secret values are intentionally never recorded in source,
logs, issue comments, or build artifacts.

## Completed

- Issues [#110](https://github.com/nirholas/three.ws/issues/110),
  [#111](https://github.com/nirholas/three.ws/issues/111), and
  [#115](https://github.com/nirholas/three.ws/issues/115) were resolved by the
  universal rig-convention work merged in PR #212.
- The contributor thank-you page and README/community credits were merged in
  [PR #219](https://github.com/nirholas/three.ws/pull/219). The page combines
  the live GitHub contributor list with explicit credit for high-impact issue
  reports, including Victoria Ali's object-storage report in #164.
- Issue [#113](https://github.com/nirholas/three.ws/issues/113) is resolved by
  a dedicated bow clip generated from committed project-authored keyframes.
  It is reproducible through `npm run build:animations`, has 53 canonical
  tracks, is torso-led and anchored according to `signatures.json`, and was
  visually checked from front and side on the CZ reference avatar.

## Production resolution: issue #164

Issue [#164](https://github.com/nirholas/three.ws/issues/164) was closed after
the production credential was rotated on 2026-09-15. The replacement secret
was added as a new `s3-secret-access-key` Secret Manager version; the matching
access-key ID was updated with Cloud Run's merge-only `--update-env-vars`
semantics. No credential value was written to the repository, issue tracker, or
deployment output.

The resulting `three-ws-api` revision reached Ready and served 100% of traffic.
`/api/healthz` then reported `object_storage: ok` with a successful signed read.
A non-uploading `POST /api/forge-upload` probe reached normal content-type
validation (`400 invalid_content_type`) rather than the former storage guard
(`503 storage_unavailable`). This proves credential signing and application
wiring recovered; a real browser upload remains the recommended end-to-end CORS
check.

Future rotations must use a newly issued Cloudflare R2 Secret Access Key. Store
it without a trailing newline and never place it directly on a shell command
line:

```bash
gcloud secrets versions add s3-secret-access-key \
  --project aerial-vehicle-466722-p5 \
  --data-file=-

gcloud run services update three-ws-api \
  --project aerial-vehicle-466722-p5 \
  --region us-central1 \
  --update-secrets S3_SECRET_ACCESS_KEY=s3-secret-access-key:latest
```

Verify the new revision before closing a future storage incident:

```bash
curl -s https://three.ws/api/healthz \
  | jq '.subsystems.subsystems[] | select(.name=="object_storage")'
```

Then complete one real Forge photo upload. A healthy signed-read probe alone
does not prove browser CORS behavior end to end.

## Verification performed

- Dedicated bow generator reproduced its committed artifact byte-for-byte.
- Front/side filmstrip: 100% canonical-track coverage, grounded 1.8-second bow.
- Animation manifest, registry, and measured motion signatures rebuilt.
- Focused slot, registry, playback, and motion audits run before commit.
- Production deep sweep run against Google Cloud Run; transient rollout probe
  timeouts were rechecked against the ready revision and `/api/version` and
  `/api/healthz` both responded afterward.
