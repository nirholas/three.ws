# Band 3 — Edit Avatars

## The end state

An owner opens `/agent/:slug/edit` (or the equivalent panel) on an avatar they already have and can:

- Tweak materials, textures, and scene graph — **already shipped** (see `src/editor/*`).
- Retake the selfie and regenerate the avatar, keeping the same agent identity, slug, and action history.
- Switch outfits, accessories, or style presets without losing their identity.
- Roll back to a previous version.
- Save and publish — the new GLB replaces (or is versioned alongside) the old one at the same URL so every existing embed keeps working.

## Current state

- Material editor, scene explorer, texture inspector all shipped — `src/editor/index.js`, `src/editor/material-editor.js`, `src/editor/scene-explorer.js`, `src/editor/texture-inspector.js`, exposed on `window.VIEWER.editor`.
- Edits can be exported as a new GLB via `src/editor/glb-export.js` but there is no "save back to the server" path yet.
- Avatar records are stored in the `avatars` table. We have a `model_url`, but no concept of versions.
- Selfie → avatar pipeline (band 2) is the prerequisite for regenerate-from-photo.

## Prompts in this band

| # | File | Depends on |
|---|---|---|
| 01 | [save-edits-to-server.md](./01-save-edits-to-server.md) | — |
| 02 | [regenerate-from-photo.md](./02-regenerate-from-photo.md) | band 2 done |
| 03 | [outfit-variants.md](./03-outfit-variants.md) | 01 |
| 04 | [version-history.md](./04-version-history.md) | 01 |

## Done = merged when

- Owner on `/agent/:slug/edit` can make a material change, click **Save**, and the change persists — reloading the page or viewing the public URL shows the new look.
- Retake-selfie flow produces a new GLB bound to the same agent id; old versions are retained.
- Owner can roll back to version N — the public `model_url` serves version N's bytes.
- Every existing embed continues to render (no broken URLs after a version bump).

## Off-limits for this band

- Do not rewrite the editor (band 3 of earlier work shipped it — trust it).
- Do not introduce a new storage service. R2 is the blob store; Postgres is the source of truth for version pointers.
- Do not require a second GLB upload path — reuse `api/avatars` with a `version` query param or similar.
