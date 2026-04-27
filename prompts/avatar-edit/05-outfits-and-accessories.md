# Task: Outfits and accessories — preset pack swapped via morphs / bone overlays in the same GLB

## Context

Repo: `/workspaces/3D`. The Avaturn export already includes outfit topology and some morph targets. What's missing is a lightweight way for the user to iterate — try a hat, glasses, swap between 2–3 outfits — **without re-entering Avaturn** and **without branching a new GLB per combination**.

Principle: **stay in the same GLB.** The avatar file on R2 is canonical. Accessories and outfit variants are applied at runtime via:

- **Morph targets** the GLB already exposes (e.g. outfit color/pattern blend shapes Avaturn ships with).
- **Bone-attached overlays** for accessories (hat, glasses, earrings) — small `.glb` snippets loaded and parented to head/hand bones at runtime.

The current outfit/morph state lives in `agent_identities.meta.appearance = { outfit: 'preset-id', accessories: ['hat-01', 'glasses-02'], morphs: { ... } }`. Consumed at boot by [src/element.js](../../src/element.js) → [src/runtime/scene.js](../../src/runtime/scene.js).

Relevant existing code to reuse (do not fork):

- [src/editor/material-editor.js](../../src/editor/material-editor.js) — exposes material tweaks per mesh.
- [src/editor/scene-explorer.js](../../src/editor/scene-explorer.js) — enumerates the scene graph (useful for finding head/hand bones).
- [src/agent-avatar.js](../../src/agent-avatar.js) — already iterates morph targets every frame for emotion blend. The outfit morph application runs alongside its loop; do not fight it.

## Goal

Ship a small preset pack of outfits and accessories, plus a dashboard panel to apply/remove them. State persists on `agent_identities.meta.appearance`. The canonical GLB on R2 is untouched. agentId, wallet link, and ERC-8004 registration are untouched.

## Deliverable

1. **Preset pack**

    - New directory `public/accessories/` with:
        - `presets.json` listing `{ id, kind: 'hat'|'glasses'|'outfit'|'earrings', name, glbUrl?, morphBinding?, attachBone?, thumbnail }`.
        - 6–10 entries total (2–3 outfits, 2–3 hats, 2 glasses).
        - For outfit presets that rely on morph targets exposed by Avaturn, specify `morphBinding: { 'Outfit.Variant': 1.0 }` instead of a `glbUrl`. For accessory presets, specify `glbUrl` + `attachBone` (e.g. `'Head'`, `'LeftHand'`).
        - Do **not** add the actual `.glb` / thumbnail binaries in this task — assume a separate content pass. Note missing files in the reporting section.

2. **Runtime — new module**

    - New file `src/agent-accessories.js`:
        - `class AccessoryManager { constructor(viewer) }`
        - `async applyPreset(preset)` — if `glbUrl`, loads via the same `GLTFLoader` path as the animation manager, parents the root under the named bone, caches the loaded scene. If `morphBinding`, sets morph influences on the matching mesh's `morphTargetDictionary`.
        - `removePreset(id)` — removes the attached object (disposes geometry/material/texture) or zeroes the morph.
        - `list()` — returns currently applied preset ids.
        - `hydrateFromAppearance(appearance)` — applies all presets from `meta.appearance` on boot.
        - Cleanup: when the underlying model is replaced (task 01 / 02 path), `AccessoryManager` must re-hydrate on the new model. Listen on the viewer or wire an explicit `onModelReplaced(newModel)` method.
    - Wire it from [src/element.js](../../src/element.js) or [src/runtime/scene.js](../../src/runtime/scene.js) so a boot with `appearance` applies automatically.

3. **Dashboard — outfits panel**

    - New route: `#edit/<agentId>/outfits` in [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).
    - Tabbed grid: Outfits | Hats | Glasses | Earrings. Each tab renders a thumbnail grid from `public/accessories/presets.json`.
    - Clicking a preset toggles it in a small live preview viewer (isolated, same pattern as [04-animation-library.md](./04-animation-library.md)). Confirm / apply → `PATCH /api/agents/:id` with updated `meta.appearance`.
    - "Remove" button per category.
    - Conflict rules: only one outfit at a time, only one hat at a time, only one pair of glasses at a time. Multiple earrings allowed.

4. **Backend validation**
    - Extend the agents-patch zod schema to validate `meta.appearance`:
        - `outfit`: string (preset id) | null.
        - `accessories`: array of strings (preset ids), max 8.
        - `morphs`: `Record<string, number>` with values clamped 0..1, max 32 keys.
    - Reject preset ids that don't exist in a server-side allowlist. Options:
        - Ship the allowlist as a `public/accessories/presets.json` read at build time (baked into a small `api/_lib/accessories.js` module), OR
        - Fetch and cache it on cold start.
        - Pick the simpler path and document the choice.

## Important: stay in the same GLB

- **Do not** create a new `avatars` row for an outfit change.
- **Do not** export a combined GLB bundling outfit + accessory + base. The live runtime composes at render time.
- **Do not** re-pin to IPFS. If the agent is registered, show the same "on-chain drift" warning as other edit flows.
- The URL for the avatar bytes on R2 is canonical and stable across outfit changes.

## Audit checklist

- agentId, wallet link, ERC-8004 fields untouched.
- `agent_identities.avatar_id` untouched.
- On boot of `<agent-3d>`, `appearance` from the record replays and produces the same visual result as the dashboard preview.
- Changing outfits replaces, not stacks. Changing hats replaces, not stacks.
- Removing an accessory disposes its geometry, material, and textures (no leak across apply/remove cycles).
- Morph overrides from outfits compose with the Empathy Layer's emotion morphs — `AccessoryManager` must not clobber emotion morph influences each frame. Do **not** call `setMorphInfluence` inside the render loop; set once on apply.
- Preset allowlist is server-enforced; a client-crafted preset id is rejected.
- When the avatar GLB changes (task 01 / 02), the accessory overlays re-hydrate on the new model or surface a warning if bones / morph targets no longer exist.

## Constraints

- No new runtime dependencies.
- No per-combination pre-baking.
- Do not modify [src/agent-avatar.js](../../src/agent-avatar.js)'s morph loop. Outfit morphs that need to persist should be set once on apply, and the emotion loop should leave non-facial morphs alone — verify this is already the case; if it isn't, scope a tiny fix here and note it.
- Use existing `GLTFLoader` via `three/addons/loaders/GLTFLoader.js` — no extra loader libs.
- Dashboard native-DOM. Preview viewer isolated.
- Keep `AccessoryManager` under 300 lines. If it grows, extract helpers into sibling files.

## Verification

1. `node --check` every modified JS file.
2. `npx vite build`.
3. Manual:
    - Open `#edit/<agentId>/outfits`.
    - Apply a hat → dashboard preview shows it parented to the head bone. PATCH persists `meta.appearance.accessories` with the hat id.
    - Apply an outfit preset bound to a morph target → morph influence is set. Persisted.
    - Reload main app with `<agent-three.ws-id="...">` — the same hat + outfit re-apply on boot.
    - Remove the hat → disposed, gone from the record.
    - Apply a second hat → replaces the first (not additive).
    - Apply earrings → two accessories allowed.
    - Confirm emotion blend still animates (smile when greeted) — outfit morphs do not freeze the face.
    - Replace the avatar GLB (task 02 flow). Confirm accessories either re-hydrate on the new skeleton or surface a clear warning.
4. Try PATCHing `meta.appearance.outfit = 'not-a-preset'` — expect 400.
5. Confirm `agent_identities.id` unchanged across all these operations.

## Scope boundaries — do NOT do these

- Do not build a color-picker for custom outfit tinting.
- Do not add IK or cloth simulation.
- Do not add user-uploaded accessories in this task. Presets only. A future task can open it up.
- Do not branch a new `avatars` row per outfit combination.
- Do not write `.glb` export of the composed look.
- Do not generate thumbnails dynamically. Ship static thumbnails in `public/accessories/thumbs/`.

## Reporting

- Files created / edited.
- How the preset allowlist is read server-side (bundled vs fetched).
- Any accessory `.glb` / thumbnail files noted as missing.
- Whether the emotion morph loop collides with outfit morphs in practice (and what you did about it).
- `npx vite build` output.
- Any bone name that the preset pack assumed but is missing from a Mixamo-standard Avaturn skeleton.
