# Forge storage failover and the generation probe

Two things that exist because of the same incident: object storage was allowed to
be a single point of failure for the platform's flagship flow, and nothing we ran
proved otherwise until users said so.

## What happened

On 2026-09-07 the Cloudflare R2 credential stopped verifying. Every signed
operation began answering `SignatureDoesNotMatch`, and text to 3D returned a 502
to every caller on every surface. The message users saw was the storage vendor's
own sentence, verbatim: *"The request signature we calculated does not match the
signature you provided. Check your secret access key and signing method."*

Two things made it worse than it needed to be:

- **Image to 3D kept working the whole time.** It supplies its own reference view
  URLs and never touches the write path, so half the product looked healthy.
- **`/api/healthz` reported `forge_generation: unknown, 0 finished generations`.**
  The failure happens *before* a `forge_creations` row is written, so a total
  outage and a quiet afternoon produce the identical signal.

## Why one write could do that

Text to 3D synthesizes a reference view (FLUX, Vertex Imagen, or Gemini) and then
has to hand that image to a reconstructor. Reconstructors take a URL, not bytes,
so the image is parked in the bucket first
([api/_lib/image-persist.js](../../api/_lib/image-persist.js)). That one
`putObject` sat on the critical path of every text prompt with no failover of any
kind: if it threw, the generation was over before a GPU was ever asked for
anything.

## The failover

Our own GPU workers never needed the bucket. Every `workers/model-*` service
declares its input as `images: [data-uri|url, ...]` and base64-decodes an inline
payload directly (see `_decode_image` in
[workers/model-trellis/main.py](../../workers/model-trellis/main.py), and the
same contract in `model-hunyuan3d` and `model-triposg`).

So `persistImageBytes` no longer throws on a storage fault. It returns the view
inline as a `data:` URI, and the generation continues:

| Condition | Result |
|---|---|
| Bucket healthy | Durable `https://` URL, exactly as before |
| Storage infrastructure fault, payload under 4 MB | Inline `data:` URI, generation proceeds |
| Storage infrastructure fault, payload over 4 MB | Rethrows (never smuggle megabytes into a request body) |
| Any other error | Rethrows (a programming bug must not hide behind a fallback) |

"Storage infrastructure fault" is `isStorageInfrastructureError` in
[api/_lib/r2.js](../../api/_lib/r2.js): a rejected or revoked credential, a
missing bucket, an unreachable endpoint. Object-level faults are not included,
because those blame the object and the fallback would be wrong.

### Which lanes may receive an inline view

Only ours. `backendAcceptsInlineViews` in
[api/_lib/forge-tiers.js](../../api/_lib/forge-tiers.js) is true exactly for the
backends whose `provider` is `gcp` (`trellis_selfhost`, `hunyuan3d`, `triposg`),
and it is derived from the registry rather than a hand-written list, so a backend
added later is classified by what it is.

A third-party reconstructor (NVIDIA NIM, Hugging Face Spaces, Replicate, and the
BYOK vendors) fetches a URL it is given. Handing one a data URI would fail
opaquely, so [api/forge.js](../../api/forge.js) refuses it with a designed 503
that names the real cause and suggests the lanes that can still run:

```json
{
  "error": "storage_unavailable",
  "message": "Our image storage is not accepting writes right now, so this engine cannot be given the reference view. Try again on the free built-in engine, or retry shortly.",
  "retryable": true,
  "retry_backends": ["trellis_selfhost", "hunyuan3d"]
}
```

That path also closes the information leak: a caller is no longer told to check
our secret access key.

An inline view is a transport detail and never becomes an artifact. It is not
echoed as `preview_image_url` and not written to `forge_creations`, where a
multi-megabyte base64 string would bloat every poll payload and the row. The
field is `null` for that generation, which is the truth: nothing was parked. The
turnaround multi-view lane is skipped for the same reason (it edits an image it
fetches by URL), so those generations reconstruct from the single view.

**This is degradation, not a fix.** A generation that runs on the fallback has no
durable copy of its reference view, cannot use multi-view fusion, and cannot run
on a vendor lane. Restore the credential; the failover only buys the time to do
it without the product being down.

## Proving it, instead of assuming it

```bash
npm run probe:generation                       # every row against production
node scripts/probe-generation-suite.mjs --only text-to-3d,rig --verbose
node scripts/probe-generation-suite.mjs --base http://localhost:3000 --json out.json
```

[scripts/probe-generation-suite.mjs](../../scripts/probe-generation-suite.mjs)
submits real work to the real endpoints, polls to completion, downloads the
result and asserts the bytes are what they claim to be: glTF magic and a
non-empty primitive for a mesh, a PNG signature for a cutout, a parseable clip
for a motion. A `configured: true` in the catalog counts for nothing here, which
is the entire point, because that is what read green throughout the outage.

It exits non-zero when any selected row fails, so it works as a gate. Rows that
need a signed-in user (region retexture) read `AUDIT_EMAIL` / `AUDIT_PASSWORD`
from `.env`; without them that row reports the missing session rather than
passing quietly.

Paid rows are asserted at the challenge, never by paying: the x402 leg checks
that the 402 carries usable Solana accepts and that the generation surfaces are
listed in `/.well-known/x402.json`.

## Related

- Daily automated version of the same bar: [api/cron/forge-smoke.js](../../api/cron/forge-smoke.js), 09:30 UTC, alerts to ops Telegram.
- Which failure classes recur, from the outcome ledger: [forge-error-triage.md](./forge-error-triage.md).
- The credential's own health signal: [api/_lib/ops/object-storage-health.js](../../api/_lib/ops/object-storage-health.js).
- Worker URLs and env: [gcp-model-workers.md](./gcp-model-workers.md).
