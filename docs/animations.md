# Animations

The full machine-readable registry is at [`public/animations/registry.json`](../public/animations/registry.json). Read it first before touching anything animation-related — it catalogues every animation asset in the project, which pipeline owns it, and its current status.

## Collections

There are 5 animation collections across the codebase. They are separate and use different rigs:

| Collection | Location | Status |
|---|---|---|
| **clips** | `public/animations/clips/*.json` | Active in main runtime |
| **orphaned_fbx** | `public/animations/*.fbx` (6 files) | On disk, never built — absent from manifest |
| **presets_robotexpressive** | `public/animations/robotexpressive.glb` | Legacy, not loaded at runtime |
| **lora_pipeline** | `character-studio/public/lora-assets/animations/` | character-studio LoRA pipeline only |
| **sprite_atlas_pipeline** | `character-studio/public/sprite-atlas-assets/animations/` | character-studio sprite atlas only |
| **sims_demo** | `sims-demo/public/AnimationLibrary.glb` | sims-demo character controller only |

## How the runtime loads animations

1. `src/app.js` fetches `/animations/manifest.json` on startup
2. `src/animation-manager.js` (`AnimationManager`) loads each clip from `public/animations/clips/`
3. `src/agent-avatar.js` plays clips by resolving **slots** → clip names via `src/runtime/animation-slots.js`
4. The UI widget `src/widgets/animation-gallery.js` lists all loaded clips

## Adding a new animation to the runtime

1. Drop the FBX into `public/animations/`
2. Add an entry to `scripts/animations.config.json`
3. Run `node scripts/build-animations.mjs` — retargets to the Avaturn rig, writes a JSON clip to `public/animations/clips/`, and updates `manifest.json`
4. Update `public/animations/registry.json` — move the entry from `orphaned_fbx` into `clips`
5. Optionally wire a slot in `src/runtime/animation-slots.js` so the agent plays it automatically

## Agent slots

Slots are the fixed vocabulary the agent avatar uses to express emotion/gesture. They resolve to clip names at runtime. Defined in `src/runtime/animation-slots.js`.

| Slot | Default clip | Notes |
|---|---|---|
| `idle` | `idle` | Always playing |
| `wave` | `reaction` | Maps to `reaction`, not the `wave` clip |
| `nod` | `reaction` | |
| `shake` | `angry` | |
| `think` | `pray` | |
| `celebrate` | `celebrate` | |
| `concern` | `defeated` | |
| `bow` | `sitclap` | |
| `point` | `reaction` | |
| `shrug` | `defeated` | |
| `fidget` | `Fidget` | **Broken** — no clip named `Fidget` exists |

Agents can override individual slots via `meta.edits.animations`.

## Known issues

- **`fidget` slot is broken** — maps to `"Fidget"` but no such clip exists in the manifest. Silent no-op at runtime. Fix: add a Fidget FBX to `animations.config.json` and rebuild, or remap the slot. (`src/runtime/animation-slots.js:30`)
- **6 orphaned FBX files** — `Cover To Stand.fbx`, `Goalkeeper Scoop.fbx`, `Jumping Down.fbx` (×3), `Removing Driver.fbx` exist in `public/animations/` but are never built. Fix: add entries to `scripts/animations.config.json`.
- **`wave` clip unreachable** — the `wave` clip is in the manifest but no agent slot or hint points to it. The `wave` slot maps to `reaction` instead.
- **Dead animation hints** — skill-emitted hints `gesture`, `inspect`, `present`, `sign`, `curiosity`, `patience` have no matching clip or slot; they silently no-op on Avaturn models. (`src/agent-avatar.js`)
