# 07 — Avatar regenerate endpoint + UI

## Why

Band 3 gap: editor has material / mesh / texture tools but no "regenerate" path (re-mesh, re-texture, re-rig from a new prompt or reference photo). Real regen needs an ML backend we haven't picked yet — so this prompt ships the **seam**: an API contract, a UI panel, and a config-driven provider stub.

When an ML provider is chosen later, wiring it in is one config change. Until then, the endpoint returns `501 Not Implemented` with a clear message; the UI shows a disabled-but-visible panel explaining the roadmap.

## What to build

### 1. API contract

Create `api/avatars/regenerate.js`:

- `POST /api/avatars/regenerate` — auth required (via `getSessionUser` from [api/_lib/auth.js](../../api/_lib/auth.js)).
- Body: `{ sourceAvatarId: string, mode: 'remesh' | 'retex' | 'rerig' | 'restyle', params: object }`.
- Look up source avatar via `sql\`SELECT * FROM avatars WHERE id = ${id} AND owner_user_id = ${user.id}\`` — 404 if not found or not owned.
- Check env `AVATAR_REGEN_PROVIDER` — if unset or `"none"`, return:
  ```json
  { "ok": false, "error": "regen-unconfigured", "message": "Avatar regeneration is not yet wired to an ML backend. Set AVATAR_REGEN_PROVIDER env var." }
  ```
  with HTTP 501.
- If set to `"stub"`, return a deterministic fake job: `{ ok: true, jobId: 'stub-<uuid>', status: 'queued', eta: null }`.
- Document the future provider plug shape in a comment: what input the provider function receives, what output shape is expected (probably `{ glbUrl, textureUrls[], meta }`).

Rate-limit via `limits.authedWrite` from [api/_lib/limits.js](../../api/_lib/limits.js) (or the closest equivalent). Use `json()` / `error()` from [api/_lib/http.js](../../api/_lib/http.js).

### 2. Status endpoint

Create `api/avatars/regenerate-status.js`:

- `GET /api/avatars/regenerate-status?jobId=<id>` — auth required.
- Returns `{ ok: true, jobId, status: 'queued'|'running'|'done'|'failed', resultAvatarId?, error? }`.
- Stub provider always returns `done` with `resultAvatarId = sourceAvatarId` (no-op round-trip).

### 3. UI panel

Create `src/editor/regenerate-panel.js` — a UI panel that:

- Exports `mountRegeneratePanel(container, { avatarId, onResult })`.
- Renders a form: mode select, freeform params textarea (JSON), submit button.
- POSTs to `/api/avatars/regenerate`, polls `/regenerate-status` every 3s until terminal.
- On 501 error, shows an inline disabled banner: "Regeneration is not yet live. Join the waitlist." (link is a `mailto:` or your feedback issue — pick one and document).
- JSDoc the public API.

**Don't auto-mount this panel into the main editor.** That's a wiring step the operator does later in one line. Export the mount function and document how to call it.

### 4. Docs

Create `api/avatars/REGENERATE.md` describing:
- The endpoint contract.
- Provider plug shape.
- Roadmap: what providers are candidates (Meshy, CSM, Rodin, TripoSR, etc.) — note that picking one is out of scope.

## Files you own

- Create: `api/avatars/regenerate.js`
- Create: `api/avatars/regenerate-status.js`
- Create: `api/avatars/REGENERATE.md`
- Create: `src/editor/regenerate-panel.js`

## Files off-limits

- `api/avatars/*` existing files — don't touch.
- `src/editor/*` existing files — don't touch. The new panel is a standalone module consumers can mount.

## Acceptance

- `POST /api/avatars/regenerate` with no auth → 401.
- With auth + `AVATAR_REGEN_PROVIDER` unset → 501 with `{ error: 'regen-unconfigured' }`.
- With `AVATAR_REGEN_PROVIDER=stub` → returns jobId; status endpoint goes `queued` → `done`.
- `node --check` passes on every new JS.
- `npm run build` clean.

## Reporting

Files created, endpoint contract finalized, provider plug shape documented, list of candidate ML providers with rough cost-per-generation if known (optional research).
