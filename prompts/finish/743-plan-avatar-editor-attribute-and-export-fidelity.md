# The GLB editor reaches 1.0: <agent-3d editor> works, every edit survives export, and hosts get DOM events

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/743-plan-avatar-editor-attribute-and-export-fidelity.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The in-browser GLB editor (`src/editor/`) is the path creators use to tweak materials, node transforms and visibility before publishing an embed. `specs/EDITOR_SPEC.md` lists five "pre-1.0 rough edges" that are all still open, and `specs/EMBED_SPEC.md` documents `<agent-3d editor>` as a working attribute that it is not (`editor` is not in `observedAttributes()`). Two of the five silently lose a creator's work: emissive intensity is shown in the viewport but never recorded, so it vanishes from the exported GLB, and materials that share a name collapse onto the first match on export with no warning. Hidden nodes are exported as scale 0, which destroys any scale edit and is not the standard `KHR_node_visibility`, so round-tripping in other tools breaks. External hosts also cannot observe edits or detect the editor version, and the Texture Inspector is read-only with texture replacement promised on the roadmap. An editor whose export does not match what the user saw is a trust problem on a core creator flow.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/element.js` `observedAttributes()` (around line 723) has no `editor` entry and nothing in `_boot()` mounts the editor. `src/editor/embed-editor.js` exports `mountEmbedEditor(root, opts)` (line 103, callable manually only) and `src/editor/index.js` exports `class Editor` (line 18). `specs/EMBED_SPEC.md` lines 159 and 430 still promise the attribute ("EDITOR_SPEC.md (coming next)").
- `src/editor/material-editor.js` lines 99-105: the `emissiveIntensity` control's `onChange` calls `mat.needsUpdate` and `viewer.invalidate()` but never `record()` (the other bindings call it at lines 91, 97, 108, 133), so `session.materialEdits` never carries it; `snap.emissiveIntensity` exists for reset (line 153).
- `src/editor/glb-export.js` `applyMaterialEdits` (line 49) handles baseColor, opacity, metalness, roughness, emissive, alphaMode, alphaCutoff, doubleSided only, and builds a first-name-wins `byName` Map (lines 52-56; nodes the same at 87-91). `applyTransformAndVisibilityEdits` (line 82) writes `node.setScale([0, 0, 0])` for hidden nodes (lines 106-111).
- No `CustomEvent` is dispatched anywhere in `src/editor/*.js` (`session.onChange()` only); no `data-editor-version` attribute exists. `specs/EDITOR_SPEC.md` line 536 recommends `data-editor-version="agent-editor/0.1"` and an `editor:ready` event, not yet implemented.
- `src/editor/texture-inspector.js` is read-only (`docs/editor.md` line 155).
- No test in `tests/` imports `src/editor/` apart from `tests/manifest-builder-mount.test.js`; `glb-export.js` and `material-editor.js` are untested.
- Libraries already installed: `@gltf-transform/core` ^4.4.0, `@gltf-transform/extensions` ^4.5.1 (use `ALL_EXTENSIONS`), `@gltf-transform/functions`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "observedAttributes" -A30 src/element.js | grep -n "editor" ; echo "exit=$? (1 means editor attr still unwired)"
grep -n "record()" src/editor/material-editor.js
grep -n "emissiveIntensity" src/editor/*.js
grep -n "setScale(\[0" src/editor/glb-export.js
grep -rn "CustomEvent\|dispatchEvent\|data-editor-version" src/editor/ | head
grep -rln "glb-export\|material-editor\|embed-editor" tests | head
grep -n "KHR_node_visibility" -r node_modules/@gltf-transform/extensions/dist/*.d.ts | head -3
grep -c "KHR_node_visibility" node_modules/three/examples/jsm/loaders/GLTFLoader.js
```

Skip any task whose gap no longer exists.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first for each export bug, in a new `tests/editor-glb-export.test.js` (Vitest, Node, no browser, beside the other `tests/*.test.js`): build small GLBs in memory with `@gltf-transform/core` `Document` (two materials sharing the name `Material`, a node with a non-trivial scale, an emissive material), construct a minimal stub `session` exposing `getSourceBuffer()`, `materialEdits`, `transformEdits`, `visibilityEdits`, run `exportEditedGLB`, re-read the bytes with `WebIO`, and assert. Write the failing assertions for emissive intensity round trip, hidden-node fidelity, duplicate-name targeting. Run and confirm each fails for the documented reason before fixing.
2. Emissive intensity: call `record()` for the `emissiveIntensity` binding in `src/editor/material-editor.js`, add `emissiveIntensity` to the stored edit shape in `src/editor/session.js`, and in `applyMaterialEdits` write it with `KHR_materials_emissive_strength` (`doc.createExtension(KHRMaterialsEmissiveStrength)`, `material.setExtension(...).setEmissiveStrength(v)`). When the value is exactly 1, remove the extension rather than writing a no-op. Revert (`clearMaterialEdit`) must clear it too.
3. Visibility: stop zeroing scale. If the installed `@gltf-transform/extensions` ships `KHRNodeVisibility` (Step 0), write `KHR_node_visibility` (`visible: false`) and keep the node's real scale (add it to `ALL_EXTENSIONS` if absent); otherwise write the same extension through `node.setExtension` with a custom `Extension` subclass registered on the `WebIO`. Confirm `three`'s `GLTFLoader` and the loader in `src/viewer.js` / `src/element.js` honour it on re-import; if not, add a small loader plugin in `src/editor/` that sets `object.visible = false`, and use it wherever edited GLBs are re-opened (the viewer and the publish preview). Also write `extras: { threeWsHidden: true }` so downstream tools that ignore the extension can read intent. Add the re-import round trip to the test file.
4. Duplicate names: key edits by a stable identity, not the name. In `src/editor/session.js` record the glTF index (`materialIndex`, `nodeIndex`) captured at `rebuild()` time (use `loader.parser.associations` or traverse `parser.json` `materials[]`/`nodes[]` in file order), and have `glb-export.js` look up by index with name as a fallback for sessions persisted before this change. `src/editor/edit-persistence.js` stores sessions: version the stored shape and migrate on read. When a name still collides and no index exists (legacy name key), apply to all matches, and return `{ bytes, warnings }` from the export, surfacing the warnings in the Editor's download toast and `PublishModal` (plus one `console.warn` with the name), instead of silently patching the first match. Test both the index path and the legacy path.
5. Events and version: in `src/editor/embed-editor.js` set `data-editor-version` to the current spec version string on the mounted root and dispatch `editor:ready` (`{ version }`) at mount. In `src/editor/index.js`, hook `session.onChange()` to dispatch bubbling, composed `CustomEvent`s on the host element: `editor:change` (`{ kind: 'material'|'transform'|'visibility'|'reset', editCount }`), `editor:export` (`{ bytes: byteLength, warnings }`) and `editor:publish` (`{ step }`, mirroring the publish progress events). Document each in the `specs/EMBED_SPEC.md` events table and in `specs/EDITOR_SPEC.md` (replace the "Recommended (not yet implemented)" text at line 536).
6. Wire `<agent-3d editor>`: add `editor` to `observedAttributes()` in `src/element.js` and a boot branch (and `attributeChangedCallback`) that, when the attribute is present, lazy-imports the editor module (code-split, never loaded for plain embeds; lazy-load dat.gui together with it only when `editor` is set and keep the default embed bundle unchanged, checking any bundle-size budget test in `tests/`), constructs the editor against the element's viewer, and passes `src`/`agent-id` through as the source. Toggling the attribute at runtime attaches and `dispose()`s cleanly. Follow `EMBED_SPEC.md` (the editor replaces the live agent chrome); record that decision in one paragraph in the spec. Do not mount in `kiosk` mode. The Copy Embed output must never contain `editor`.
7. Texture replacement: add a "Replace" action to the lightbox in `src/editor/texture-inspector.js` (file input accepting `image/png`, `image/jpeg`, `image/webp`, size cap matching `api/_lib/validate.js` limits). Record the replacement in the session keyed by material identity plus slot (base color, normal, metallic-roughness, occlusion, emissive), preview it live on the Three.js material, and in `glb-export.js` write the new image bytes with `texture.setImage(bytes).setMimeType(...)` on the slot texture (create the texture and texture info if the slot was empty). Revert restores the original. Add export tests for replacing an existing slot and filling an empty one.
8. Docs: update the Known Limitations and roadmap sentence in `docs/editor.md` (texture replacement is no longer "not yet available"), remove each fixed "Pre-1.0 rough edge" from `specs/EDITOR_SPEC.md` (including rough edge #1 in section 1; bump the version string in section 8 and `src/editor/index.js` to `agent-editor/0.2`, keep the runtime version detection accurate), and fix `specs/EMBED_SPEC.md` lines 159 and 430 (the `editor` row in Dev / debug and the Editor mode section: drop "coming next", link EDITOR_SPEC.md). Append a `data/changelog.json` entry and run `npm run build:pages`.
9. Browser verification: `npm run dev`, open a page with `<agent-3d editor src="...">` for a real GLB, change emissive intensity, hide a node, replace a texture, export, and re-open the exported file in `/viewer` to confirm all edits survive. Check no console errors, and that removing the attribute detaches the editor.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/editor-glb-export.test.js` passes with cases for emissive strength, `KHR_node_visibility` round trip with the node's original scale preserved, duplicate material names patched independently, and texture replacement; each was seen failing before its fix.
- [ ] `grep -n "setScale(\[0" src/editor/glb-export.js` returns nothing.
- [ ] `grep -n "'editor'" src/element.js` shows the attribute in `observedAttributes()`; `<agent-3d editor src="...">` renders the editor panels in a real browser with zero console errors.
- [ ] `grep -rn "editor:ready\|editor:change\|data-editor-version" src/editor` shows all implemented, and they are documented in `specs/EDITOR_SPEC.md` and `specs/EMBED_SPEC.md`.
- [ ] In a real browser: edit emissive intensity, download the GLB, re-open it in `/viewer`; the glow matches. Hide a node, export, re-open; it stays hidden and its scale in the file is unchanged.
- [ ] `specs/EDITOR_SPEC.md` has no "Pre-1.0 rough edge", "not yet wired" or "not yet implemented" text left; `docs/editor.md` no longer says texture replacement is "not yet available".
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No fixture GLB for tests | Build one in the test with `@gltf-transform/core` `Document`; no network or binary fixture needed |
| Installed `three` or `@gltf-transform/extensions` lacks `KHR_node_visibility` | Write the extension through a custom gltf-transform `Extension` subclass and add the tiny `GLTFLoader` plugin (apply visibility in the editor's post-load pass if the loader will not); do not fall back to the scale hack. Check for a newer compatible release first |
| Editor depends on dat.gui which `<agent-3d>` deliberately does not load in embed mode | Lazy-load dat.gui together with the editor chunk only when `editor` is set |
| No stable glTF index available from `GLTFLoader` | Compute identity from document order: the loader parses `materials[]` and `nodes[]` in file order, so traverse `parser.json` in the same order and store the index when the session rebuilds |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/743-plan-avatar-editor-attribute-and-export-fidelity.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `743-plan-avatar-editor-attribute-and-export-fidelity.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/editor.md` (whole file)

~~~~markdown
# Editor Guide

The three.ws editor lets you inspect and modify an agent's 3D model, adjust materials and textures, build the agent manifest, and publish the result to the platform. It runs entirely in the browser: open a GLB, edit, and publish or download. This guide covers the full workflow from opening a file through publishing.

---

## Accessing the Editor

### Edit an existing agent

If you own an agent and are authenticated:

```
https://three.ws/agent/<agent-id>/edit
```

This opens the agent edit page pre-loaded with your agent's GLB and configuration. You must be signed in. The platform checks ownership server-side when you attempt to save or publish.

Two more entry points:

```
https://three.ws/agent/new           starts a new agent from scratch
https://three.ws/app?agent=<id>      the viewer app shell in editing mode with save-back
```

### Open any GLB file (no account required)

Navigate to:

```
https://three.ws/app
```

Then drag and drop any `.glb` file onto the viewport. The editor loads the file locally - nothing is uploaded until you explicitly publish. Unauthenticated users can freely inspect and modify the model in the viewport; publishing requires signing in.

---

## Editor Layout

The editor is organized into four regions:

| Region | What it contains |
|---|---|
| **Scene Explorer panel** | The full object tree, with an inspector below it showing the selected object's properties |
| **Center** | 3D viewport (three.js canvas with editing enabled) |
| **Animation panel** | Clip buttons rendered by the viewer for rigged models |
| **dat.GUI "Editor" folder** | Quick-access actions: download GLB, publish as embed, scene panel, save edits, revert all edits |

The dat.GUI panel (behind the Controls toggle, top-right corner) is the primary way to trigger editor actions. The Scene Explorer is toggled with the `T` key or the "scene panel [T]" button.

---

## Scene Explorer

The Scene Explorer (`scene-explorer.js`) mirrors the Three.js scene graph as an interactive tree. Open it with `T` or the "Scene Panel" button.

### Reading the tree

Each node shows a type icon, its name, and a visibility toggle:

| Icon | Type |
|---|---|
| 📦 | Mesh |
| 🧍 | Skinned mesh |
| 🎯 | Group |
| 🦴 | Bone |
| 💡 | Light |
| 📷 | Camera |
| 🌳 | Scene root |

The **●/○ toggle** on each row shows or hides that node. Hidden nodes are written into the export (scaled to zero - see [Known Limitations](#known-limitations)).

### Selecting objects

- **Click a row** to select the object. It highlights in the viewport.
- **Double-click** to frame the camera on the selection.
- **Click in the viewport** to ray-cast and select the object under the cursor.

Once an object is selected, the inspector panel below the tree shows its position, rotation, scale, geometry stats, and (for lights/cameras) their specific properties.

### Transform gizmo

With an object selected, a transform gizmo appears in the viewport. Switch modes with keyboard shortcuts:

| Key | Mode |
|---|---|
| `W` | Translate |
| `E` | Rotate |
| `R` | Scale |
| `Escape` | Deselect |

Transform changes are recorded as overrides in the editor session and included in the exported GLB.

### Filtering the tree

Use the search box at the top of the Scene Explorer to filter nodes by name. Useful for scenes with hundreds of bones.

---

## Material Editor

The Material Editor (`material-editor.js`) appears as a set of dat.GUI folders - one per material found in the scene. It handles `MeshStandardMaterial` and `MeshPhysicalMaterial` (the two material types used in glTF files).

### Editable properties

| Property | What it controls |
|---|---|
| **Base color** | Albedo color (RGB) |
| **Metalness** | 0 = plastic/dielectric, 1 = metallic |
| **Roughness** | 0 = mirror-smooth, 1 = fully matte |
| **Emissive color** | Self-illumination color |
| **Emissive intensity** | Multiplier on the emissive color |
| **Opacity** | Overall transparency (requires alpha mode) |
| **Alpha test** | Cutoff threshold for Mask mode |
| **Wireframe** | Preview only - not written to export |
| **Flat shading** | Disables smooth normals |
| **Env map intensity** | Strength of environment reflections |
| **Side** | Front / Back / Double |

Each material folder has a **Reset** button that reverts it to the original glTF values.

### How edits are stored

Material edits are recorded in the session as patches keyed by material name. The original GLB on disk is never touched. When you export or publish, the patch is applied to the source bytes via [gltf-transform](https://gltf-transform.donmccurdy.com/) before writing the output file.

> **Why patches instead of saving the whole file?** This keeps edits small and reversible. The "Revert" button in the dat.GUI discards all patches and reloads the original.

---

## Texture Inspector

The Texture Inspector (`texture-inspector.js`) opens a panel (toggle with `X`) showing a thumbnail grid of every texture in the loaded GLB.

### What it shows

For each texture:

- **Thumbnail** - rendered at native resolution
- **Format** - PNG, JPEG, KTX2, WebP, or video
- **Dimensions** - width × height in pixels
- **Estimated memory** - uncompressed VRAM footprint
- **Wrap and filter modes** - repeat, clamp, mip settings
- **Which material slots reference it** - base color, normal, roughness/metallic, emissive, etc.
- **Which mesh nodes use those materials** - useful for finding UV problems

### Lightbox viewer

Click any thumbnail to open a full-screen lightbox with advanced inspection tools:

- **Per-channel extraction** - view R, G, B, or A channel as grayscale
- **Alpha over checkerboard** - verify transparent areas
- **UV wireframe overlay** - draw UV seams from mesh attributes over the texture
- **Zoom and pan** - mouse wheel to zoom, drag to pan, Fit button to reset

The Texture Inspector is read-only. Texture replacement (upload a new image to replace an existing slot) is on the roadmap but is not yet available in the current release.

---

## Morph Targets

If the loaded model contains morph targets (also called blend shapes), sliders appear in the inspector panel when a mesh is selected.

- Range: **0.0** (rest pose) to **1.0** (full deformation)
- Changes are applied in real-time in the viewport
- The emotion system drives ARKit-style blendshape names (`mouthSmile`, `browInnerUp`, `eyesClosed`, and similar); if your model's targets use those names, expressions work automatically

Use these sliders to verify expressions look correct before connecting them to the emotion system. Morph target influences are not currently written to the export.

---

## Animation Controls

The animation panel (rendered by the viewer, `src/viewer.js` `.anim-panel`) lists the clip library available to the loaded rig.

- **Play** per clip: click the clip button to crossfade to it
- **Stop all** (⏹) - halts all running clips
- **Active state** - the currently playing clip is highlighted
- **1-9 keys**: trigger the first nine clips

Animations continue running while you adjust materials. This is intentional: it lets you preview how the avatar looks in motion while tweaking a roughness value, rather than evaluating a static pose.

Clips embedded in the GLB itself get per-clip toggles and a playback-speed slider in the dat.GUI **Animation** folder.

---

## Manifest Builder

The Manifest Builder (`manifest-builder.js`) generates the `agent-manifest/0.1` JSON bundle that defines the agent's full configuration. Access it from the dat.GUI or the agent-edit page.

It is organized into sections:

### Identity
- Agent name and description
- Profile image
- Tags

### Body
- GLB file (upload a file or provide a URL)
- Format: `gltf-binary`, `gltf`, or `vrm`
- Rig type: Mixamo, VRM, or custom
- Bounding box override

### Brain
- AI provider: Anthropic, OpenAI, local, or none
- Model selection
- System instructions (text area)
- Temperature, max tokens, thinking mode

### Voice
- TTS provider and voice ID
- Speech rate and pitch
- STT provider, language, continuous listening toggle

### Skills
- Add or remove skill URIs
- Toggle built-in skills (wave, validate, remember, etc.)

### Memory
- Mode: `local`, `ipfs`, `encrypted-ipfs`, or `none`
- IPFS provider and index settings
- Max tokens for memory context

The manifest is validated against a Zod schema before export. Draft state is auto-saved to `localStorage` under the key `manifest-builder-draft` so your work survives a page reload.

Clicking **Generate** produces either a ZIP bundle (manifest.json + assets) or a raw JSON string you can copy directly.

---

## Save and Publish Flow

### Auto-save (local, no account required)

The editor session (`session.js`) tracks a dirty flag whenever you make a change. Edits are also persisted to `sessionStorage` (JSON) and `IndexedDB` (file bytes) by `edit-persistence.js`. If you navigate away and come back, or if the page redirects to login and returns, your edits are restored automatically.

A "Unsaved changes" warning appears in the browser's beforeunload dialog if you try to close the tab with unsaved edits.

### Save to account

The **Save to Account** button triggers `save-back.js`, which runs a four-step pipeline:

1. Export the modified GLB from the session
2. Request a signed upload URL from `/api/avatars/presign`
3. PUT the GLB bytes directly to cloud storage (R2)
4. PATCH the avatar record with the new GLB URL and storage key

Requires authentication. The platform validates storage key ownership server-side.

### Publish

The **Publish** button in dat.GUI opens the publish modal (`publish-modal.js`), which shows step-by-step progress:

| Step | What happens |
|---|---|
| **Export** | Session edits applied to source GLB via gltf-transform |
| **Upload** | Bytes sent to cloud storage (25 MB limit enforced client-side) |
| **Register** | Avatar metadata written to `/api/avatars` |
| **Widget** | Turntable widget config created at `/api/widgets` |

On success, the modal shows three ready-to-use snippets:

- **Share link** - direct URL to the agent page
- **Iframe snippet** - embed in any webpage
- **Web component snippet** - `<agent-3d>` element

If you are not signed in, the modal stashes the current session (bytes + edits) and redirects to `/login?next=<url>`. After login, the editor resumes exactly where you left off.

### Export GLB (download only)

The **Download** button in dat.GUI runs the export without publishing. Your edits are applied to the source GLB and a `.glb` file is downloaded to your machine. The original file is unchanged.

---

## The Override System

The editor never modifies the source GLB in memory. Instead, it maintains a set of named patches:

- `materialEdits` - PBR property values keyed by material name
- `transformEdits` - position, rotation, scale keyed by node name
- `visibilityEdits` - visibility flag keyed by node name

When exporting, `glb-export.js` loads the original source bytes, applies all patches by name-matching against the gltf-transform document, and writes the result. This means:

- **The original is always recoverable** - hit Revert at any time
- **Edits are portable** - the same override set can be applied to an updated version of the base model (`apply-overrides.js`)
- **Round-trips work** - if you publish, edit the server copy, and re-open, the patches from the server are applied on load

> Name-based matching means that if a material or node is renamed in the source GLB, the patch won't apply. Keep names stable when iterating on your model.

---

## Programmatic Editing (Advanced)

The viewer exposes the Three.js scene directly. You can access it from the browser console or from a script running on the page:

```js
const viewer = document.querySelector('agent-3d').viewer;

// Change a material's base color
const mesh = viewer.content.getObjectByName('Body');
mesh.material.color.setHex(0xff6600);
viewer.invalidate(); // trigger re-render

// Set a morph target influence
mesh.morphTargetInfluences[0] = 0.5;

// Export the modified GLB (returns Uint8Array)
import { exportEditedGLB } from '/src/editor/glb-export.js';
const session = editor.session;
const bytes = await exportEditedGLB(session);
```

To hook into the editor session change events:

```js
const editor = viewer._editor; // set when editor mode is active
editor.session.onChange(() => {
  console.log('edits changed:', editor.session.materialEdits);
});
```

The `onChange` callback fires on any material, transform, or visibility edit, and also on session reset (new file loaded).

---

## Known Limitations

The editor is at format version `agent-editor/0.1`. The following rough edges are documented in the spec and will be addressed before 1.0:

1. **`editor` attribute not wired** - the `<agent-3d editor>` attribute is parsed but does not auto-mount the editor panels. Use the JS `Editor` class directly.
2. **Emissive intensity not persisted** - emissive intensity changes are visible in the viewport but are not written to the exported GLB.
3. **Visibility via scale hack** - hidden nodes are exported with `scale=[0,0,0]` rather than being removed or flagged. This is not spec-compliant and may cause issues in downstream tools.
4. **Duplicate material names** - if the GLB contains two materials with the same name, only the first match is patched during export.
5. **No DOM events** - the editor does not fire DOM events on session changes. External code must call `session.onChange()` directly.

The full contract lives in [specs/EDITOR_SPEC.md](https://github.com/nirholas/three.ws/blob/main/specs/EDITOR_SPEC.md).

## Related

- [3D Viewer](/docs/viewer): the rendering layer the editor sits on
- [Agent Manifest](/docs/agent-manifest): the manifest format the builder produces
- [Avatar creation](/docs/avatar-creation): generate an avatar to edit
- [Embedding](/docs/embedding): what the published embed snippet gives you
~~~~

### `specs/EDITOR_SPEC.md` (whole file)

~~~~markdown
# Editor Spec v0.1 - `<agent-3d editor>` & `src/editor/`

> **Format ID:** `agent-editor/0.1` > **Stability:** draft - breaking changes may occur before 1.0
> **Relationship to EMBED_SPEC:** EMBED*SPEC defines how a finished agent is played back. This spec defines the surface for \_authoring* one. The `editor` attribute switches the same `<agent-3d>` element from playback mode into editing mode. The "Copy Embed" output of the editor is a plain `<agent-3d>` element with no `editor` attribute - a clean embed the user pastes anywhere.

---

## 1. Identity

The editor layer lives in [`src/editor/`](../src/editor/) and is orchestrated by [`src/editor/index.js`](../src/editor/index.js) (`Editor` class). It is activated in the Studio/viewer via a dat.gui `Editor` folder; the intended web-component activation path uses the `editor` boolean attribute on `<agent-3d>`.

### Pre-1.0 rough edge #1 - `editor` attribute not yet wired

[`EMBED_SPEC.md` §Dev/debug](./EMBED_SPEC.md) documents `<agent-3d editor>` and says it "mounts the embed editor instead of the live agent." However, [`src/element.js`](../src/element.js) does not include `editor` in `observedAttributes()` (line 211-226) and `_boot()` has no branch for it. The embed editor module ([`src/editor/embed-editor.js`](../src/editor/embed-editor.js)) must be imported and mounted manually today. Downstream hosts must not rely on the attribute-driven path until this is wired.

---

## 2. Attached editor contract

### `editor` attribute (boolean)

**Documented contract** (see EMBED_SPEC.md line 109):

```html
<agent-3d editor src="agent://base/42"></agent-3d>
```

Replaces the live agent runtime with the embed editor. Intended to be a boolean presence attribute - no value required.

**Current state:** not handled by `observedAttributes` in [`src/element.js:211`](../src/element.js#L211). Manual integration required (see §6).

### Other attributes used by editor flows

These are standard embed attributes that the editor reads or writes to its output snippet. They are fully handled by [`src/element.js`](../src/element.js):

| Attribute    | Type                                          | Role in editor context                                                |
| ------------ | --------------------------------------------- | --------------------------------------------------------------------- |
| `src`        | URI                                           | Source agent URI; echoed into "Copy Embed" snippet                    |
| `agent-id`   | string                                        | Backend UUID or on-chain ref; echoed into snippet                     |
| `manifest`   | URL                                           | Manifest URL; echoed into snippet                                     |
| `body`       | URL                                           | Bare GLB URI; the editor's primary input when no manifest exists      |
| `mode`       | `inline`\|`floating`\|`section`\|`fullscreen` | Layout mode selector in embed-editor UI                               |
| `position`   | string                                        | Floating mode anchor - `bottom-right`, etc.                           |
| `width`      | CSS length                                    | Configurable in embed-editor                                          |
| `height`     | CSS length                                    | Configurable in embed-editor                                          |
| `responsive` | boolean                                       | Toggleable in embed-editor                                            |
| `kiosk`      | boolean                                       | Suppresses chat chrome - not editor-specific but affects embed output |

---

## 3. Editor panels

### 3.1 `EditorSession` - [`src/editor/session.js`](../src/editor/session.js)

The central shared state object. All panels read from and write to it.

**State owned:**

| Field             | Type                             | Description                                          |
| ----------------- | -------------------------------- | ---------------------------------------------------- |
| `sourceURL`       | `string\|null`                   | URL of the loaded model                              |
| `sourceFile`      | `File\|null`                     | Dropped File object                                  |
| `sourceBuffer`    | `ArrayBuffer\|null`              | Lazily cached bytes (fetched or read from File)      |
| `sourceName`      | `string`                         | Display name, derived from URL basename or File.name |
| `materialEdits`   | `{ [uuid]: MaterialEditPatch }`  | Keyed by Three.js `material.uuid`                    |
| `transformEdits`  | `{ [uuid]: TransformEditPatch }` | Keyed by Three.js `Object3D.uuid`                    |
| `visibilityEdits` | `{ [uuid]: { name, visible } }`  | Keyed by Three.js `Object3D.uuid`                    |

**Patch shapes:**

```js
// MaterialEditPatch
{
  name: string,          // material.name - used for GLB export name-matching
  uuid: string,
  baseColor?: [r, g, b], // 0-1 floats
  metalness?: number,
  roughness?: number,
  emissive?: [r, g, b],
  opacity?: number,
  alphaMode?: 'OPAQUE'|'BLEND'|'MASK',
  alphaCutoff?: number,
  doubleSided?: boolean
}

// TransformEditPatch
{
  name: string,           // node.name - used for GLB export name-matching
  uuid: string,
  position: [x, y, z],
  rotation: [x, y, z],   // Euler, radians, XYZ order
  scale: [x, y, z]
}
```

**Methods:**

| Method                                | Returns                | Description                                  |
| ------------------------------------- | ---------------------- | -------------------------------------------- |
| `reset({ url, file, name })`          | void                   | Clears all edits; sets new source            |
| `isExportReady()`                     | boolean                | True when any source is set                  |
| `isDirty()`                           | boolean                | True when any edit map is non-empty          |
| `onChange(fn)`                        | unsubscribe fn         | Fires after any edit or reset                |
| `recordMaterialEdit(material, patch)` | void                   | Merges patch into materialEdits              |
| `clearMaterialEdit(material)`         | void                   | Removes entry from materialEdits             |
| `recordTransformEdit(node)`           | void                   | Writes current position/rotation/scale       |
| `recordVisibilityEdit(node, visible)` | void                   | Writes visibility state                      |
| `restoreEdits(edits)`                 | void                   | Re-applies a saved edit set by name-matching |
| `getSourceBuffer()`                   | `Promise<ArrayBuffer>` | Fetches or reads bytes; caches result        |

**Failure modes:** `getSourceBuffer()` throws if no source is set. `reset()` with no source logs a warning but does not throw.

---

### 3.2 `MaterialEditor` - [`src/editor/material-editor.js`](../src/editor/material-editor.js)

**What it edits:** PBR properties on every `MeshStandardMaterial` and `MeshPhysicalMaterial` in the loaded scene. One dat.gui subfolder per material, opened under a top-level `Materials` folder.

**Editable properties per material:**

| Property           | Range             | Notes                                                |
| ------------------ | ----------------- | ---------------------------------------------------- |
| base color         | hex color         | `mat.color`                                          |
| metalness          | 0-1               |                                                      |
| roughness          | 0-1               |                                                      |
| emissive color     | hex color         | `mat.emissive`                                       |
| emissive intensity | 0-4               | **Not recorded to session** (pre-1.0 rough edge #2)  |
| opacity            | 0-1               | Sets `mat.transparent` automatically when < 1        |
| transparent        | boolean           |                                                      |
| alpha test         | 0-1               |                                                      |
| wireframe          | boolean           | Not recorded to session (viewport-only preview)      |
| flat shading       | boolean           | Not recorded to session (viewport-only preview)      |
| env map intensity  | 0-4               | If present on material; not recorded to session      |
| side               | Front/Back/Double | Maps to three.js `FrontSide`/`BackSide`/`DoubleSide` |

**Inputs:** `viewer.content` (Three.js scene graph), `viewer.gui` (dat.GUI instance), `EditorSession`.

**Outputs:** mutates Three.js material in place for live preview; records to `session.materialEdits` on every change via `recordMaterialEdit()`.

**Events:** none. Internal only via `session.onChange`.

**Reset:** `↺ reset` button per subfolder restores the snapshot captured at `rebuild()` time and calls `session.clearMaterialEdit(mat)`.

**Failure modes:**

- If `viewer.gui` is null, no UI is built (silent no-op).
- If the scene has no standard/physical materials, the `Materials` folder is not created.

### Pre-1.0 rough edge #2 - emissive intensity not persisted

`emissiveIntensity` changes call `mat.needsUpdate = true` and `viewer.invalidate()` but do **not** call `record()` ([`src/editor/material-editor.js:100-103`](../src/editor/material-editor.js#L100)). The value is visible in the viewport but will not appear in an exported GLB.

---

### 3.3 `SceneExplorer` - [`src/editor/scene-explorer.js`](../src/editor/scene-explorer.js)

**What it is:** A side panel appended to `viewer.el` showing the full Three.js scene tree, a node inspector, and a TransformControls gizmo.

**Tree shape:** Recursive DOM tree mirroring `viewer.content` hierarchy. Root is auto-expanded. Each node row shows:

- Expand/collapse arrow (if children present)
- Type icon (mesh, skinned mesh, group, bone, light, camera, etc.)
- Node name or type
- Visibility toggle (● visible / ○ hidden)

Nodes are identified in the tree DOM by `data-uuid` attribute.

**Selection semantics:**

- Click on a row selects the node → `this.selectedNode`, highlights the row with `.selected` class, attaches TransformControls.
- Double-click frames the node in the camera.
- Left-click on the canvas raycasts against `viewer.content`; hit object is selected (walks up to the nearest Mesh/Light/Camera ancestor).
- `Escape` key detaches TransformControls and clears selection.

**Visibility toggle:**

- Per-row ● button sets `node.visible` and calls `session.recordVisibilityEdit(node, visible)`.
- Inspector "Hide"/"Show" button does the same.

**Transform editing:**

- Gizmo keys: `W` translate, `E` rotate, `R` scale.
- Inspector shows editable numeric inputs for pos/rot°/scale; changes call `session.recordTransformEdit(node)`.
- TransformControls `objectChange` event also calls `session.recordTransformEdit`.

**Search:** Text input filters tree rows by label; matching rows expand their ancestors.

**Keyboard shortcuts** (when not in an input):

| Key      | Action                      |
| -------- | --------------------------- |
| `T`      | Toggle panel open/closed    |
| `W`      | Switch gizmo to translate   |
| `E`      | Switch gizmo to rotate      |
| `R`      | Switch gizmo to scale       |
| `Escape` | Detach gizmo, deselect node |

**Inputs:** `viewer` (Viewer instance), `EditorSession`.

**Outputs:** mutates Three.js scene graph in place for live preview; records to `session.transformEdits` / `session.visibilityEdits`.

**Events:** none emitted. `dragging-changed` on TransformControls disables `viewer.controls` while dragging.

**Failure modes:** If `viewer.renderer.domElement` is unavailable at `attach()` time, pointer-down raycasting silently skips. Panel remains in the DOM on error.

---

### 3.4 `TextureInspector` - [`src/editor/texture-inspector.js`](../src/editor/texture-inspector.js)

**What it does:** Catalogs every texture referenced by the loaded model, renders a thumbnail grid panel, and provides a full-screen lightbox with per-channel extraction, zoom/pan, and UV wireframe overlay.

**Read-only:** The TextureInspector does **not** record edits to the session. It is a diagnostic/inspection tool only. No texture modifications are persisted to the exported GLB.

**Texture catalog:** Collected by traversing `viewer.content` via `traverseMaterials()`. For each unique texture UUID, tracks: material slot labels, material names, and mesh nodes (for UV overlay). Covered slots: base color, normal, metallic, roughness, occlusion, emissive, bump, alpha, displacement, clearcoat (and variants), sheen (and variants), specular (and variants), transmission, thickness, light map - 19 slots total.

**Thumbnail grid panel** (`.texture-inspector`): Opens appended to `document.body`. Close button or `X` key toggles.

**Lightbox** (`.texture-lightbox`): Opens on card click. Provides:

- RGB / R / G / B / A channel extraction (requires same-origin or CORS-readable image for channel modes)
- Alpha-over-checkerboard mode
- UV wireframe overlay (renders triangle edges from mesh UV attributes)
- Zoom (mouse wheel) and pan (mouse drag) with cursor-centered zoom
- Fit/reset button

**Keyboard shortcut:** `X` - toggle the texture grid panel open/closed.

**Inputs:** `viewer.content`, `viewer.gui`.

**Outputs:** none to session. DOM panels appended to `document.body`.

**Events:** none emitted.

**Failure modes:**

- Channel extraction calls `ctx.getImageData()` - this will throw (CORS) for cross-origin textures. The lightbox shows "channel extraction blocked (CORS)" in place of extracted data.
- If no textures are found, the `Textures` dat.gui folder is not created.

---

### 3.5 `exportEditedGLB` / `downloadGLB` - [`src/editor/glb-export.js`](../src/editor/glb-export.js)

**Export format:** GLB (`model/gltf-binary`) via `@gltf-transform/core` `WebIO` + all extensions (`@gltf-transform/extensions`).

**What is included:** The full original GLB/GLTF content, with the following edits applied:

- Material properties: base color factor, metallic factor, roughness factor, emissive factor, alpha mode, alpha cutoff, double-sided.
- Node transforms: translation, rotation (converted from Euler XYZ to quaternion), scale.
- Node visibility: hidden nodes are written with `scale = [0, 0, 0]` (no glTF `extras.hidden` - see rough edge #3).

**What is stripped:** Nothing - all geometry, animations, extensions, and accessories in the source file are preserved.

**Name matching:** Materials and nodes are matched to glTF-Transform entities by **name**, not UUID. Three.js UUIDs do not cross the serialization boundary. The first material/node with a matching name receives the edit. Duplicate names silently affect only the first match.

**`downloadGLB(bytes, filename)`:** Creates a `Blob` URL, triggers an `<a download>` click, removes the element, and revokes the URL after 1 second.

**Output filename:** `<sourceName>.edited.glb` where `sourceName` strips query strings and `.glb`/`.gltf` extensions.

**Failure modes:**

- `exportEditedGLB(session)` throws `Error('No source buffer for export')` if `session.getSourceBuffer()` returns nothing.
- `getSourceBuffer()` throws if no source URL or File is set.
- Caller in `Editor._exportGLB()` catches and shows `window.alert`.

### Pre-1.0 rough edge #3 - visibility via scale hack

Hidden nodes are written as `scale = [0, 0, 0]` rather than using a `KHR_node_visibility` extension or `extras.hidden`. This works visually but destroys the scale edit for those nodes and is not spec-compliant glTF visibility. ([`src/editor/glb-export.js:106-109`](../src/editor/glb-export.js#L106))

### Pre-1.0 rough edge #4 - duplicate name collision

Both material edits and transform/visibility edits match by the first occurrence of each name in the glTF root. If a model has two materials both named `"Material"`, only the first is patched. The GUI shows both under different folder labels but they share the name key. ([`src/editor/glb-export.js:53-58`](../src/editor/glb-export.js#L53))

---

### 3.6 `publishEditedGLB` - [`src/editor/publish.js`](../src/editor/publish.js)

Turns an in-progress `EditorSession` into a live shareable widget. Five sequential steps:

| Step       | Operation                                 | Endpoint                    |
| ---------- | ----------------------------------------- | --------------------------- |
| `export`   | `exportEditedGLB(session)` → `Uint8Array` | (client-side)               |
| `presign`  | POST metadata, get signed PUT URL         | `POST /api/avatars/presign` |
| `upload`   | PUT raw bytes to presigned URL            | R2 (presigned URL)          |
| `register` | Create avatar metadata record             | `POST /api/avatars`         |
| `widget`   | Create turntable widget                   | `POST /api/widgets`         |

**Progress callback:** `onStep({ step, pct })` fired at each step boundary. Steps: `'export'`, `'presign'`, `'upload'`, `'register'`, `'widget'`.

**Return value on success:**

```js
{
  widget: { id, ... },
  avatar: { id, ... },
  urls: {
    page: 'https://…/w/<widgetId>',
    iframe: '<iframe src="…" …></iframe>',
    element: '<script …></script>\n<agent-3d src="…" …></agent-3d>'
  }
}
```

**Error classes exported** (importable from `./publish.js`):

| Class               | When thrown                                      |
| ------------------- | ------------------------------------------------ |
| `AuthRequiredError` | 401 from any fetch step                          |
| `SizeTooLargeError` | Client-side size check or 413 from register step |
| `ExportFailedError` | `exportEditedGLB` throws                         |
| `PublishError`      | Any non-401/non-413 non-2xx response             |

**Client-side size limit:** `MAX_BYTES = 25 * 1024 * 1024` (25 MB) - enforced before upload. Server-side schema allows up to 500 MB ([`api/_lib/validate.js:58`](../api/_lib/validate.js#L58)); the client is the stricter limit here.

**Auth requirements:** Session cookie (`credentials: 'include'`) or bearer token with `avatars:write` scope. No anonymous publishing.

**Failure on 401:** throws `AuthRequiredError`. Callers (e.g. `PublishModal`) redirect to `/login?next=<url>` and stash session state in `sessionStorage`/IndexedDB via [`src/editor/edit-persistence.js`](../src/editor/edit-persistence.js) for round-trip restore.

---

### 3.7 `PublishModal` - [`src/editor/publish-modal.js`](../src/editor/publish-modal.js)

UI wrapper over `publishEditedGLB`. Manages three states: **working** (step progress list), **result** (shareable snippets), **error** / **auth-required**. Appended to `containerEl` (default: `document.body`) as a modal overlay.

**Auth-required state:** Stashes session via `edit-persistence.stashSession()`, then redirects to `/login?next=<url with ?resume=<token>&publish=1>`.

**Output shown to user on success:** share link, iframe snippet, web component snippet. Each copyable. Share link also has an "Open" button.

**Accessibility:** `role="dialog"`, `aria-modal="true"`, focus trap, `Escape` closes, `aria-live="polite"` on step list.

---

### 3.8 `EmbedEditor` - [`src/editor/embed-editor.js`](../src/editor/embed-editor.js)

A separate "place, scale, preview, copy" UX. Mounted by calling `mountEmbedEditor(rootEl, { src, defaults })`. Renders a split view: a live iframe preview on the left, a control panel on the right.

> Route note: the standalone `/embed` page this module used to back is retired. That editor's job now belongs to the Widget Studio at `/studio` ([`public/studio/studio.js`](../public/studio/studio.js)), which reads the same query-parameter names, so `/embed?…` links rewrite there. This module stays as the embeddable, host-mountable form of the same UX (the `<agent-3d editor>` path described above); it is no longer served at a route of its own.

Controls exposed:

- Mode selector (floating, inline, section, fullscreen)
- Position selector for floating mode (6 anchors)
- Width/height inputs
- Responsive preset (fixed, mobile-first, desktop-first)
- Device preview switcher (desktop 1440×900, tablet 768×1024, mobile 390×844)
- "Copy Embed" - generates and copies the `<agent-3d>` snippet

**Output:** a complete `<script type="module">` + `<agent-3d>` snippet with no `editor` attribute.

**Note:** This module is self-contained and not wired through the `Editor` orchestrator in `index.js`. It imports `../element.js` directly.

---

### 3.9 `Editor` orchestrator - [`src/editor/index.js`](../src/editor/index.js)

Wires MaterialEditor, TextureInspector, SceneExplorer, and GLB export/publish into the Viewer via dat.gui.

**Entry point:**

```js
const editor = new Editor(viewer);
editor.attach(); // once, after viewer constructed
editor.onContentChanged({ url, file, name }); // every time a new model loads
```

**dat.gui folder added:** `Editor` - contains:

- `💾 download GLB` (count badge when edits exist; disabled when no source)
- `📤 publish as embed`
- `🗂 scene panel [T]`
- `↺ revert all edits`

**`dispose()`:** removes all sub-panels, gui folder, and detaches SceneExplorer.

---

## 4. Permission model

### Who can edit

| Actor              | Can view model | Can edit materials/transforms | Can export GLB      | Can publish                       |
| ------------------ | -------------- | ----------------------------- | ------------------- | --------------------------------- |
| Anonymous visitor  | Yes            | Yes (viewport only)           | Yes (download only) | No - 401 → login redirect         |
| Authenticated user | Yes            | Yes                           | Yes                 | Yes - creates under their account |
| Owner of the agent | Yes            | Yes                           | Yes                 | Yes                               |

The editor itself is entirely client-side; there is no server-side ownership gate on the _editing_ phase. Ownership is enforced only at **publish time** (API).

### Ownership check at publish

1. `POST /api/avatars/presign` - requires valid session or bearer with `avatars:write`. Returns 401 if missing. The presign action is dispatched from [`api/avatars/[id].js`](../api/avatars/[id].js) into the `handlePresign` handler in [`api/avatars/_actions.js`](../api/avatars/_actions.js).
2. `POST /api/avatars` - same auth requirement. Additionally verifies that `storage_key` starts with `u/{auth.userId}/` to prevent cross-user key claiming. ([`api/avatars/index.js:50-53`](../api/avatars/index.js#L50))

### How the editor checks identity

Client-side auth hint via `readAuthHint()` from [`src/account.js:43`](../src/account.js#L43) (localStorage, 7-day TTL). This is optimistic and non-authoritative - used only to gate first-paint UI. Authoritative check is `getMe()` → `GET /api/auth/me` ([`src/account.js:63`](../src/account.js#L63)). Both session cookie and bearer token are accepted.

### Unauthed user save path

When `publishEditedGLB` catches `AuthRequiredError`, `PublishModal.showAuthRequired()` is called. The user clicks "Sign in" - `_signInAndReturn()`:

1. Serializes current `EditorSession` edits + source to `sessionStorage`/IndexedDB via `stashSession()` ([`src/editor/edit-persistence.js`](../src/editor/edit-persistence.js)).
2. Redirects to `/login?next=<current URL with ?resume=<token>&publish=1>`.
3. Post-login, the caller is expected to detect `?resume` and call `restoreEdits()` on a fresh session.

([`src/editor/publish-modal.js:155-163`](../src/editor/publish-modal.js#L155))

---

## 5. Events

### Session internal events

`EditorSession` uses a listener set, not DOM events. Subscribe via `session.onChange(fn)`.

| Trigger                          | When fired                   |
| -------------------------------- | ---------------------------- |
| `session.reset()`                | New model loaded             |
| `session.recordMaterialEdit()`   | Any material property change |
| `session.clearMaterialEdit()`    | Material reset               |
| `session.recordTransformEdit()`  | Any node transform change    |
| `session.recordVisibilityEdit()` | Visibility toggle            |
| `session.restoreEdits()`         | Edits restored from stash    |

### Publish progress events

Passed to `publishEditedGLB({ onStep })` as a callback, not DOM events.

| `step` value | `pct` range | When                           |
| ------------ | ----------- | ------------------------------ |
| `'export'`   | 0 → 1       | GLB serialization start → done |
| `'presign'`  | - → 1       | Presign response received      |
| `'upload'`   | 0 → 1       | XHR upload progress            |
| `'register'` | - → 1       | Avatar record created          |
| `'widget'`   | - → 1       | Widget record created          |

(`PublishModal.onStep` maps `'presign'` → `'upload'` bucket for UI display.)

### Pre-1.0 rough edge #5 - no DOM CustomEvents from the Editor

The `Editor` class and all panels communicate via `session.onChange()` callbacks and direct method calls. No `CustomEvent` is dispatched on any DOM node. External hosts integrating the editor cannot listen to edit events on the element without accessing `editor.session.onChange()` directly. This is an integration gap for the `<agent-3d editor>` web-component path.

---

## 6. Extension points

### Adding a custom panel

There is no formal plugin API. The pattern followed by existing panels:

1. Class takes `(viewer, session)` in its constructor.
2. Exposes `rebuild()` called by `Editor.onContentChanged()`.
3. Exposes `dispose()` for cleanup.
4. Optionally adds a dat.gui folder via `viewer.gui`.
5. Calls `session.onChange()` to react to upstream changes, returns the unsubscribe function for cleanup.

To wire a custom panel into the orchestrator, modify `Editor` in [`src/editor/index.js`](../src/editor/index.js) - there is no registration mechanism today.

### Adding a custom exporter

`exportEditedGLB` in [`src/editor/glb-export.js`](../src/editor/glb-export.js) is a standalone async function:

```js
async function exportEditedGLB(session: EditorSession): Promise<Uint8Array>
```

A custom exporter can be dropped in by:

1. Reading `await session.getSourceBuffer()` for the original bytes.
2. Reading `session.materialEdits`, `session.transformEdits`, `session.visibilityEdits` for the accumulated changes.
3. Returning a `Uint8Array` of any desired format.

No formal exporter plugin contract exists; the `Editor._exportGLB()` method ([`src/editor/index.js:108`](../src/editor/index.js#L108)) hardcodes the import. Replacing the exporter requires editing the orchestrator.

**Recommendation:** Do not invest in a custom exporter plugin seam until the `editor` attribute is wired in `element.js` - the integration surface is too unstable before that.

---

## 7. Security

### What is sanitized before upload

**Content-type allowlist:** Only `model/gltf-binary` and `model/gltf+json` are accepted by the presign and avatar-create endpoints. This is enforced by the Zod schema `avatarContentType` at [`api/_lib/validate.js:20-23`](../api/_lib/validate.js#L20). An upload of any other MIME type (HTML, SVG, JS, etc.) is rejected with `400 validation_error` before a presigned URL is issued - preventing XSS via CDN-hosted file.

**Storage key ownership:** `POST /api/avatars` verifies that the submitted `storage_key` starts with `u/{auth.userId}/` and does not contain `..` ([`api/avatars/index.js:50-53`](../api/avatars/index.js#L50)). Users cannot register objects uploaded by other users.

**R2 object existence:** `headObject(storage_key)` is called before writing the `avatars` record ([`api/avatars/index.js:56-57`](../api/avatars/index.js#L57)). If the object is not in R2 or the `size_bytes` does not match, the request is rejected. This blocks attempts to register a fake record without performing the upload.

**Optional checksum:** If the browser includes a `checksum_sha256` in the presign or register body, it is stored. If not provided, the server attempts to read it from the R2 object metadata ([`api/avatars/index.js:63-79`](../api/avatars/index.js#L63)). Not enforced as required today.

### Size limits

| Limit                     | Value                | Enforced by                                                            |
| ------------------------- | -------------------- | ---------------------------------------------------------------------- |
| Client-side publish limit | 25 MB                | [`src/editor/publish.js:17`](../src/editor/publish.js#L17) `MAX_BYTES` |
| Server-side schema max    | 500 MB               | [`api/_lib/validate.js:58,63`](../api/_lib/validate.js#L58)            |
| Rate limit (uploads)      | 60 per hour per user | `limits.upload(userId)` in presign                                     |

The client enforces 25 MB; the server allows up to 500 MB. A caller bypassing the client library can upload up to 500 MB.

### Allowed MIME types

`model/gltf-binary` and `model/gltf+json` only. Enforced at both presign and register endpoints.

### SSRF

The presign flow issues a PUT URL for direct browser-to-R2 upload; the server never fetches the uploaded content. No SSRF surface in the publish path.

`EditorSession.getSourceBuffer()` does `fetch(this.sourceURL)` ([`src/editor/session.js:179`](../src/editor/session.js#L179)) to retrieve the source model bytes. This runs in the **browser**, not the server, so there is no server-side SSRF. However, any URL the user can set as `sourceURL` is fetched. This is intentional: users can load GLBs from arbitrary HTTPS origins (subject to browser CORS policy).

---

## 8. Versioning

### Spec version

This document covers `agent-editor/0.1`. Breaking changes bump the minor until 1.0; after 1.0 they bump the major.

A **breaking change** is:

- Removing or renaming a published export from any `src/editor/*.js` module.
- Changing the shape of `materialEdits`, `transformEdits`, or `visibilityEdits` in a way that breaks `restoreEdits()` round-trips.
- Changing the publish API endpoints or their response shapes.
- Removing an attribute that the embed editor reads or writes.

A **non-breaking change** is:

- Adding new optional fields to patch objects.
- Adding new dat.gui controls.
- New `onStep` step names (callers should ignore unknown steps).
- CSS/layout changes inside panels.

### Detecting the editor version at runtime

No version attribute or event exists today. To check which spec version an editor host speaks:

**Recommended (not yet implemented):** Add a `data-editor-version="agent-editor/0.1"` attribute to the root element mounted by `mountEmbedEditor`, and/or dispatch a `editor:ready` CustomEvent with `{ version: 'agent-editor/0.1' }` on the host element at mount time. This attribute/event should be added before the `editor` attribute is wired in `element.js`.

Until then, feature-detect by checking whether the `Editor` class is exported from [`src/editor/index.js`](../src/editor/index.js).

---

## Pre-1.0 rough edges - summary

| #   | Location                                                                     | Issue                                                                                                                      |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`src/element.js:211`](../src/element.js#L211)                               | `editor` boolean attribute not wired - `<agent-3d editor>` does not activate the editor                                    |
| 2   | [`src/editor/material-editor.js:100`](../src/editor/material-editor.js#L100) | `emissiveIntensity` changes are not recorded to session - lost on export                                                   |
| 3   | [`src/editor/glb-export.js:106`](../src/editor/glb-export.js#L106)           | Hidden nodes written as `scale=[0,0,0]` instead of `KHR_node_visibility`                                                   |
| 4   | [`src/editor/glb-export.js:53`](../src/editor/glb-export.js#L53)             | Duplicate material/node names resolve to first match only - no warning                                                     |
| 5   | [`src/editor/index.js`](../src/editor/index.js)                              | No DOM `CustomEvent` emitted - external hosts cannot observe edit activity without accessing `session.onChange()` directly |

---

## See also

- [EMBED_SPEC.md](./EMBED_SPEC.md) - full attribute reference for `<agent-3d>`
- [AGENT_MANIFEST.md](./AGENT_MANIFEST.md) - manifest format
- [`src/editor/`](../src/editor/) - source of truth for all claims above
- [`api/avatars/`](../api/avatars/) - presign and register endpoints
- [`api/_lib/validate.js`](../api/_lib/validate.js) - content-type allowlist and size limits
~~~~

### `specs/EMBED_SPEC.md` (section "Dev / debug")

~~~~markdown
### Dev / debug

| Attribute | Notes                                                                          |
| --------- | ------------------------------------------------------------------------------ |
| `kiosk`   | forces the bare avatar - hides all chrome (chat, controls, debug GUI, plate)    |
| `debug`   | overlays scene graph, tool-call log, memory inspector                          |
| `editor`  | mounts the embed editor instead of the live agent                              |

Note: the debug GUI and axes gizmo are already hidden on every bare avatar (the
default), so `kiosk` is only needed to force bare on an `agent-id`/`manifest`
binding that would otherwise chat. See "Chrome" above.
~~~~

### `specs/EMBED_SPEC.md` (section "Editor mode")

~~~~markdown
## Editor mode

`editor` attribute replaces the live agent with the embed editor described in `EDITOR_SPEC.md` (coming next) - drag-to-position, scale handles, live-preview-on-your-site, copy-snippet.

```html
<agent-3d editor src="agent://base/42"></agent-3d>
```

The editor's "Copy Embed" output is a plain `<agent-3d>` with no `editor` attribute - a clean embed the user pastes anywhere.
~~~~

