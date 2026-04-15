---
mode: agent
description: "Mesh tab — replace underlying GLB (rerun selfie, upload GLB, or pick preset)"
---

# Stack Layer 3: Mesh Replacement Tab

## Problem

Users may want to change the underlying 3D mesh of an existing avatar while keeping identity, skills, and memory intact. Three paths: (1) retake selfie, (2) upload a GLB directly, (3) pick a preset avatar.

## Implementation

### Three methods

1. **Retake selfie** — reuse the selfie flow from stack-05/06. On completion, update `avatars.glb_url` on the existing row (do NOT create a new avatar).
2. **Upload GLB** — `<input type="file" accept=".glb,.gltf">`. Validate client-side (<50MB). Presign → upload → PATCH avatar.
3. **Preset picker** — small catalog at `GET /api/avatars/presets` (e.g., "Shiba", "Robot", "Ghost"). Click to apply.

### Validation (server)

On any mesh replacement, run the existing [src/validator.js](src/validator.js) server-side (or a lightweight version) against the new GLB:
- Must be valid glTF 2.0.
- Must have a skinned mesh with a rig (warn if not — some presets are static).
- File size < 100MB.

Reject with a descriptive error if invalid.

### Morph target compatibility

If the new mesh lacks ARKit blendshapes, the Empathy Layer falls back to head-bone-only expression. Detect this and surface a non-blocking warning in the UI: "This mesh doesn't support facial expressions."

### Keep-alive

Identity, skills, memory, animations — all preserved. Only `glb_url`, `source`, and `updated_at` change on the avatar row.

### Preview

After replacement, re-render the preview pane with the new GLB. The agent home timeline ([src/agent-home.js](src/agent-home.js)) logs a `mesh.replaced` action.

### Old mesh retention

Keep the old GLB in R2 for 30 days (versioning). Add `avatar_mesh_history` table: `{ avatar_id, glb_url, replaced_at }`. "Revert to previous" button if within 30 days.

## Validation

- Replace via GLB upload → preview shows new mesh, all skills/memory intact.
- Replace via preset → same.
- Upload an invalid file → rejected with helpful error.
- Upload a rigless mesh → warning shown, still accepted.
- Revert to previous → previous GLB restored.
- `npm run build` passes.

## Do not do this

- Do NOT create a new avatar row on mesh replace. Mutate in place.
- Do NOT delete the old GLB immediately.
