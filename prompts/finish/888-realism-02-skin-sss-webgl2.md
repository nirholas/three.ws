# Give avatar skin true screen-space subsurface scattering on the default WebGL2 path

## How to run

Paste this whole file into a fresh Claude Code chat opened at `/home/user/three.ws`. It is self-contained: it needs no other chat and no input from the owner until the final report. If it names a prerequisite order that has not landed yet, this same session does that order first (its file says how), so nothing ever waits on another session. Read `prompts/finish/_context/realism-00-CONTEXT.md` (the campaign facts, licence table, shared realism option, hot files and deploy policy) before Step 0.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Licences are a hard gate: only what the licence table in the context file allows ships. Never vendor FLAME, BFM, SMPL, SMPL-X, MANO or anything trained on them.
- Solana is the home chain and leads every design. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`. If a credential, quota, database or test blocker appears, load `.claude/skills/self-unblock-playbook/SKILL.md` before considering any stop.

## Running alongside other sessions

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4888** (`npx vite --port 4888 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Skin looks plastic when light does not bleed under the surface. That is the biggest single cue that separates a game avatar from a believable person. Today `src/shared/avatar-material-realism.js` fakes scattering with a sheen layer (`sheen 0.35`). Separable screen-space subsurface scattering (Jimenez et al., "Separable Subsurface Scattering", 2015) is the standard real-time fix in shipping engines. It blurs only the diffuse light on skin pixels along a measured skin diffusion profile, so ears, nostrils and lips glow red when backlit and pores soften. It runs as one post pass, so it helps every avatar three.ws loads, not just new ones.

## Current state (measured 2026-11-21; re-verify)

- `src/viewer.js` (around line 1721, "Skin/eye/hair realism pass") calls `applyAvatarMaterialRealism(object)` when `looksLikeAvatarMesh(object)` is true, then `this._nodeLib.convertMaterials(object)` on WebGPU.
- `src/shared/avatar-material-realism.js` (178 lines) classifies materials with `SKIN_NAME_RE`, `WOLF3D_SKIN_RE` (`wolf3d_skin|wolf3d_body|wolf3d_head`), `EYE_NAME_RE`, `HAIR_NAME_RE` and `TEETH_NAME_RE`. `applySkin` sets roughness 0.45 to 0.6, sheen 0.35 and specularIntensity 0.6. The test is `tests/avatar-material-realism.test.js`. `src/irl.js` also imports it.
- `src/viewer/cinematic.js` (`CinematicPipeline`, 271 lines) is always built by `src/viewer.js` (`_cinematic`, around line 1000). It uses the `postprocessing` library: `RenderPass`, an n8ao `N8AOPostPass` inserted at index 1, DoF `EffectPass`, bloom `EffectPass`, and a final grade `EffectPass`. It takes a `lowPower` flag (`viewerLooksLowPower()`), which lowers MSAA and AO quality.
- WebGL2 is the default renderer. WebGPU (`?renderer=webgpu`) is order 889's job.
- There is no subsurface scattering anywhere in `src/`.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls src/shared/realism/ 2>/dev/null && cat src/shared/realism/*.js   # sibling orders may have created the shared option and skin mask
grep -rn "subsurface\|SSS\|sss" src --include=*.js | grep -v node_modules | head
sed -n 1,140p src/viewer/cinematic.js
sed -n 1,178p src/shared/avatar-material-realism.js
grep -n "applyAvatarMaterialRealism\|looksLikeAvatarMesh\|viewerLooksLowPower" src/viewer.js
grep -n "\"postprocessing\"\|\"n8ao\"\|\"three\"" package.json
head -60 scripts/viewer-renderer-bench.mjs
```

## Tasks

1. **Shared plumbing (create it if no sibling did, otherwise reuse it).** Write `src/shared/realism/options.js` (`resolveRealismOptions`, exactly as the context file specifies) and `src/shared/realism/skin-mask.js`. The skin mask module imports the classification regexes from `avatar-material-realism.js`. Export them there if they are not exported yet, which is a one-line hot-file change. It exposes `isSkinMaterial(material, mesh)`, `isEyeMaterial`, `isHairMaterial`, plus a way to tag skin materials so a render pass can isolate skin pixels. Unit-test both modules.
2. **Skin mask render target.** Produce a per-pixel mask of skin, with the scattering width encoded per material if you can do it cleanly. Two acceptable designs, so pick by measured cost: (a) a cheap second render of skin meshes only, using an override material into a half-resolution target that shares the main depth buffer, or (b) writing the mask into the stencil buffer during the main pass. Avoid re-rendering the whole scene. Handle `SkinnedMesh` and morph targets in the override material, because the mask must deform with the avatar.
3. **Separable SSS pass** in `src/shared/realism/skin-sss.js`, as a `postprocessing` `Effect` or `Pass` inserted right after the render pass and AO, before DoF and bloom. Use two blur passes (horizontal and vertical) with a 6 to 7 tap kernel fitted to a measured skin diffusion profile (the Jimenez 2015 kernel or d'Eon's sum-of-Gaussians skin profile). Make the kernel width depend on depth, so scattering stays constant in world space, using the camera's projection and the linear depth. Reject samples across depth discontinuities, so the blur never leaks onto the background or across the jawline into the neck behind it. Apply it only where the skin mask is set. Ideally scatter only the diffuse lighting and keep the specular sharp. If isolating diffuse needs a material change, add it in the material pass for skin only and document the cost.
4. **Material side.** When SSS is active, `applySkin` must not stack the sheen stand-in on top of real scattering. Lower or remove the sheen for masked skin, and keep today's exact values when SSS is off. `tests/avatar-material-realism.test.js` must still pass unchanged, so add new tests for the SSS-on branch instead of editing the old ones.
5. **Wire it** (hot files last): construct the pass from `CinematicPipeline` when `resolveRealismOptions(...).sss` is true. Plumb `options.realism` from the Viewer constructor and the `realism` attribute from `src/element.js` (`<agent-3d realism="off">`), unless a sibling has already done so. When `lowPower` is true, SSS is off unless explicitly forced. Handle resize, dispose and preset changes (`applyPreset`). Leave no GPU resources behind when the avatar is swapped.
6. **Translucency for thin features (backlit ears).** Add a cheap transmittance term on skin, using thickness from a baked map if the GLB has one, or a view-dependent wrap term. Gate it behind the same `sss` key so backlit ears read red.
7. **Measure and show.** Run `scripts/viewer-renderer-bench.mjs` on the default avatar with SSS on and off. Record frame time and the delta in `docs/realism/skin-sss.md`. The SSS share of the campaign budget is at most 8% frame time on WebGL2. Save before and after screenshots (same avatar, camera and three-point lighting, plus one backlit shot) under `docs/realism/img/`. The doc explains the technique, the options, the low-power fallback and how to turn it off.
8. **Docs and changelog:** link `docs/realism/skin-sss.md` from the viewer docs (`grep -rln "cinematic" docs | head`) and the `<agent-3d>` attribute reference. Add a `data/changelog.json` entry, then run `npm run build:pages`.

## Definition of done

- [ ] On your dev port, the default avatar shows visible scattering (soft red falloff at the terminator, glowing backlit ears), with before and after screenshots committed under `docs/realism/img/`.
- [ ] `<agent-3d realism="off">` and low-power mode render exactly as before (pixel diff or a side-by-side screenshot shows no change).
- [ ] No halo on the background or hair at silhouette edges (zoomed screenshot).
- [ ] The bench shows the SSS frame-time delta at or under 8%, with the numbers in the doc.
- [ ] New unit tests for `options.js`, `skin-mask.js` and the SSS-on material branch pass. `tests/avatar-material-realism.test.js` is unchanged and passing. `npm run test:core` (or the suite named in `package.json`) shows no new failures.
- [ ] No console errors or warnings from your code. Resize, avatar swap and preset changes leak nothing (check `renderer.info.memory` before and after five swaps).
- [ ] Docs, changelog and `build:pages` done.

## Never blocked

- If the `postprocessing` `Effect` API cannot express a two-pass blur cleanly, write a custom `Pass` subclass. Both are supported by the library already in `package.json`.
- If headless Chromium (swiftshader) cannot run the bench, use the GPU path documented in memory (`play-browser-verify-without-world`, `playwright-system-libs-lost-on-restart`), or run the bench in Cloud Build with a GPU. Never skip the measurement.
- If n8ao's insertion index changes, insert relative to the render pass by reference, not by a magic index.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/888-realism-02-skin-sss-webgl2.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `888-realism-02-skin-sss-webgl2.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
