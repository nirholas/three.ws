# Bring skin subsurface scattering to the WebGPU (TSL) renderer at parity with WebGL2

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4889** (`npx vite --port 4889 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

WebGPU is where three.ws's renderer is heading (`?renderer=webgpu`, `<agent-3d renderer="webgpu">`, `src/renderer-factory.js`). A realism feature that exists only on WebGL2 means an avatar looks worse on the faster path, and that blocks the default from ever moving to WebGPU. three.js r187 ships TSL nodes that make SSS on WebGPU practical, including a subsurface model on node materials and a full post chain in `RenderPipeline`.

## Current state (measured 2026-11-21; re-verify)

- `src/viewer.js` (around line 243) lazy-loads `three/webgpu`, `CinematicPipelineTSL` (`src/viewer/cinematic-tsl.js`, 340 lines) and `convertForNodeRenderer` from `src/render/webgpu-material-compat.js` when the renderer is WebGPU. After the realism pass it calls `this._nodeLib.convertMaterials(object)`.
- `CinematicPipelineTSL` builds a `RenderPipeline` from `pass(scene, camera, { samples: lowPower ? 0 : 4 })` (around line 259) with `GTAONode` AO, `DepthOfFieldNode` and `BloomNode`.
- There is no SSS on either path unless order 888 has landed. Check `src/shared/realism/`.
- three is `^0.187.0`. Check what TSL offers in the installed version: `MeshSSSNodeMaterial` (the examples/webgpu SSS material with thickness, distortion, ambient, attenuation and power uniforms), and whether `MeshPhysicalNodeMaterial` exposes something similar.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls src/shared/realism/ 2>/dev/null && cat src/shared/realism/*.js
grep -n "\"version\"" node_modules/three/package.json
grep -rln "MeshSSSNodeMaterial" node_modules/three/src | head
grep -n "export" node_modules/three/src/materials/nodes/MeshSSSNodeMaterial.js 2>/dev/null
sed -n 230,340p src/viewer/cinematic-tsl.js
sed -n 1,120p src/render/webgpu-material-compat.js
grep -n "realism\|sss" src/viewer.js src/element.js | head
```

## Tasks

1. **Shared plumbing.** If `src/shared/realism/options.js` and `skin-mask.js` exist (from 888), import them. If not, create them exactly as the context file specifies, with unit tests. The first order to land owns them.
2. **Material path** in `src/shared/realism/skin-sss-tsl.js`. When `webgpu-material-compat.js` converts a skin material (`isSkinMaterial`), produce a node material that does SSS: `MeshSSSNodeMaterial` if the installed three exports it, otherwise an equivalent subsurface term written in TSL on `MeshPhysicalNodeMaterial`. Carry over every map and parameter the WebGL2 material had (base color, normal, roughness, specular intensity, morph targets, skinning). Tune the thickness, distortion and attenuation uniforms to match skin, and drive thickness from a baked map when the GLB carries one.
3. **Screen-space blur on the post side** if the material term alone cannot match 888's softening: add a depth-aware separable blur node over the skin mask in the `CinematicPipelineTSL` graph, after the scene pass and before DoF. Use the same kernel and profile as 888, so both renderers look the same. If 888 has landed, import its kernel constants rather than duplicating them.
4. **Parity check.** Render the same avatar, camera and lights on WebGL2 (with 888's SSS) and on WebGPU. Compare them side by side. Skin tone, scatter width and the backlit-ear response should match closely. If 888 has not landed, compare against the reference images in `docs/realism/img/` if they exist, otherwise against the physically expected look described in the Jimenez paper, and say so in the report.
5. **Wire it** (hot files last): hook into `webgpu-material-compat.js` and `cinematic-tsl.js` behind `resolveRealismOptions(...).sss`, with the same low-power rule and the same `realism="off"` behaviour as WebGL2. Dispose cleanly on avatar swap.
6. **Measure:** run `scripts/viewer-renderer-bench.mjs` with `?renderer=webgpu`, SSS on and off. Record the numbers in `docs/realism/skin-sss.md`. Create a WebGPU section if 888 made the file, or create the file with both sections if not. The budget is the same 8%.
7. **Docs and changelog:** document the WebGPU path in the same doc, then add a changelog entry and run `npm run build:pages`.

## Definition of done

- [ ] With `?renderer=webgpu` on your dev port, the default avatar shows skin scattering visually at parity with WebGL2 (side-by-side screenshot committed under `docs/realism/img/`).
- [ ] `realism="off"` and low-power on WebGPU render exactly as before.
- [ ] Skinning and morph targets (blink, visemes) still animate on converted skin materials (play an expression clip and confirm).
- [ ] The bench delta on WebGPU is at or under 8%, recorded in the doc.
- [ ] Unit tests for the conversion branch pass. `npm run test:core` shows no new failures. No console errors or warnings from your code, and no WebGPU validation errors in the console.
- [ ] Docs, changelog and `build:pages` done.

## Never blocked

- If the headless browser has no WebGPU adapter, launch Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan` and a GPU-backed runner, or run the bench through Cloud Build with a GPU. Never skip the WebGPU check.
- If `MeshSSSNodeMaterial` does not exist in the installed three, implement the subsurface term in TSL. Do not upgrade three just for this unless the upgrade passes the whole test suite in the same session.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/889-realism-03-skin-sss-webgpu.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `889-realism-03-skin-sss-webgpu.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
