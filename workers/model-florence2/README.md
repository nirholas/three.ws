# model-florence2

Florence-2 describe service. It reads the poster image of a three.ws creation and returns a short caption, a detailed caption, normalized tags and object boxes. The platform uses them for model search, page meta descriptions, image alt text and the tag chips on `/m/<id>`.

- **Model:** `florence-community/Florence-2-large-ft` (MIT), pinned to revision `26b734a54fdfbf9c398351eedfabb7f27fc470b7` and baked into the image. It runs on the native `transformers` Florence-2 classes, so no `trust_remote_code`.
- **Hardware:** one NVIDIA L4 on Cloud Run (`us-central1`), scale to zero.
- **Auth:** shared worker bearer secret `avatar-reconstruction-key` (`GCP_RECONSTRUCTION_KEY` on the API side), checked by the vendored `worker_security.py`.

Pipeline, ledger, cron and backfill docs: [`docs/creation-descriptions.md`](../../docs/creation-descriptions.md).

## API

```
POST /describe   Authorization: Bearer <key>
  { "image_url": "https://..." }          or  { "image": "<data uri | base64>" }
-> 200 {
     "caption": "A brown and white cat sitting on top of a wooden table.",
     "detailed": "...",
     "tags": ["cat", "table", ...],
     "objects": [{ "label": "cat", "box": [x0, y0, x1, y1] }, ...],
     "model": "florence-community/Florence-2-large-ft",
     "model_version": "26b734a54fdfbf9c398351eedfabb7f27fc470b7",
     "device": "cuda",
     "latency_ms": 1468
   }
   400 when the image is missing, unreachable, unsafe (SSRF guard) or not PNG/JPEG/WEBP.

GET /health -> { ok, loaded, device, model }
```

The call is synchronous. One describe takes about 1.5 s on an L4, so there is no task queue to poll.

Three Florence-2 task prompts run per image: `<CAPTION>`, `<MORE_DETAILED_CAPTION>` and `<OD>`. Tags are the object-detection labels, then the nouns spaCy finds in the short caption, then the detailed-caption nouns ranked by frequency, all passed through `tags.py`. Those are the same rules as `api/_lib/creation-tags.js`, and `test_tags.py` keeps the two in step.

## Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI service (`/describe`, `/health`), background weight load so the startup probe can tell loading from dead. |
| `describe.py` | Model load and the three task prompts. |
| `fetch.py` | Poster fetch through the SSRF guard. A 429 from the renderer is waited out (Retry-After, else backoff, capped at 30 s, 4 attempts); every other error fails at once. |
| `tags.py` | Tag normalization (lowercase, singular, stop words, colours, body parts, picture words, number words). |
| `batch.py` | Cloud Run **job** entry point: `python batch.py gs://.../in.json gs://.../out.json`. Resumable (checkpoints every 25 items and skips ids already in out.json). It never touches the database; the API side imports the results. |
| `smoke_test.py` | Build gate: the baked weights describe a drawn scene offline and every output field is populated. |
| `test_tags.py` | Unit tests for `tags.py` (`python3 test_tags.py`). |
| `test_fetch.py` | Unit tests for the 429 retry (`python3 test_fetch.py`). Both test files run as a build gate in the Dockerfile. |
| `worker_security.py` | Vendored, byte-identical across workers (`npm run check:vendored`). |
| `cloudbuild.yaml` | Build, push and deploy the service. |
| `cloudbuild.image.yaml` | Build and push the image only (used by the batch job). |

## Deploy

```bash
gcloud builds submit --config workers/model-florence2/cloudbuild.yaml \
  --substitutions SHORT_SHA=$(git rev-parse --short HEAD) workers/model-florence2
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_FLORENCE2_URL=<service url>
```

Until `MODEL_FLORENCE2_URL` is set, the `/api/cron/creation-describe` cron answers `worker_unconfigured` and does nothing. Creations still enqueue, so nothing is lost.

## Batch job (backfill on GPU)

Cloud Run job `florence2-describe`: the same image, L4, 4 vCPU, 16 GiB, task timeout 3600 s, no retries.

```bash
node scripts/creation-descriptions-backfill.mjs --export 1600 --out gs://three-ws-avatar-reconstructions/florence2/runN/in.json
gcloud run jobs execute florence2-describe --region us-central1 \
  --args=batch.py,gs://three-ws-avatar-reconstructions/florence2/runN/in.json,gs://three-ws-avatar-reconstructions/florence2/runN/out.json
node scripts/creation-descriptions-backfill.mjs --import gs://three-ws-avatar-reconstructions/florence2/runN/out.json
```

## Measured (2026-11-11, 300 newest real posters, one L4)

- 300 described, 0 failed.
- Latency per image: p50 1,468 ms, mean 1,516 ms, max 7,615 ms.
- Weight load 24 s. Container start about 4 min on a cold image pull.
- Cost: about $0.00029/s billed (L4 plus 4 vCPU plus 16 GiB), about 1.97 s billed per image, so **about $0.57 per 1,000 images**.
