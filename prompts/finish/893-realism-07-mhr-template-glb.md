# Build an MHR avatar template GLB with our skeleton names, ARKit-52, visemes and self-describing reconstruction metadata

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4893** (`npx vite --port 4893 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

MHR (Meta's Momentum Human Rig, Apache-2.0 including weights) is a production parametric human. It has 45 identity shape parameters (20 body, 20 head, 5 hands), a full-body skeleton with articulated hands, pose correctives and seven LODs. It is the first body model at this quality that three.ws can ship commercially. SAM 3D Body predicts MHR parameters straight from a photo (order 895). So an MHR template is the base that photo-driven head and body shape (order 896) builds on, and the shape space a future Avatar Studio body slider would drive. This order builds the template GLB and nothing else. It must drop into the existing pipeline the same way `parametric.glb` did.

## Current state (measured 2026-11-21; re-verify)

- MHR: `facebookresearch/MHR` on GitHub, pip `mhr==1.0.1`. The release zip (198,943,157 bytes) contains `lod0.fbx` to `lod6.fbx`, `mhr_model.pt` (696 MB), `corrective_blendshapes_lod*.npz` (LOD0 is 2.6 GB) and `LICENSE.txt` (Apache-2.0). 204 model parameters, 72 expression parameters.
- The house recipe for a template is `scripts/build-reconstruction-template.mjs`, which builds `workers/avatar-reconstruction/templates/parametric.glb` from the Anny base. It splits a separate `Head` mesh at the Head+Neck skin-weight region with welded normals. It transfers the 52 ARKit shapes from ICT-FaceKit (MIT) with `scripts/build-ict-expression-targets.py` and composes the 15 Oculus visemes with the runtime recipes (`src/voice/arkit-blendshapes.js` `OCULUS_TO_ARKIT`). It uses one textured skin material shared by Head and Body, and a textured eye material with its iris layout in extras. It stores body-type presets (male, female, neutral) with re-solved joints and floor offset. Everything the worker needs goes in root `extras.reconstruction`. Read the whole script before you start.
- Animation: `src/glb-canonicalize.js` maps foreign bone names onto the canonical rig, and there is no rig allowlist (see `docs/ops/worker-and-avatar-rules.md`). `src/animation-manager.js` plays the canonical clip library.
- Wardrobe: hair and outfits come from the garment system (`src/avatar-wardrobe.js`, `scripts/verify-garment.mjs`, `scripts/garment-rig-bakeoff.mjs`). The parametric template ships with no hair (`hair: null`).
- Material classification for the render realism orders uses the regexes in `src/shared/avatar-material-realism.js`.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
sed -n 1,400p scripts/build-reconstruction-template.mjs
sed -n 1,60p scripts/build-ict-expression-targets.py
sed -n 1,140p workers/avatar-reconstruction/recon_templates.py
sed -n 1,80p workers/avatar-reconstruction/test_parametric_template.py
sed -n 1,80p src/glb-canonicalize.js
cat docs/ops/worker-and-avatar-rules.md
grep -n "SKIN_NAME_RE\|EYE_NAME_RE\|HAIR_NAME_RE\|TEETH_NAME_RE" src/shared/avatar-material-realism.js
gh api repos/facebookresearch/MHR/releases --jq '.[0] | {tag_name, assets: [.assets[] | {name, size, browser_download_url}]}'
pip index versions mhr 2>/dev/null | head -2
ls workers/avatar-reconstruction/templates/ | grep -i mhr
```

## Tasks

1. **Fetch and pin the source.** Write `scripts/fetch-mhr-assets.mjs`. It downloads the MHR release zip into a gitignored cache (`.cache/mhr/` or the repo's existing asset-cache convention) and verifies its size and a SHA-256 you record in the script. It extracts only what the build needs and copies `LICENSE.txt` next to the output. Downloaded archives are untrusted: extract into a fresh directory and never run anything from it.
2. **Choose the web LOD by measurement.** Load each LOD and report vertex count, face count, whether UVs exist, and how far the skeleton and skin weights differ across LODs. Pick the LOD that keeps a recognisable face (nasolabial fold, lids, ears) at a web budget (target 15k to 30k vertices for the whole body, head included) and record the table in the doc. If no LOD has usable UVs, generate them with xatlas (MIT; `xatlas-python` or `xatlas-wasm`), and give the head its own island with a front-facing face layout that `precompute_uv.py` can map MediaPipe onto.
3. **Build script** `scripts/build-mhr-template.mjs`, plus a Python helper only where MHR's own tooling requires it (`mhr` pip package to evaluate the shape space and correctives). It writes `workers/avatar-reconstruction/templates/mhr.glb`, following the parametric recipe step by step:
   - Skeleton: rename joints to the canonical names `src/glb-canonicalize.js` expects. Add the mapping to `glb-canonicalize.js` if any MHR joint is new. Keep the finger joints. Drop or merge helper joints that the canonical clips never drive, and only when their weights can be folded into a parent without visible loss (prove this with a pose test).
   - A separate `Head` mesh split at the Head and Neck weight region with welded normals, exactly like parametric. The remaining body is `Body`.
   - ARKit-52 plus 15 visemes on the head, eyes, teeth and tongue. Default path: transfer from ICT-FaceKit with `scripts/build-ict-expression-targets.py`, extended for MHR topology. Only if MHR's own 72-parameter expression model maps onto ARKit semantics with a fit you measure (per-shape error table in the doc) may you use it instead. The visemes are composed with `OCULUS_TO_ARKIT`, never invented.
   - Identity shape space: store the 45 MHR shape parameter names and ranges in `extras.reconstruction.mhr`. Where glTF allows, bake the head and body shape basis as morph targets (or as a sidecar `.bin` the worker loads, if baking all 45 is too heavy). The worker (orders 894 and 896) must be able to apply a shape vector without the 696 MB `mhr_model.pt`. Prove it with a test that compares a shape applied from the GLB data against `mhr`'s own forward pass, with max vertex error under 0.5 mm.
   - Pose correctives: glTF has no pose-space deformers. Measure the visual difference with correctives on and off at shoulders, elbows, hips and knees across the canonical clips. If artifacts are visible, ship the correctives as morph targets plus a small runtime driver module in `src/` that sets their weights from joint rotations (hooked into `animation-manager.js` minimally and unit-tested). If they are invisible at web LOD, say so in the doc with the screenshots that prove it.
   - Materials named to match the realism regexes (for example `MHR_Skin`, `MHR_Eyes`, `MHR_Teeth`), one skin material shared by Head and Body with a neutral albedo texture the worker paints into, and an eye material with iris layout extras.
   - Body-type presets (male, female, neutral) as MHR shape vectors with re-solved joints and floor offset, stored exactly where `glb_ops.bake_body_type` reads them.
   - Face anchors for `precompute_uv.py` (`uv_alignment="anchors"`), plus `extras.reconstruction` fully filled in, mirroring parametric.
   - Meshopt or Draco compression following the repo's GLB conventions (workers must decode before reading, per the worker rules doc).
4. **NOTICE:** ship `workers/avatar-reconstruction/templates/mhr.NOTICE` with the Apache-2.0 attribution and the source URL and version. Reference it from `docs/realism/licences.md` (create it if 887 has not).
5. **Tests** in `workers/avatar-reconstruction/test_mhr_template.py`, mirroring `test_parametric_template.py`: the Head mesh exists and is separate, all 52 ARKit plus 15 viseme targets are on Head, material names match `recon_templates` expectations, extras are complete, body-type presets bake, the shape-vector application is accurate, and the build is deterministic (the same input produces the same GLB hash).
6. **Viewer and animation proof.** Load `mhr.glb` in the viewer on your dev port. Play at least idle, walk, wave and a talking clip with visemes through `animation-manager.js`. Confirm the hands and face animate and there is no candy-wrapper twisting. Attach a hair item and an outfit from the wardrobe catalog with `scripts/verify-garment.mjs` (or the wardrobe UI) and confirm they fit at least as well as on parametric. Fix the skeleton mapping until they do. Take screenshots for the doc.
7. **Do not register the template in the worker.** That is order 894. This order ships the GLB, its build, its tests and its docs only. If 894 has already landed on disk, run its tests against your GLB and fix any mismatch here.
8. **Docs:** `docs/realism/mhr-template.md` covers source, licence, LOD table, how to rebuild (`node scripts/fetch-mhr-assets.mjs && node scripts/build-mhr-template.mjs && python workers/avatar-reconstruction/precompute_uv.py --template mhr` once 894 adds the key), the expression and corrective choices with evidence, and the shape parameter table. Update `workers/avatar-reconstruction/README.md` (templates section) and add a changelog entry.

## Definition of done

- [ ] `node scripts/fetch-mhr-assets.mjs && node scripts/build-mhr-template.mjs` reproduces `templates/mhr.glb` byte-identically from a clean cache.
- [ ] `pytest workers/avatar-reconstruction/test_mhr_template.py` passes. The existing `test_parametric_template.py` still passes.
- [ ] The shape vector applied from GLB data matches the `mhr` forward pass within 0.5 mm (test output in the report).
- [ ] In the viewer the template plays idle, walk, wave and talk with visemes, the hands and face animate, and wardrobe hair and an outfit attach (screenshots in `docs/realism/img/`).
- [ ] The NOTICE is shipped, licences are recorded, and nothing from the SMPL family or the MHR to SMPL converter is used (`grep -rn "smpl" -i` over your diff is empty).
- [ ] Docs, README, changelog, `npm run build:pages`, `npm run audit:docs`, and `npm run check:vendored` (if you touched any vendored worker module) pass.

## Never blocked

- The 2.6 GB LOD0 corrective file does not fit comfortably on the root disk. Work in `/home/user/.cache/` (the root overlay is about 99% full), or run the heavy build step in Cloud Build and commit only the output GLB and build script.
- If `mhr` needs a GPU for its forward pass, it runs on CPU too, just slowly. Use CPU locally or a Cloud Build step. Never skip the accuracy test.
- If the ICT transfer script assumes Anny topology, generalise it with a topology-agnostic correspondence (non-rigid ICP or landmark-anchored RBF, both already used in the repo if `grep -rn "rbf\|icp" scripts workers | head` hits). Never hand-sculpt shapes.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/893-realism-07-mhr-template-glb.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `893-realism-07-mhr-template-glb.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
