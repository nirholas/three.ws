# Register MHR as a selfie-reconstruction template (RECON_TEMPLATE=mhr) and verify it on staging

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4894** (`npx vite --port 4894 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Selfie reconstruction paints the user's face onto a template and reshapes the head. The template sets the ceiling on realism: topology, face resolution, rig and expressions. Production runs the wolf3d template, and the owned `parametric` (Anny) template is built but switched off. An MHR template gives a production-grade head and body with an identity shape space that order 896 can fit from photos. This order makes `RECON_TEMPLATE=mhr` a first-class, tested, staged option. It does not flip production.

## Prerequisite

Order 893 (`893-realism-07-mhr-template-glb.md`) builds `workers/avatar-reconstruction/templates/mhr.glb`. Step 0 checks for it. If the GLB or its line in `prompts/finish/_context/realism-PROGRESS.md` is missing, open `prompts/finish/893-realism-07-mhr-template-glb.md` and do all of it first, including its close-out, then continue here. Never run this order while another session is running 893.

## Current state (measured 2026-11-21; re-verify)

- `workers/avatar-reconstruction/recon_templates.py` holds `TemplateSpec` entries `WOLF3D` (`default.glb`, `face_uv_map.json`, `uv_alignment="unit_cube"`) and `PARAMETRIC` (`parametric.glb`, `face_uv_map.parametric.json`, `uv_alignment="anchors"`, `eye_mode="iris_texture"`). `RECON_TEMPLATE` picks one at call time, and an unknown value fails the boot (`main.py` around line 75).
- The pipeline modules are `face_pipeline.py`, `face_geometry.py` (MediaPipe 468-landmark morph diffused over the head), `face_projection.py`, `dense_fit.py` (analysis-by-synthesis displacement, pinned by `test_dense_fit.py`, which keeps vertex count, order and ARKit targets valid), `glb_ops.py` (`set_head_geometry`, `bake_body_type`), `precompute_uv.py --template <key>`, `view_texture.py` and `view_synthesis.py`.
- Staging: `workers/avatar-reconstruction/cloudbuild.staging.yaml` deploys `avatar-reconstruction-dense-staging`. Production `GCP_RECONSTRUCTION_URL` points directly at `avatar-reconstruction` (not the controller) with wolf3d.
- Likeness eval: `node --env-file=.env scripts/likeness-eval.mjs --live=10 --out=reports/likeness.json` (QA account, synthesised subjects, gate 4.0). Read its header to see how it targets a worker URL or template.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls -la workers/avatar-reconstruction/templates/; grep -n "893" prompts/finish/_context/realism-PROGRESS.md 2>/dev/null
cat workers/avatar-reconstruction/recon_templates.py
grep -n "template\|TEMPLATE\|spec\." workers/avatar-reconstruction/face_pipeline.py workers/avatar-reconstruction/main.py | head -60
sed -n 1,60p workers/avatar-reconstruction/precompute_uv.py
cat workers/avatar-reconstruction/cloudbuild.staging.yaml
sed -n 1,60p scripts/likeness-eval.mjs
cd workers/avatar-reconstruction && python -m pytest -q 2>&1 | tail -5; cd -
gcloud run services describe avatar-reconstruction-dense-staging --region us-central1 --project aerial-vehicle-466722-p5 --format='value(status.url,spec.template.spec.containers[0].env)' 2>&1 | head -5
```

## Tasks

1. **TemplateSpec `MHR`** in `recon_templates.py` (a hot file, so add the entry last and keep the edit minimal): `key="mhr"`, `glb_path=templates/mhr.glb`, `uv_map_path=face_uv_map.mhr.json`, head mesh and material names read from the GLB's `extras.reconstruction`, `uv_alignment="anchors"`, `eye_mode` matching the GLB's eye material, and a `skin_tint_strength` tuned on real photos (start at the parametric value and justify any change with eval numbers). Update the module docstring's template list.
2. **UV map:** run `python precompute_uv.py --template mhr` to produce `face_uv_map.mhr.json`. Check the MediaPipe canonical face lands on the MHR head: write a debug render of the mapped landmarks over the head UV layout to the scratchpad, inspect it, and fix the anchors in 893's build if they are off. Commit the JSON.
3. **Pipeline compatibility.** Run every module against the MHR head: the landmark morph, dense fit (the vertex count and order guarantees must hold), projection, view texture, body-type bake and ARKit target preservation. Fix whatever assumes wolf3d or parametric internals by reading the value from `TemplateSpec` or GLB extras instead. Bug fixes are test-first.
4. **Tests:** `test_mhr_reconstruction.py` mirrors `test_parametric_template.py` and adds an end-to-end job on a real photo from the repo's existing test fixtures (find them with `grep -rn "jpg\|png" workers/avatar-reconstruction/test_*.py | head`). Never use a celebrity image or anyone without consent. The job must produce a GLB with the painted face, the 52 ARKit plus 15 viseme targets intact, the canonical skeleton, and a body-type bake. The existing suites still pass.
5. **Docker image:** confirm `mhr.glb` and `face_uv_map.mhr.json` ship in the image (Dockerfile COPY lines) and that the image does not grow by more than the GLB's size. The 696 MB `mhr_model.pt` must NOT be in the image (the template carries everything the worker needs).
6. **Staging verification (pre-approved):** deploy the staging service with `RECON_TEMPLATE=mhr` through `cloudbuild.staging.yaml` (`TMPDIR=/home/user/.cache/gcloud-tmp`), or, if staging is shared with another session's template, as a new tagged revision with no traffic (`--no-traffic --tag mhr`). Run a real reconstruction against it. Then run the likeness eval for `mhr` and `wolf3d` (and `parametric` if quick) on the same 10 subjects and record the scores. Do not change production `avatar-reconstruction` or `three-ws-api` env.
7. **Viewer proof:** open the staged output GLB in the viewer on your dev port. Play the canonical clips and a lipsync line, and attach wardrobe hair and an outfit. Take screenshots for the doc.
8. **Docs:** `workers/avatar-reconstruction/README.md` (templates table, env var), `docs/realism/mhr-template.md` (a reconstruction section with the likeness table and before and after images), and a changelog entry worded honestly ("MHR reconstruction template available on staging").

## Definition of done

- [ ] `RECON_TEMPLATE=mhr` boots the worker. An unknown value still fails loudly (existing test still passes).
- [ ] All worker test suites pass, including the new `test_mhr_reconstruction.py` (pytest output in the report).
- [ ] A real reconstruction on staging returns an MHR avatar with the painted face, intact morph targets and the canonical rig. The viewer plays clips and lipsync on it (screenshots committed).
- [ ] Likeness eval numbers for mhr and wolf3d on the same subjects are recorded in the doc, whichever wins.
- [ ] Production env is unchanged (`gcloud run services describe avatar-reconstruction ...` shows the same `RECON_TEMPLATE` before and after).
- [ ] Docs, README, changelog, `npm run build:pages` and `npm run check:vendored` pass.

## Never blocked

- If the staging service is GPU-starved in us-central1, deploy the staging revision in the region the context file names for GPU quota, or run the end-to-end test as a Cloud Run job or Cloud Build step with a GPU (memory: `cloud-run-egress-diagnostics`, `long-gpu-model-runs-use-cloud-build`).
- If the likeness eval needs a worker URL override that does not exist, add the flag to `scripts/likeness-eval.mjs` with a test. Do not hand-edit env to aim it.
- If MHR scores below wolf3d, that is a result, not a failure. Record it, put the cause in the doc (texture, topology, UV), fix what is fixable in this order, and leave the flag decision to 899.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/894-realism-08-recon-template-mhr.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `894-realism-08-recon-template-mhr.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
