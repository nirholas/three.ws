# Task 02 — Outfit / material overrides

## Why

Users want to recolor the shirt, swap eye color, change skin tone. Doing this by re-exporting a new GLB is slow and lossy. Instead: store a small patch `{ materialName: { baseColor, metalness, roughness, emissive } }` and apply it at render time.

## Read first

- [src/editor/material-editor.js](../../src/editor/material-editor.js) — existing dat.gui-based editor
- [src/editor/session.js](../../src/editor/session.js) — how edits are tracked for export
- [src/editor/glb-export.js](../../src/editor/glb-export.js) — serializer (not used here, keep as fallback)
- [src/viewer.js](../../src/viewer.js) — `traverseMaterials`, model load flow
- [api/agents/[id].js](../../api/agents/[id].js) — PATCH endpoint

## Build this

### 1. Patch shape

`agent_identities.meta.edits.materials`:

```json
{
  "Body":  { "color": "#ffc8a0", "metalness": 0.1, "roughness": 0.8 },
  "Shirt": { "color": "#3b5eff", "emissive": "#000000" }
}
```

Only listed fields override; everything else comes from the GLB.

### 2. `/agent/:id/edit` tab "Outfit"

A new tab alongside task 01's persona form. Layout:
- Left: live preview.
- Right: a list of every named mesh/material in the current GLB, each as a collapsible card with color + metalness + roughness + emissive controls.

### 3. Apply-on-load

In the viewer pipeline (probably a new `src/editor/apply-overrides.js`):
- Fires after model load.
- Reads `meta.edits.materials` from the agent record.
- Walks `traverseMaterials` and applies overrides by material name.
- Idempotent — re-running with the same patch is a no-op.

### 4. Save

Debounced (1s) PATCH of the patch blob only. Small — typically < 1 KB.

### 5. "Reset this material" + "Reset all"

Two buttons. Reset removes the key from the patch (PATCH with `null` on that field).

### 6. Embed consistency

`<agent-3d agent-id="…">` embeds MUST apply the same overrides. Verify that [src/element.js](../../src/element.js) routes through the resolver which includes `meta.edits`, and that the viewer applies them.

## Don't do this

- Do not rewrite the underlying GLB. Overrides are render-time only.
- Do not allow arbitrary materials to be added. Only edits on existing ones.
- Do not implement outfit swaps (swapping in a new shirt mesh). That's a future task; color/PBR only here.
- Do not store the patch per-viewer-session. Server-persisted only.

## Acceptance

- [ ] Open `/agent/:id/edit` → Outfit tab → change "Shirt" color to red → save → preview updates.
- [ ] Refresh `/agent/:id` → shirt still red.
- [ ] `<agent-3d agent-id="…">` in a separate HTML file → shirt red.
- [ ] Reset → shirt returns to GLB default.
- [ ] Download the base GLB → it has NOT been modified.
- [ ] `npm run build` passes.

## Reporting

- A diff of a patch (e.g. JSON before / after)
- Screenshot of the Outfit tab
- Confirmation that embed renders with overrides
