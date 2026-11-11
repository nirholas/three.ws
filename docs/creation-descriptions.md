# Creation descriptions (Florence-2 captions, tags and alt text)

Every finished 3D creation on three.ws gets a short caption, a detailed caption, tags and object boxes, read from its poster image by Florence-2 (`florence-community/Florence-2-large-ft`, MIT) running on our own Cloud Run GPU. The platform uses them in four places:

1. **Search.** `/search?type=model` and `GET /api/search` match a model on its prompt, its captions and its tags. A tag hit ranks first, so a model whose prompt says only `image-to-3d` is still findable as "bicycle wheel".
2. **Page meta.** `/m/<id>` uses the detailed caption for `<meta name="description">`, `og:description` and `twitter:description`. When the creation is not described yet, it falls back to the prompt.
3. **Alt text.** The same detailed caption becomes the `alt` on the 3D viewer and `og:image:alt` / `twitter:image:alt`, again falling back to the prompt.
4. **Tag chips.** The model page lists the tags as chips that link to `/search?q=<tag>&type=model`, with an "Auto-described by Florence-2" credit. The creator can add, remove or clear tags.

The worker itself is documented in [`workers/model-florence2/README.md`](../workers/model-florence2/README.md).

## Data: `forge_creation_descriptions`

Migration `api/_lib/migrations/20261111161856_forge_creation_descriptions.sql`. There is one row per creation, and the row doubles as the describe queue.

| Column | Meaning |
|--------|---------|
| `status` | `queued`, `done`, `failed` (after 3 attempts) or `skipped` (no poster to read). |
| `caption`, `detailed` | Short and detailed captions. |
| `tags` | The live tag set: what search and the page use. |
| `generated_tags` | Exactly what the model produced, kept so an owner edit never loses the original. |
| `tags_edited_at` | Set once the owner edits. A re-describe or a re-normalize then leaves `tags` alone. |
| `objects` | Detected objects `[{label, box}]`. |
| `source_image_url` | The poster that was described. |
| `model`, `model_version` | Model id and the exact weights revision. |
| `attempts`, `updated_at` | The claim lease (see below). |

Private creations are described like any other, but their description is only ever shown through the same visibility rules as the creation itself. Search covers public creations only.

## Pipeline

All logic lives in `api/_lib/creation-descriptions.js`.

- **On create.** `materializeCreation` (`api/_lib/forge-store.js`) calls `enqueueCreationDescription` fire-and-forget. A describe never blocks or fails a creation, and a missing row only means "not described yet".
- **Cron.** `GET /api/cron/creation-describe` runs every 10 minutes (`vercel.json` crons, synced to Cloud Scheduler). Each tick claims up to 48 rows (`CREATION_DESCRIBE_BATCH`), describes them through the worker 4 at a time (`CREATION_DESCRIBE_CONCURRENCY`), and stops at a 90 s deadline. `?dry_run=1` returns coverage only. Without `MODEL_FLORENCE2_URL` and the worker key, it answers `worker_unconfigured` and does nothing.
- **Claim lease.** `claimDescribeBatch` increments `attempts` and stamps `updated_at`, and a claimed row is re-claimable only after 10 minutes, so overlapping ticks never describe the same row. When the queue holds fewer rows than the batch wants, the newest finished creations with no row yet are inserted already leased. The cron, the bulk script and the GPU export therefore all walk the backlog newest-first through one ledger. If the poster URLs cannot be resolved at all (object storage not configured in that process), the claim gives every lease back before rethrowing (`tests/creation-describe-claim.test.js`).
- **Store.** `storeDescription` sanitizes the result (caption 200 chars, detailed 1,000, 24 objects, hate-slur filter), normalizes tags and stamps model plus version.

## Tags

`api/_lib/creation-tags.js` (JS) and `workers/model-florence2/tags.py` (Python) apply the same rules:

- lowercase, singular (with a repair map for plural-only nouns such as sunglasses, scissors and jeans);
- at most 12 tags, 3 words and 32 characters each;
- dropped: stop words, bare colours, body parts, picture words (`image`, `photo`, `render`, and phrases ending in one), text words (`watermark`, `logo`, `text`, ...), number words and purely numeric strings.

Search expands a query to its singular and plural (`tagQueryVariants`), so "lanterns" finds a creation tagged "lantern". When the rules change, re-apply them to stored rows with `--renormalize` (below). It costs no GPU time.

### Owner edits

```
PATCH /api/forge-creation?id=<uuid>   { "tags": ["lantern", "camping"] }
-> 200 { tags, generatedTags }
```

Only the creator gets a 200; anyone else gets a 404. `[]` clears the tags. Tags pass through the same normalization. `GET /api/forge-creation` answers `can_edit_tags` so the page shows the editor only to the owner. The described block on that GET carries `caption`, `detailed`, `tags`, `model` and `model_version`.

## Backfill

`scripts/creation-descriptions-backfill.mjs` shares the claim ledger with the cron. It never redescribes a done row and it resumes where the last run stopped.

| Mode | What it does |
|------|--------------|
| `--dry-run` | Coverage only: total, described, queued, failed, skipped, remaining. |
| `--worker <url> [--limit 500] [--concurrency 2] [--per-minute 120]` | Describe through a running service, rate limited, with progress per batch. |
| `--export <n> --out gs://.../in.json` | Lease the next n creations (newest first) for the GPU batch job. |
| `--import gs://.../out.json` | Store the job's results; failed items go back to the queue. |
| `--renormalize [--dry-run]` | Re-apply the current tag rules to stored rows, except owner-edited tag lists. |

Bulk runs use the Cloud Run job `florence2-describe` (the worker image running `batch.py`). The README for the worker has the exact commands. Env: `DATABASE_URL`, the `S3_*` storage env (poster URL resolution), and `GCP_RECONSTRUCTION_KEY` for `--worker`.

## Cost and latency

Measured on 2026-11-11 over the 300 newest real posters on one L4:

- p50 1,468 ms, mean 1,516 ms, max 7,615 ms;
- 300 described, 0 failed;
- about **$0.57 per 1,000 images**, so the full backlog of about 54,000 finished creations costs about $31 on GCP credits.

## Env

| Var | Where | Notes |
|-----|-------|-------|
| `MODEL_FLORENCE2_URL` | `three-ws-api` | Cloud Run URL of `model-florence2`. Unset means the cron is a no-op. |
| `GCP_RECONSTRUCTION_KEY` | `three-ws-api` | Shared worker bearer (`avatar-reconstruction-key`). |
| `API_KEY` | `model-florence2` | The same secret, mounted from Secret Manager. |

## Tests

- `tests/creation-tags.test.js`: tag normalization and query variants.
- `tests/creation-search.test.js`: search over caption and tags.
- `tests/creation-describe-meta.test.js`: the meta and alt fallback to the prompt.
- `tests/forge-creation-tags.test.js`: the owner tag PATCH.
- `tests/creation-describe-claim.test.js`: lease release on a storage error.
- `workers/model-florence2/test_tags.py`: the Python tag rules.
