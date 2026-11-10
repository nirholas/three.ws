# Selfie reconstruction fits onto the owned parametric body and body_type becomes real sliders

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/712-plan-avatar-parametric-body-type-reconstruction.md`.

**Priority:** P2, new capability with clear value (score 58 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The selfie to avatar worker still fits every person onto a third-party Wolf3D template (`workers/avatar-reconstruction/templates/default.glb`), the last non-owned asset in the pipeline. The repo already ships a CC0 parametric body (`public/avatars/parametric-base.glb`, 122 baked morph sliders on a 52-bone `mixamorig:*` skeleton, built by `scripts/build-parametric-base.mjs`), but reconstruction does not use it. Separately, `POST /reconstruct` accepts `body_type: male|female|neutral` and the selfie modal offers Masc/Femme (`src/selfie-modal.js`), yet `face_pipeline._load_template` looks for `templates/male.glb` and `templates/female.glb`, which do not exist, so the choice has never changed anything. Moving reconstruction onto the parametric body removes the template dependency and turns body type into slider values on one mesh.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/avatar-reconstruction/templates/` holds only `default.glb` and `cz.glb`. `face_pipeline._load_template` (line ~514) falls back to `default.glb` for every body_type.
- `public/avatars/parametric-base.glb` exists: meshes Body (306 morph targets on the primitive list), Eyes, Teeth, Tongue; 52 joints. No Wolf3D_* mesh names, no ARKit-52 or viseme morphs, no `Wolf3D_Skin` material.
- `workers/avatar-reconstruction/face_uv_map.json` is precomputed by `precompute_uv.py` against `default.glb` only (MediaPipe canonical landmark to nearest Wolf3D_Head vertex).
- Pipeline code addresses the template by name: `Wolf3D_Head`, `Wolf3D_Skin`, `Wolf3D_Hair`, `Wolf3D_Eye` (`face_pipeline.py`, `face_geometry.py`, `face_projection.py`, `glb_ops.py`).
- Measurement harness exists: `workers/avatar-reconstruction/eval/{run_eval,identity_eval,make_refs,robustness,measure_projection_coverage}.py`, 40-face reference set mirrored to `gs://three-ws-avatar-reconstructions/eval-refs/`. Scores are only comparable within one template, so a new baseline is required.
- Unit tests: `test_face_geometry.py`, `test_face_pipeline.py`, `test_face_projection.py`, `eval/test_identity_eval.py`, `smoke_test.py`. API-side: `tests/avatars-reconstruct.test.js`.
- No ICT-FaceKit data is vendored; the Anny base does not ship visemes.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
ls workers/avatar-reconstruction/templates
sed -n 505,540p workers/avatar-reconstruction/face_pipeline.py
grep -rn "body_type\|bodyType" workers/avatar-reconstruction/*.py src/selfie-modal.js api/_providers/gcp.js
node -e "const {NodeIO}=require('@gltf-transform/core');(async()=>{const d=await new NodeIO().read('public/avatars/parametric-base.glb');for(const m of d.getRoot().listMeshes())console.log(m.getName(),m.listPrimitives()[0].listTargets().length)})()"
ls workers/avatar-reconstruction/eval/reports 2>/dev/null
git log --oneline -5 -- workers/avatar-reconstruction/templates
```

If a `templates/parametric*.glb` plus a matching UV map already exists, or `body_type` already changes the output, re-scope to what is missing.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Reproduce the dead path first (test-first): in `workers/avatar-reconstruction/test_face_pipeline.py` add a test that runs the template loader for `male`, `female`, `neutral` and asserts the three outputs are distinguishable (different bytes or different applied slider set). Run it and confirm it fails because all three resolve to `default.glb`.
2. Build the reconstruction template from the owned body. Extend `scripts/build-parametric-base.mjs` (or add `scripts/build-reconstruction-template.mjs`) to emit `workers/avatar-reconstruction/templates/parametric.glb`: the parametric body with a head mesh that carries the 52 ARKit blendshapes and the 15 visemes. Transfer ARKit-52 from vendored ICT-FaceKit (MIT) by deformation transfer; vendor ICT-FaceKit under `avatar-sources/ict-facekit/` with its LICENSE and a README. Name the head mesh and skin/hair/eye materials so the pipeline addresses them without any `Wolf3D_` string, or introduce a `TemplateSpec` (head prim name, skin/hair/eye material names, UV map path) in `face_pipeline.py` and select by template.
3. Make `precompute_uv.py` take the template path and output path as arguments (it is already described as parameterised) and generate `face_uv_map.parametric.json` against the new head. Make `_find_head_prim` and every `Wolf3D_*` literal come from the `TemplateSpec`, keeping `default.glb` working until the cutover is verified.
4. Replace the body_type template swap with slider values: `male|female|neutral` map to gender, muscle, weight, height, hips slider settings applied via `glb_ops` morph weights (baked into the output GLB so the avatar still exposes the sculpt sliders in Avatar Studio). Keep the API field name and values unchanged.
5. Add `face_geometry` support for the new head vertex count and run the identity morph, yaw gate (`MAX_MORPH_YAW_DEG`) and projective texturing (`face_projection.py`) against it. Add tests beside the existing ones: head vertex count/order preserved, all 52 ARKit and 15 viseme morphs present, `body_type` produces three distinct outputs, the surface the landmarks sit on faces the camera (the absolute sign test already in `test_face_projection.py`).
6. Re-baseline: run `python -m eval.run_eval` for both templates over the 40-face set, write `eval/reports/` JSON for the parametric template, and compare with `--compare`. Record template floor, mean ISE and improvement in `docs/avatar-fidelity-program.md` Track 5 (replace "roadmap entry is out of date" prose with measured results). Do not claim parity or improvement without the report.
7. Cutover gate in code: add an env switch `RECON_TEMPLATE` (`wolf3d` default, `parametric`) so the deploy can be flipped by `gcloud run services update --update-env-vars`. Only change the default to `parametric` if mean ISE improvement is not worse than the Wolf3D baseline and `smoke_test.py` passes; otherwise leave the default and say why in the doc.
8. Update `workers/avatar-reconstruction/README.md`, `docs/avatar-reconstruction.md` (roadmap table: mark v3 body shipped or in-flight), and add a `data/changelog.json` entry. Update the Dockerfile so the new template and UV map ship in the image; build with `cloudbuild.yaml` only to a staging tag unless the owner approved a deploy.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd workers/avatar-reconstruction && python -m pytest -q` passes, including the new body_type distinctness test, which failed before the fix.
- [ ] `python -m eval.run_eval` produces a report for the parametric template and `--compare` against the Wolf3D report is pasted into `docs/avatar-fidelity-program.md`.
- [ ] `ls workers/avatar-reconstruction/templates` shows the parametric template and `face_uv_map.parametric.json` exists; `grep -n "male.glb\|female.glb" workers/avatar-reconstruction/face_pipeline.py` returns nothing.
- [ ] A reconstruction of at least 3 reference faces with `body_type` male, female, neutral loads in `/viewer` with morph sliders visible and no console errors.
- [ ] `node --test tests/avatars-reconstruct.test.js` (or `npx vitest run tests/avatars-reconstruct.test.js`) still passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| ICT-FaceKit data cannot be downloaded in the sandbox | Fetch the MIT-licensed release from its GitHub repo into `avatar-sources/ict-facekit/`, or derive the ARKit-52 set from the vendored Anny targets plus the existing Wolf3D blendshape deltas by deformation transfer; document the source either way. |
| GPU not needed here | The worker is CPU-only (docs/ops/gcp-credits-plan.md); run the eval locally on CPU. |
| Production cutover needs a deploy | Leave the env switch on `wolf3d`, ship the code, and state the one `gcloud run services update --update-env-vars RECON_TEMPLATE=parametric` command in the report. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/712-plan-avatar-parametric-body-type-reconstruction.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `712-plan-avatar-parametric-body-type-reconstruction.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/avatar-fidelity-program.md`
- `docs/avatar-reconstruction.md`
