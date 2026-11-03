# Avatars carry a saved animation identity (idle, walk, gesture intensity, emote loadout) honored everywhere

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/775-plan-avatar-animation-identity.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 26 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Every avatar idles and walks the same way. Personality is the main thing that makes two parametric avatars with similar bodies feel like different characters, and the appearance schema already reserves `animation` for it ("default idle and walk, gesture intensity, mood blend, emote loadout", phase 7). Embeds, /play and the agent stage all choose animations in their own code, so the value must be saved on the avatar and read by one shared resolver.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `animation` is reserved in `specs/AVATAR_PARAMETERS.md` and `specs/PARAMETRIC_AVATAR.md`, not implemented in `api/_lib/validate.js` `avatarAppearance`.
- Animation sources: `/animations/manifest.json`, `src/idle-animation.js`, `src/animation-retarget.js`, `animation-sources/README.md`; the Studio's Walk tab drives an auto-walk.
- No shared per-avatar animation resolver exists (verify with grep in Step 0).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "animation" api/_lib/validate.js | head
grep -rn "idle\b.*manifest\|manifest.json" src/*.js | head -8 | cut -c1-150
ls public/animations | head; python3 -c "import json;d=json.load(open('public/animations/manifest.json'));print(len(d) if isinstance(d,list) else list(d)[:5])"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Spec: add the `animation` object to `specs/AVATAR_PARAMETERS.md`: `{ idle, walk, gestureIntensity (0..1), moodBlend, emotes: string[] (max 8) }` where clip ids reference `/animations/manifest.json` entries only. Validate with strict caps in `avatarAppearance` and reject unknown clip ids server-side against the manifest.
2. Pure resolver `src/avatar-animation-identity.js`: `resolveClip(appearance, intent)` mapping intents (`idle`, `walk`, `gesture`, `emote:<n>`) to clip ids with intensity scaling, falling back to the platform default when unset. Dependency-free; tested in `tests/avatar-animation-identity.test.js` (unset, partial, invalid id, intensity bounds, deterministic).
3. Wire into the runtimes that choose clips: `src/avatar-studio.js` (preview), the `<agent-3d>` element and the stage (`src/stage-element.js`, `src/stage.js`), and /play. Grep for the places that hard-code idle and walk clip names and replace them with the resolver.
4. Studio UI: an "Animation" tab with idle and walk pickers that preview on click, an intensity slider, and an emote loadout editor; designed empty/loading/error states, keyboard accessible, hover/focus/active states.
5. Save and load through the existing avatar PATCH route (`api/avatars/[id].js`) and verify the bake ignores the field safely (the bake must not depend on it; assert in `tests/avatar-bake.test.js`).
6. Docs, changelog, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/avatar-animation-identity.test.js tests/avatar-bake.test.js` passes.
- [ ] PATCH of an avatar with an unknown clip id returns 400; a valid one persists and round-trips on GET.
- [ ] In a browser, an avatar saved with a non-default walk plays that walk in the Studio and in an `<agent-3d>` embed with zero console errors.
- [ ] `grep -rn "'idle'" src/stage*.js src/avatar-studio.js` shows no remaining hard-coded default that bypasses the resolver.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Manifest has few clips | Use what exists; the order does not add animation content (that is `animation-sources`' job) |
| Clip not present for a non-humanoid rig | Fall back to platform default per the resolver tests |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/775-plan-avatar-animation-identity.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `775-plan-avatar-animation-identity.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `specs/PARAMETRIC_AVATAR.md` (section "Reserved")

~~~~markdown
## Reserved

| Item | For |
|---|---|
| Identity-morph fold | Folding applied identity morphs into `POSITION` at bake time, with recomputed normals, so a served avatar carries only the ARKit expression targets. That is what lifts the 96 MB budget and unblocks 400+ sliders. It needs correct normal recomputation on a skinned mesh, which is why it is not in v1. |
| `slots` | Conforming hair and garments auto-fitted to the canonical body (phase 3, `workers/garment-forge`) |
| `layers` | Texture layers over the canonical UVs: complexion, makeup, tattoos, decals, age maps (phase 6) |
| `animation` | Per-avatar animation identity: default idle and walk, gesture intensity, mood blend, emote loadout (phase 7) |
~~~~

### `specs/AVATAR_PARAMETERS.md` (section "Reserved")

~~~~markdown
## Reserved

Named here so implementations do not claim the keys for anything else:

| Field | For |
|---|---|
| `layers` | Texture layers over the canonical UVs (tattoos, makeup, complexion) |
| `animation` | Per-avatar animation identity (default idle/walk, gesture intensity, mood) |
| `base` | Explicit base-body id, once more than one parametric base ships |
~~~~

### `docs/avatar-studio.md` (whole file)

~~~~markdown
# Avatar Studio: build a custom avatar from scratch, no selfie

Avatar Studio builds a fully rigged 3D avatar without a photo. You start from a base body and shape it into your own character: tint skin, hair, and outfit; sculpt the face and body with morph sliders; put on catalog garments from a closet; add hats, glasses, and earrings; hide or show the body's own garment layers to strip back to the base and build a look up; drive the rig live with a library of emotes; and walk the finished avatar around the stage. When you save, the live scene is exported to a GLB exactly as you see it and stored to your account, ready to animate, dress, and use anywhere on the platform.

Page: [/avatar-studio](https://three.ws/avatar-studio) (also reachable at [/create/studio](https://three.ws/create/studio))

## Why it exists

The selfie-to-avatar path is great when you want to look like yourself, but it is a wall when you want to be someone, or something, else. Avatar Studio is the from-scratch path: no camera, no upload, just a base humanoid and the tools to make it yours. It reuses the same building blocks as the platform's avatar editor, the `TalkScene` viewport, the accessory manager, the sculpt panel, and the shared GLB optimize-and-validate path, so an avatar built here is a first-class avatar everywhere, not a lesser one. And because the customization is stored both as a validated GLB (so it always renders right) and as re-editable appearance metadata, you can come back and change it later.

## How it works

The studio mounts a `TalkScene` around a base body and layers a tabbed customization panel over it. A **Base** switcher at the top of the panel picks the starting template (create mode only; a saved avatar always reloads its own model):

- **Stylized** (`/avatars/default.glb`): the dressed feminine stylized body with hair, outfit, and garment layers. The default.
- **Parametric** (`/avatars/parametric-base.glb`): a bare humanoid built from the CC0 MakeHuman/MPFB2 body, baked with **306 identity morph sliders** by [scripts/build-parametric-base.mjs](../scripts/build-parametric-base.mjs). On this base the Sculpt tab becomes a full character creator, grouped into Eyes (42), Nose (36), Mouth (35), Ears (32), Head Shape (27), Torso (22), Legs (22), Cheeks (16), Hips & Midsection (17), Arms (15), Jaw (14), Body (12), Neck (10) and Brows (6). Face regions keep separate left and right sliders because facial asymmetry is part of a face; limbs get one symmetric slider, because a one-armed width edit reads as a defect rather than a look. It rides the same 52-bone Mixamo-named skeleton conventions as everything else, so the entire animation library retargets onto any slider combination. Source data and license provenance: [avatar-sources/anny/README.md](../avatar-sources/anny/README.md); the full contract for the base is [specs/PARAMETRIC_AVATAR.md](../specs/PARAMETRIC_AVATAR.md).

Every edit updates the live scene graph, and a working "appearance" object tracks the whole configuration: chosen colors, morph values, skeleton proportions, accessories, and hidden layers. That record is the avatar's parameter document, specified in [specs/AVATAR_PARAMETERS.md](../specs/AVATAR_PARAMETERS.md).

- **Color.** Material slots (skin, hair, outfit) each offer a curated swatch palette plus a full-spectrum picker (an `iro.js` wheel with hex entry and eyedropper, falling back to the native OS color dialog). Slots the loaded base has no materials for are hidden rather than rendered dead, and "Default" restores the base's authored color. Above them sit **Looks**: one-tap palettes (Noir, Sunset, Arctic, Cyber, Rosé, Forest, Mono, Ember) that theme skin, hair, and outfit together in a single history step, always landing on real, coherent material colors.
- **Face and body sculpt.** The sculpt panel renders grouped morph sliders against whatever morph targets the base carries, organized into Eyes, Brows, Nose, Mouth, Jaw, Cheeks, Ears, Head Shape, Neck, Torso, Hips & Midsection, Arms, Legs and Body, plus a MetaHuman-style 2-D face-type blend wheel over six archetypes and advanced visemes. Left/right paired morphs collapse into one mirrored slider unless you unlock Mirror L/R for asymmetry. It drives real morph targets, so the change is baked into the saved mesh.
- **Finding a slider among hundreds.** Past 80 sliders a filter box appears above the groups. Type `calf`, `cupids bow` or a raw morph name and the panel hides everything else, opening the groups that still have a match; clear it (or press Escape) and every group snaps back to exactly the open/closed state it had. Body-region groups start collapsed and each carries an "N edited" pill on its header, so a group you have already touched is obvious without opening it.
- **Free sculpt.** Above everything else sits a brush for the shapes no catalogue has: a dent in one temple, a crooked bridge, a brow ridge that is simply yours. Turn **Brush on**, then drag on the avatar to pull the surface out or push it in; dragging the background still orbits the camera, so you never lose the view. Size and Strength are real world measurements (centimetres and millimetres per stroke), the on-screen ring shows the brush's actual footprint at the current zoom, and Symmetry mirrors each stroke across the body's own centre line until you turn it off. Playback pauses while the brush is on so the mesh holds still under your cursor. The edit is recorded as its own morph target, which means it adds to the library sliders instead of fighting them, exports with the mesh, and comes back untouched when you re-open the avatar. **Clear sculpt** returns the body to exactly the catalogue shape.
- **Proportions.** Above the morph sliders sits a bone-level build panel: Height, Leg Length, Torso Length, Neck Length, Arm Length, Shoulder Width, Hip Width, Head Size, Hand Size, Foot Size. Morphs reshape a limb; these re-proportion the skeleton, which is the only way to actually lengthen one (a morph is a fixed set of vertex deltas, so pulling the hand further from the elbow would drag the skin off the bone driving it). Each slider is a ratio around the base body, shown as a signed percentage, and double-clicking resets it. Lengthen the legs and the hips ride up so the feet stay on the floor, and the animation library re-measures itself against the new hip height so the walk does not foot-slide. Only parameters the loaded rig has bones for are offered.
- **Accessories.** Hats, glasses, and earrings load from a preset catalog (`/accessories/presets.json`). Hovering a tile previews it live on the avatar; clicking commits it. Hats and glasses are single-slot; earrings stack. A chip row shows everything applied, each removable.
- **Wardrobe.** Two things stacked in one tab. The top half is the body's own garment layers (outfit, glasses, hair): recolour them, toggle each visible or hidden, or use the bulk "Start minimal" and "Dress fully" actions to strip to the base body and rebuild a look deliberately. The layers are resolved from whatever the loaded GLB actually contains rather than a hardcoded material list, so a third-party body still gets real controls. Beneath them is the **Closet**: catalog garments (tops, bottoms, footwear, outerwear, hair, headwear, glasses, accessories) that are downloaded and re-bound to *this* avatar's skeleton at runtime, so they move with every animation. Worn pieces occlude the skin underneath (pixel-exact on the Parametric base, which ships a baked UV region mask; bone-cull elsewhere), appear as removable chips beside the accessory chips, and are stored as `appearance.garments`. The garment contract is [specs/GARMENT_MANIFEST.md](../specs/GARMENT_MANIFEST.md).
- **Animate.** Load the shared canonical clip library and drive the rig live with 17 emotes (idle, waiting, chill, wave, cheer, celebrate, flex, jump, pray, blow kiss, taunt, dance, shuffle, rumba, thriller, capoeira). A looping emote becomes the avatar's resting idle and is baked in on save; one-shots play once and settle back to the current idle. This doubles as proof the avatar is fully rigged.
- **Walk.** Take the avatar for a walk without leaving the editor. It auto-walks a circle around the stage and you can drive it with WASD or the arrow keys, in any of the runtime's environments. Every sculpt, colour, garment and accessory edit shows up in motion immediately, which is where foot-slide, clipping and a garment that does not follow the hips actually become visible. In edit mode, **Open in Walk page** stashes the *unsaved* look as a short-lived draft and opens the full [/walk](https://three.ws/walk) page on it, so you review exactly what is on the stage rather than the last save. In create mode there is no saved record to build that draft from, so the panel says so instead of offering a button that would fail.
- **Rig** (edit mode only). Rig status for the loaded avatar plus one-click auto-rigging for a static mesh that has no skeleton and therefore cannot walk, wave, or emote. Rigging is non-destructive: it mints a new sibling avatar and opens the studio on it, leaving the original mesh untouched.
- **Randomize.** One button rolls a random swatch per color slot, a gentle draw on every proportion parameter, and a random hat and glasses, as a starting point. The proportion draw stays near neutral on purpose: two random avatars should read as different people, not different species.

The studio has 50-deep undo/redo, a dirty-state indicator in the title bar, and a draft autosave to local storage that is offered back if you leave and return (in create mode).

### Save

Saving takes one of two paths, and which one it takes matters.

**Creating a new avatar** exports the live Three.js scene via `GLTFExporter`, with colors, morphs and accessories already applied to the scene graph, so the resulting GLB is exactly what you saw. It runs through the shared optimize-and-validate path (geometry compression, `gltf-validator`), uploads to your account, and creates the avatar record. The appearance JSON is stored alongside as metadata so the avatar stays re-editable. Closet garments are the one exception: they are taken off the rig for the duration of the export and put straight back afterwards, because the appearance record carries them and the server bake replays them onto the base. Exporting a dressed body would apply every garment twice, onto a base you could never get back.

**Editing a saved avatar** does not export geometry at all. The record keeps its original, pristine base model and the server bakes the appearance onto it, so this is a metadata-only `PATCH` of `{ name, appearance }`. That is also why the base body cannot be switched while editing: a saved avatar owns its base.

## Walkthrough

1. Open [/avatar-studio](https://three.ws/avatar-studio). The base avatar loads and settles into an idle animation.
2. On the Color tab, tap a Look (say, Cyber) for an instant coherent palette, then fine-tune skin, hair, and outfit with the swatches or the rainbow chip's full picker.
3. Open the Face tab and sculpt: widen the jaw, adjust the nose, nudge body shape. Use the face-type wheel to blend archetypes.
4. Add a hat and glasses from their tabs; hover to preview, click to keep. Add earrings if you want.
5. On the Wardrobe tab, hide the base outfit and put on a shirt and boots from the closet, or leave the avatar in what it came with.
6. On the Animate tab, pick a looping emote (for example, Dance) to set the avatar's resting idle.
7. Open the Walk tab and drive the avatar around with WASD to check the outfit moves with it.
8. Name it and click Save. The studio exports, optimizes, uploads, and lands you with a saved avatar you can animate and dress elsewhere.

## Examples

Avatar Studio is an interactive builder; its examples are its entry points and the account API it saves through.

- **Create a new avatar:** [https://three.ws/avatar-studio](https://three.ws/avatar-studio) or [https://three.ws/create/studio](https://three.ws/create/studio)
- **Edit a saved avatar:** `https://three.ws/avatar-studio?edit=<avatarId>`: reloads that avatar's appearance and updates the existing record on save. Edit mode also adds the Rig tab and a **Play as this** button that saves and drops you into [/play](https://three.ws/play) wearing the avatar.
- **Arrive wearing something:** `https://three.ws/avatar-studio?edit=<avatarId>&equip-glb=<url>&equip-kind=hat&equip-name=Top%20hat` pre-applies an accessory GLB that is not in the preset catalog and marks the avatar unsaved, so a gallery "Equip" tile can hand off straight into the studio. `equip-kind` is `hat`, `glasses` or `earrings` (default `hat`); `equip-bone` overrides the attach bone (default `Head`). The avatar editor at `/avatars/<avatarId>/edit` accepts the identical parameters.

Fetching an avatar record (the same call the studio makes to load edit mode):

```bash
curl 'https://three.ws/api/avatars/<avatarId>' -H 'cookie: <session>'
# → { "avatar": { "id": "…", "name": "…", "model_url": "…", "appearance": { … } } }
```

## States & limits

- **No selfie, no camera.** This is the from-scratch path. To build an avatar from a photo, use the platform's selfie-to-avatar flow under [/create](https://three.ws/create) instead.
- **Two base bodies.** Create mode starts from the Stylized feminine base or the bare Parametric base (which covers masculine, feminine, and everything between via its body sliders). Switching base reloads the studio, so it asks before discarding unsaved changes. The posable primitive with a build toggle lives in [Animation Studio](./animation-studio.md).
- **The Parametric base ships bare.** No hair or outfit meshes yet, so the hair/outfit color slots and the Layers block do not appear on it; hats, glasses, and earrings attach normally. Conforming hair and garments are the next phase (`slots` under Reserved in [specs/PARAMETRIC_AVATAR.md](../specs/PARAMETRIC_AVATAR.md)).
- **Free sculpt is tied to the body it was painted on.** Strokes are stored as vertex deltas against a specific topology, so a sculpt made on the Parametric base does not transfer to a differently built mesh; the record notes which mesh it belongs to and is skipped rather than force-fitted anywhere else.
- **Sculpt depends on the base's morphs.** The face/body sliders render against whatever morph targets the base GLB exposes; a slot with no matching morph simply does not appear. Proportions are independent of morphs: they need only a canonical humanoid skeleton, so they work on a rig with no blendshapes at all. Height is the one parameter that needs an armature node above the hips, and is hidden on rigs whose hips sit directly in the scene.
- **Save requires an account.** Export happens client-side, but persisting the avatar to your library needs sign-in. Optimization is best-effort: if compression fails, the original export is saved untouched so the save always completes.
- **What you see is what you save.** Because the save exports the live scene graph, the stored GLB matches the viewport exactly, colors, morphs, accessories, and the chosen idle included.
- **The Rig and Play tabs need a saved avatar.** Auto-rigging posts the avatar's id to the regenerate backend and the /walk handoff presigns that avatar's private base GLB, so neither exists for an unsaved draft. The Rig tab is hidden in create mode and the Walk tab swaps its handoff button for the reason.
- **A garment needs a humanoid skeleton to bind to.** The closet refuses a piece it cannot rebind rather than attaching it mangled, and a retired catalog id degrades to "not worn" on load instead of failing the whole avatar. Re-dressing a saved outfit runs alongside the boot rather than blocking it, so the avatar is live and animating while the pieces land.
- **Drafts are local.** Unsaved work autosaves to local storage in create mode and is offered back on return; edit mode does not autosave a draft over the saved avatar.

## Related

- [Animation Studio](./animation-studio.md): pose and keyframe the avatar you build here.
- [Scene Composer](./compose.md): forge props and attach them to the avatar's bones as a saved outfit.
- [Mocap Studio](./mocap-studio.md): drive the avatar's face live from your webcam.
- [Restyle Studio](./restyle.md): shares the same GLB optimize-and-validate path.
- [Trait-based avatar builder](./character-studio.md): the separate VRM studio embedded in the agent editor; a deep dive into its internals.
- [/create](https://three.ws/create): the hub for every avatar-creation path, including selfie-to-avatar.
~~~~

