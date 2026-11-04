# Avatar Regeneration API

Endpoints for avatar re-mesh, re-texture, re-rig, restyle and reconstruct (image to avatar) jobs. Several ML backends sit behind one submit/status interface, with automatic failover between the platform providers. Source: [`_actions.js`](./_actions.js) (handlers), [`api/_lib/regen-provider.js`](../_lib/regen-provider.js) (provider loader), [`api/_providers/`](../_providers/) (adapters).

## Endpoints

### `POST /api/avatars/regenerate`

Initiate an avatar regeneration job.

**Authentication:** Session cookie or `avatars:write` bearer token required.

**Request body:**

```json
{
	"sourceAvatarId": "avatar-uuid",
	"mode": "remesh|retex|rerig|restyle|reconstruct",
	"params": {
		"custom": "values"
	}
}
```

**Mode definitions:**

- `remesh`: regenerate mesh topology from source material or reference
- `retex`: regenerate textures and materials
- `rerig`: regenerate skeleton/rig bindings
- `restyle`: regenerate styling/appearance from description
- `reconstruct`: build a new avatar from images (the selfie lane; normally called through `POST /api/avatars/reconstruct`)

**Success response (202):**

```json
{
	"ok": true,
	"jobId": "string",
	"status": "queued",
	"eta": null,
	"provider": "replicate"
}
```

**Error responses:**

- **401 unauthorized**, no session and no valid bearer token with the `avatars:write` scope
- **404 not_found**, source avatar not found or not owned
- **429 rate_limited**, the caller exceeded the upload rate limit
- **501 regen_unconfigured**, no platform provider has credentials on this deployment
    ```json
    {
    	"error": "regen_unconfigured",
    	"error_description": "Avatar regeneration is not available on this deployment yet."
    }
    ```
    The same code (with the copy "The 3D engine is not available for this request right now.") is returned when the chosen provider does not support the requested `mode`.
- **402 insufficient_credits**, **400 invalid_request**, **429 rate_limited**, **502 regen_provider_error**, a provider rejected or failed the submit after every configured provider was tried. The message is vendor-free; the raw detail stays in server logs.

`jobId` is `<provider>-<uuid>`; `eta` is seconds when the provider reports one, otherwise `null`.

`POST /api/avatars/reconstruct` (the selfie and text→avatar lane) additionally
pre-flights the caller's plan quota before it spends any GPU time, and answers a
full library with:

- **402 plan_limit**, the avatar count or storage ceiling for the plan is
  already reached, so the job would have nowhere to land
    ```json
    {
    	"error": "plan_limit",
    	"error_description": "Your avatar library is full on this plan. Delete an avatar or upgrade to build another."
    }
    ```

### `GET /api/avatars/regenerate-status?jobId=<id>`

Poll the status of a regeneration job.

**Authentication:** Session cookie or `avatars:read` bearer token required.

**Query parameters:**

- `jobId` (required): job ID from regenerate endpoint

**Success response (200):**

```json
{
	"ok": true,
	"jobId": "string",
	"status": "queued|running|rigging|done|failed",
	"resultAvatarId": "avatar-uuid",
	"resultGlbUrl": "https://…/model.glb",
	"error": "optional error message",
	"errorKind": "input",
	"provider": "replicate"
}
```

**Status values:**

- `queued`: job waiting for processing
- `running`: actively processing
- `rigging`, the mesh landed bare and a child auto-rig job is running
- `done`: completed successfully
- `failed`: failed (check `error` field)

**`error` and `errorKind`:**

`error` is never the raw provider or job string: that can name a vendor, a task
id, or an upstream status, so it is collapsed into neutral copy before it leaves
the API. Two cases are relayed verbatim instead, and both are marked
`errorKind: "input"`:

- a worker rejection the worker itself classified as caller-facing ("no face
  detected in any of the provided photos");
- a plan-quota refusal at materialization, telling the caller to delete an avatar
  or upgrade.

`errorKind` is absent on every other error. Clients should print an
`errorKind: "input"` message as-is and only apply their own friendlier wording
when it is absent, the `/create/selfie` poll loop does exactly this
([`src/selfie-pipeline.js`](../../src/selfie-pipeline.js)), because rewriting an
exact reason with a keyword guess sends the user off to retake a photo that was
never the problem.

## Providers

Platform providers are loaded by `api/_lib/regen-provider.js`. A provider is used only when its credentials are present, and `POST /api/avatars/regenerate` tries them in order, retrying transient faults, until one accepts the job. The explicit `AVATAR_REGEN_PROVIDER` (if credentialed) leads; the rest follow in the fixed order below.

| Order | Provider | Credentials | Modes | Adapter |
| ----- | -------- | ----------- | ----- | ------- |
| 1 | `replicate` | `REPLICATE_API_TOKEN` | a mode is supported when its model resolves (`REPLICATE_<MODE>_MODEL`, built-in default for `reconstruct`) | `api/_providers/replicate.js` |
| 2 | `gcp` | `GCP_RECONSTRUCTION_URL` and `GCP_RECONSTRUCTION_KEY` | a mode is supported when its worker URL is set (`GCP_*_URL`, for example `GCP_UNIRIG_URL` for `rerig`) | `api/_providers/gcp.js` |
| 3 | `huggingface` (alias `hf`) | `HF_TOKEN` | per the adapter | `api/_providers/huggingface.js` |
| 4 | `tripo` (house key) | `TRIPO_API_KEY` | `rerig` lane for auto-rig, never inferred as the primary | `createTripoRegenAdapter` in `regen-provider.js` |

Bring-your-own-key providers are request-scoped and are not in the failover chain. `meshy` (`reconstruct` only) and `tripo` (`reconstruct` and `rerig`) are listed in `BYOK_REGEN_PROVIDERS`; the caller's stored key is resolved with `resolveProviderKey` at submit and again at every status poll, and is never written to the job row. `POST /api/avatars/reconstruct` falls back to the stored BYOK key when no platform provider is configured.

### Adapter contract

Each adapter returns an object with these members (see `createRegenProvider` in `api/_providers/replicate.js` for the reference implementation):

- `supportsMode(mode)`: boolean, true when the adapter can run `mode`.
- `supportsMultiview()`: boolean, true when more than one reference image can be fused into one mesh.
- `submit(request)`: `request` is `{ userId, sourceAvatarId, mode, params, sourceUrl, sourceStorageKey }`. Resolves to `{ extJobId, eta?, backend }`. Failures throw an `Error` carrying a stable `code` and `status` (for example `mode_unconfigured` 501, `invalid_key` 401, `insufficient_credits` 402, `rate_limited` 429), which `classifyProviderError` maps to the masked envelopes above.
- `status(extJobId)`: resolves to `{ status, resultGlbUrl?, error? }` with `status` one of `queued`, `running`, `done`, `failed` (the GCP adapter may also return `resultImageUrl`). A missing id returns `{ status: 'failed', error: 'missing ext_job_id' }`.

The status endpoint polls the adapter recorded on the job row (`provider`), not whichever provider currently leads the chain, then downloads the finished GLB, stores it, registers the avatar and sets `result_avatar_id`. Result URLs are checked with `isAllowedProviderResultUrl` before they are fetched.

## Environment

Use `.env.local` for local development. In production the variables live on the
Cloud Run service `three-ws-api`. The provider is **auto-detected from present
credentials** (priority: paid, then free). Set `AVATAR_REGEN_PROVIDER` explicitly
to lead the failover order.

```
# Explicit override (optional). Auto-detected order is replicate, gcp, huggingface, tripo.
AVATAR_REGEN_PROVIDER=replicate

# --- Replicate (paid, $0.035/run TRELLIS default) ---
REPLICATE_API_TOKEN=r8_...
# Optional: defaults to firtoz/trellis (MIT TRELLIS). Pin a version with owner/name:hash
REPLICATE_RECONSTRUCT_MODEL=firtoz/trellis
# Optional: if APP_ORIGIN is set this is derived. Replicate POSTs done predictions here.
REPLICATE_WEBHOOK_URL=https://three.ws/api/webhooks/replicate
# REQUIRED if you create the webhook in Replicate dashboard (gives you whsec_…)
REPLICATE_WEBHOOK_SIGNING_KEY=whsec_…

# --- GCP Cloud Run (self-hosted InstantMesh, see workers/avatar-reconstruction/) ---
GCP_RECONSTRUCTION_URL=https://avatar-reconstruction-…run.app
GCP_RECONSTRUCTION_KEY=…

# --- Tripo house key (rerig auto-rig lane only) ---
TRIPO_API_KEY=…

# --- HuggingFace (free, Space queue, variable wait) ---
HF_TOKEN=hf_…
# Comma-separated failover chain. Format: "owner/name[:api_name]". First success wins.
# Default chain (when unset): tencent/Hunyuan3D-2.1, tencent/Hunyuan3D-2,
# JeffreyXiang/TRELLIS, stabilityai/TripoSR.
HF_RECONSTRUCT_SPACES=tencent/Hunyuan3D-2.1,JeffreyXiang/TRELLIS:image_to_3d
```

To set a single key on production, update only that key. Never use `--set-env-vars`, which replaces the whole set:

```
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars AVATAR_REGEN_PROVIDER=replicate
```

## Webhooks (Replicate only, optional but recommended)

When `REPLICATE_WEBHOOK_URL` is configured, every prediction submission asks
Replicate to POST `/api/webhooks/replicate` when the prediction completes.
That handler verifies the `webhook-signature` (Standard Webhooks spec), updates
the `avatar_regen_jobs` row, and, for `reconstruct` jobs, materializes the
avatar inline. The client's status poll then sees `done` + `resultAvatarId`
on its very next hit without any Replicate API call.

The poll path still works as a fallback: if a webhook is dropped/blocked,
the next `regenerate-status` call triggers a manual provider.status() poll
that reconciles the row.

To create the webhook + grab the signing secret:

1. Set `REPLICATE_WEBHOOK_URL=https://three.ws/api/webhooks/replicate` with `gcloud run services update three-ws-api --region us-central1 --update-env-vars REPLICATE_WEBHOOK_URL=...`.
2. Replicate dashboard → Webhooks → Add → URL = same → Save.
3. Copy the `whsec_…` secret → set as `REPLICATE_WEBHOOK_SIGNING_KEY` the same way.
4. The service rolls a new revision automatically when env vars change.

## Database schema

Jobs live in `avatar_regen_jobs`, created by `api/_lib/migrations/20260517000000_avatar_regen_jobs.sql`:

```sql
CREATE TABLE IF NOT EXISTS avatar_regen_jobs (
	job_id            text PRIMARY KEY,
	user_id           uuid NOT NULL,
	source_avatar_id  uuid NOT NULL,   -- nullable since 2026-05-17-avatar-reconstruct.sql
	mode              text NOT NULL,
	params            jsonb,
	status            text NOT NULL,
	provider          text,            -- replicate | gcp | huggingface | meshy | tripo
	ext_job_id        text,            -- provider-side job id
	result_glb_url    text,            -- temporary URL returned by provider
	result_avatar_id  uuid,            -- our avatar id after import
	error             text,
	created_at        timestamptz NOT NULL DEFAULT now(),
	updated_at        timestamptz NOT NULL DEFAULT now()
);
```

Indexes: `(user_id, created_at DESC)` and a partial index on `status` for `queued` and `running`. Later migrations add `error_kind` (`input` or `internal`, see `20260811130000_reconstruct_forge_registration.sql`) and drop the `NOT NULL` on `source_avatar_id`, because a `reconstruct` job starts from photos and has no source avatar.

Retention: `api/cron/db-retention.js` deletes `done` and `failed` jobs older than 30 days and, after one day, strips the multi-megabyte base64 `images` and `image` keys out of the `params` of terminal jobs. In-flight jobs are advanced by `api/cron/reconstruct-sweep.js` and the Replicate webhook (`api/webhooks/replicate.js`).
