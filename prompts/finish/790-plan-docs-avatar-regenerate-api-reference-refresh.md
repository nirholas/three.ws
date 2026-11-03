# Rewrite api/avatars/REGENERATE.md to describe the shipped regeneration pipeline, not a stub provider

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/790-plan-docs-avatar-regenerate-api-reference-refresh.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 12 of 100 inside the tier). **Area:** docs. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`api/avatars/REGENERATE.md` is the only reference for `POST /api/avatars/regenerate`, `GET /api/avatars/regenerate-status` and `POST /api/avatars/reconstruct`, and parts of it describe a design that was never the final one. It tells integrators the endpoint answers `501` with "not yet wired to an ML backend", shows a `stub` provider that returns a fake `ext-<timestamp>` job id and a fake `https://...` GLB, labels the `avatar_regen_jobs` table a "future migration" with an old column set, lists "Candidate providers" as research-stage, and tells readers to set env vars "in Vercel", which the owner retired (production is Cloud Run). A reader following it builds the wrong provider.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Shipped: `api/_lib/regen-provider.js` (loader, replicate/huggingface/gcp platform providers, BYOK `meshy` and `tripo` in `BYOK_REGEN_PROVIDERS`, failover chain), `api/avatars/_actions.js` (the `501 regen_unconfigured` code is only returned when no provider resolves, with different copy), `api/webhooks/replicate.js`, `api/cron/reconstruct-sweep.js`, `api/_lib/reconstruct-finalize.js`, routes in `vercel.json` mapping to `api/avatars/[id].js`.
- The table is real: `api/_lib/migrations/20260517000000_avatar_regen_jobs.sql` has `provider`, `ext_job_id`, `result_glb_url` columns the doc omits, and `api/cron/db-retention.js` strips and prunes terminal jobs.
- The doc's own status, `errorKind` and plan-limit sections are current and should be kept.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -n "501\|stub\|future migration\|Vercel\|Candidate providers" api/avatars/REGENERATE.md
sed -n 1,40p api/_lib/regen-provider.js
grep -n "regen_unconfigured" -B3 -A3 api/avatars/_actions.js | head -40
cat api/_lib/migrations/20260517000000_avatar_regen_jobs.sql | head -30
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Replace the 501 example with the real response from `api/avatars/_actions.js` (read the exact code and copy).
2. Replace the "Provider Plug Shape" stub example with the real `submit` / `status` contract the loader expects (read `api/_providers/*.js` and `regen-provider.js` for the actual signatures; no fake return values).
3. Delete "Candidate providers"; replace it with a table of the providers that actually exist, their credentials and the failover order, plus the BYOK Meshy/Tripo path.
4. Replace "Database schema (future migration)" with the real table definition from the migration and a pointer to the retention behavior in `api/cron/db-retention.js`.
5. Replace "Vercel" env guidance with the Cloud Run commands (`gcloud run services update three-ws-api --region us-central1 --update-env-vars ...`, never `--set-env-vars`).
6. Run `npm run audit:docs` and add a `data/changelog.json` entry only if the project's rules for doc-only changes require one (check the `changelog-and-docs` skill).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -nE "stub|future migration|Candidate providers|Vercel|not yet wired" api/avatars/REGENERATE.md` returns nothing.
- [ ] Every status code and JSON shape in the doc matches `api/avatars/_actions.js` (spot-check each by grep).
- [ ] `npm run audit:docs` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Unsure which providers are live in production | Read env var names from the Cloud Run service (`gcloud run services describe three-ws-api --region us-central1 --format=json`, names only) and document by capability, not by secret. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/790-plan-docs-avatar-regenerate-api-reference-refresh.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `790-plan-docs-avatar-regenerate-api-reference-refresh.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `api/avatars/REGENERATE.md` (whole file)

~~~~markdown
# Avatar Regeneration API

Pluggable endpoint for avatar re-mesh, re-texture, re-rig, and restyle operations. Designed to support multiple ML backends with a consistent interface.

## Endpoints

### `POST /api/avatars/regenerate`

Initiate an avatar regeneration job.

**Authentication:** Session cookie or `avatars:write` bearer token required.

**Request body:**

```json
{
	"sourceAvatarId": "avatar-uuid",
	"mode": "remesh|retex|rerig|restyle",
	"params": {
		"custom": "values"
	}
}
```

**Mode definitions:**

- `remesh` - regenerate mesh topology from source material or reference
- `retex` - regenerate textures and materials
- `rerig` - regenerate skeleton/rig bindings
- `restyle` - regenerate styling/appearance from description

**Success response (202):**

```json
{
	"ok": true,
	"jobId": "string",
	"status": "queued",
	"eta": null
}
```

**Error responses:**

- **404 not_found** - source avatar not found or not owned
- **501 regen_unconfigured** - `AVATAR_REGEN_PROVIDER` env var not set
    ```json
    {
    	"error": "regen_unconfigured",
    	"error_description": "Avatar regeneration is not yet wired to an ML backend. Set AVATAR_REGEN_PROVIDER env var."
    }
    ```
- **429 rate_limited** - user has exceeded upload quota

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

- `jobId` (required) - job ID from regenerate endpoint

**Success response (200):**

```json
{
	"ok": true,
	"jobId": "string",
	"status": "queued|running|rigging|done|failed",
	"resultAvatarId": "avatar-uuid",
	"resultGlbUrl": "https://…/model.glb",
	"error": "optional error message",
	"errorKind": "input"
}
```

**Status values:**

- `queued` - job waiting for processing
- `running` - actively processing
- `rigging`, the mesh landed bare and a child auto-rig job is running
- `done` - completed successfully
- `failed` - failed (check `error` field)

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

## Provider Plug Shape

Providers are swapped via the `AVATAR_REGEN_PROVIDER` env var (e.g., `meshy`, `csm`, `rodin`, `tripor`, `stub`).

### Provider function signature

```typescript
// Each provider exports an async factory function
export async function createRegenProvider(config) {
	return {
		// Accept regeneration request, return job handle
		submit: async (request) => {
			// request shape:
			// {
			//   userId: string,
			//   sourceAvatarId: string,
			//   mode: 'remesh' | 'retex' | 'rerig' | 'restyle',
			//   params: Record<string, unknown>,
			//   sourceStorageKey: string,  // R2 path to source GLB
			// }

			// return shape:
			// { jobId: string, eta?: number }
			return { jobId: 'ext-' + Date.now(), eta: 30 };
		},

		// Poll job status
		status: async (jobId) => {
			// return shape:
			// {
			//   status: 'queued' | 'running' | 'done' | 'failed',
			//   resultGlbUrl?: string,   // temporary signed URL or CDN URL
			//   textureUrls?: string[],  // optional pre-resolved texture URLs
			//   error?: string,
			// }
			return { status: 'done', resultGlbUrl: 'https://...' };
		},
	};
}
```

### Output requirements

When `status` returns `done`:

- **resultGlbUrl** (required) - HTTP(S) URL to the regenerated GLB file. If temporary signed URL, provider must guarantee it stays valid for at least 24 hours.
- **textureUrls** (optional) - Array of HTTP(S) URLs to texture files if they differ from those embedded in the GLB.

Provider is responsible for:

1. Storing intermediate results (probably temporary S3 / R2 bucket)
2. Persisting temporary URLs long enough for the client to register the avatar
3. Handling cleanup of stale jobs after X days

The client will:

1. Fetch the GLB from `resultGlbUrl` and store it in `avatars` R2 bucket
2. Register the new avatar via `POST /api/avatars` with `parent_avatar_id = sourceAvatarId`
3. Delete or archive the old avatar (user decision)

## Candidate providers

Research-stage notes (costs and integration effort unknown):

| Provider    | Specialization         | Notes                                                                            |
| ----------- | ---------------------- | -------------------------------------------------------------------------------- |
| **Meshy**   | 3D generation          | Text/image → mesh. API available; evaluate cost/time.                            |
| **CSM**     | Custom avatar builder  | Photo → avatar. Avalready integrated for `POST /api/onboarding/avaturn-session`. |
| **Rodin**   | Avatar generation      | Competitors of Meshy; check pricing.                                             |
| **TripoSR** | Text-to-3D models      | Open-source model; would need self-hosted inference.                             |
| **Kaedim**  | Automated mesh cleanup | Specifically optimized remeshing for game assets.                                |

Picking a provider is a separate decision and out of scope for this contract. When chosen, create `api/_providers/<name>.js` implementing the shape above, then set `AVATAR_REGEN_PROVIDER=<name>` in Vercel env.

## Environment

Add to `.env.local` or Vercel settings. The provider is **auto-detected from
present credentials** (priority: paid → free). Set `AVATAR_REGEN_PROVIDER`
explicitly to override.

```
# Explicit override (optional). Auto-detected order is replicate → gcp → huggingface.
AVATAR_REGEN_PROVIDER=replicate

# --- Replicate (paid, $0.035/run TRELLIS default) ---
REPLICATE_API_TOKEN=r8_...
# Optional - defaults to firtoz/trellis (MIT TRELLIS). Pin a version with owner/name:hash
REPLICATE_RECONSTRUCT_MODEL=firtoz/trellis
# Optional - if APP_ORIGIN is set this is derived. Replicate POSTs done predictions here.
REPLICATE_WEBHOOK_URL=https://three.ws/api/webhooks/replicate
# REQUIRED if you create the webhook in Replicate dashboard (gives you whsec_…)
REPLICATE_WEBHOOK_SIGNING_KEY=whsec_…

# --- GCP Cloud Run (self-hosted InstantMesh, see workers/avatar-reconstruction/) ---
GCP_RECONSTRUCTION_URL=https://avatar-reconstruction-…run.app
GCP_RECONSTRUCTION_KEY=…

# --- HuggingFace (free, Space queue, variable wait) ---
HF_TOKEN=hf_…
# Comma-separated failover chain. Format: "owner/name[:api_name]". First success wins.
# Default chain (when unset): tencent/Hunyuan3D-2.1, tencent/Hunyuan3D-2,
# JeffreyXiang/TRELLIS, stabilityai/TripoSR.
HF_RECONSTRUCT_SPACES=tencent/Hunyuan3D-2.1,JeffreyXiang/TRELLIS:image_to_3d
```

## Webhooks (Replicate only - optional but recommended)

When `REPLICATE_WEBHOOK_URL` is configured, every prediction submission asks
Replicate to POST `/api/webhooks/replicate` when the prediction completes.
That handler verifies the `webhook-signature` (Standard Webhooks spec), updates
the `avatar_regen_jobs` row, and - for `reconstruct` jobs - materializes the
avatar inline. The client's status poll then sees `done` + `resultAvatarId`
on its very next hit without any Replicate API call.

The poll path still works as a fallback: if a webhook is dropped/blocked,
the next `regenerate-status` call triggers a manual provider.status() poll
that reconciles the row.

To create the webhook + grab the signing secret:

1. Set `REPLICATE_WEBHOOK_URL=https://three.ws/api/webhooks/replicate` in Vercel.
2. Replicate dashboard → Webhooks → Add → URL = same → Save.
3. Copy the `whsec_…` secret → set as `REPLICATE_WEBHOOK_SIGNING_KEY` in Vercel.
4. Redeploy.

## Database schema (future migration)

The stub provider and status endpoint assume a `avatar_regen_jobs` table:

```sql
create table avatar_regen_jobs (
  job_id text primary key,
  user_id uuid not null,
  source_avatar_id uuid not null,
  mode text not null,  -- remesh | retex | rerig | restyle
  params jsonb,
  status text not null,  -- queued | running | done | failed
  result_avatar_id uuid,
  error text,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  foreign key (user_id) references users(id),
  foreign key (source_avatar_id) references avatars(id),
  foreign key (result_avatar_id) references avatars(id)
);

create index on avatar_regen_jobs(user_id);
create index on avatar_regen_jobs(job_id, user_id);
```

This table is not required if using an external provider (e.g., Meshy) for job tracking.
~~~~

