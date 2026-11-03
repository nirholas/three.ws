# One selfie to a photoreal animatable avatar through a new LHM GPU lane that renders as splats

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/744-plan-avatar-lhm-photoreal-selfie-lane.md`.

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

`workers/avatar-reconstruction` fits a selfie onto a fixed Wolf3D-style template (MediaPipe landmarks, TPS texture warp, geometry morph). It is cheap and commercially clean but cannot produce hair, clothing or body shape the template lacks. LHM (aigc3d/LHM, Apache-2.0, ICCV 2025) reconstructs an animatable 3D human from one image in 1.4 to 6.6 seconds and is driven by SMPL-X pose, the interface the retargeter already thinks in. Its native output is 3D Gaussians, and Spark (already adopted as the splat renderer) is what lets that render beside GLB avatars. Together they make "photoreal animatable avatar from one photo". Nothing of LHM exists in the repo.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `grep -rn -i lhm workers/*/README.md` finds nothing; no `workers/model-lhm`. The only LHM string hits in the tree are lockfile noise.
- `workers/avatar-reconstruction` exists with `main.py`, `face_pipeline.py`, `eval/` (identity_eval.py, run_eval.py, make_adversarial.py: the Identity Shape Error harness) and `templates/`. This is the CPU-cheap default and guaranteed-riggable fallback; it must stay.
- Sibling GPU worker patterns to copy: `workers/model-trellis`, `workers/model-triposplat` (splat output), `workers/model-partcrafter`. Shared vendored modules are guarded by `scripts/check-vendored-workers.mjs`. Spark splat viewer parity is tracked by an existing order (`081-best3d-15-splat-parity.md`), so do not rework the viewer here beyond what loading an LHM splat on the avatar stage needs.
- Weights/license: the adoption doc says Apache-2.0 code; model weights and the SMPL-X body model carry their own terms (SMPL-X is non-commercial for research unless a commercial licence is obtained). This must be verified from the LICENSE files before anything ships.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
ls workers | grep -iE 'lhm|triposplat|avatar'
grep -rIl -i 'lhm' --include=*.py --include=*.js --include=*.md --exclude-dir=node_modules workers api src docs | head
sed -n 264,290p docs/oss-adoption-2026-09.md
curl -s https://api.github.com/repos/aigc3d/LHM/license | head -c 400
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. License gate first. Read the LICENSE of `aigc3d/LHM`, of every weight repository it downloads from, and the SMPL-X / body-model terms it depends on. Write the verdict in `workers/model-lhm/README.md` under "License". If any component forbids commercial use, stop the build at a documented dev-only worker that is not wired to production and report exactly which component blocks (this is the honest outcome, not a failure to finish).
2. Create `workers/model-lhm` (FastAPI, same job contract as the other model workers: `POST /infer` returns 202 with a task id, `GET` task poll, `/health` reports pipeline loaded). Copy the Dockerfile and `cloudbuild.yaml` pattern from `workers/model-triposplat`, pin `TORCH_CUDA_ARCH_LIST` for the L4 fleet (`8.9`), do not bake weights into the image beyond what sibling workers do, include `worker_security.py` byte-identical (`npm run check:vendored`), and an SSRF guard on caller image URLs.
3. Output both a Gaussian splat artifact and a mesh export when the LHM mesh path is available, and a posed-neutral SMPL-X parameter blob so the retargeter can drive it. Validate output size/limits and fail with actionable error codes.
4. Wire the lane into the avatar creation orchestration beside the template path: a new quality option ("photoreal") in the selfie flow API (find the current entrypoint with `grep -rn avatar-reconstruction api src`), routed through `api/_providers/gcp.js`-style provider code with the lane in the failover registry, free-first accounting, and the template path as the automatic fallback when the lane is down or the license-gated flag is off. Env flag default off until the owner deploys the worker.
5. Render: load the splat on the existing avatar stage via the Spark path (`src/` viewer) next to GLB avatars, with a skeleton/SMPL-X driven pose; add loading skeleton, error state ("photoreal needs a clear full-body photo" with the actionable fix) and a hover/focus-visible state on the quality toggle.
6. Evaluation: extend `workers/avatar-reconstruction/eval` (or add `workers/model-lhm/eval`) to report Identity Shape Error / likeness for LHM output against the same reference and adversarial sets, so the lane is judged on the metric the roadmap already names rather than by eye. Record the numbers.
7. Tests: Python tests in the worker (`test_app_contract.py` pattern from model-trellis, run inside the built image), `tests/api/avatar-lhm-lane.test.js` for routing, fallback-on-lane-down, and flag-off behaviour.
8. Docs: `workers/model-lhm/README.md`, a feature doc in `docs/`, `STRUCTURE.md` row, `data/changelog.json` entry (when the lane is user-visible), and update the Phase 1 status text anywhere it says likeness fidelity is the open track.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `workers/model-lhm/README.md` states the license verdict for code, weights and body model with the URLs read.
- [ ] `docker build workers/model-lhm` (or the Cloud Build equivalent) succeeds and the in-image contract test passes; `npm run check:vendored` exits 0.
- [ ] `npx vitest run tests/api/avatar-lhm-lane.test.js` passes, including template fallback when the lane returns 503.
- [ ] A real selfie produces a splat that renders on the avatar stage in a real browser with no console errors; screenshot path in the report.
- [ ] Identity Shape Error numbers for LHM vs the template path are recorded in the worker README.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| GPU deploy needs quota or a build slot | Cloud Build and Cloud Run GPU spend on `aerial-vehicle-466722-p5` is pre-approved; use the documented worker rollout in `docs/ops/gcp-model-workers.md`. |
| LHM weights or SMPL-X forbid commercial use | Ship the worker dev-only behind the flag, keep production on the template path, and report the exact blocking component. |
| LHM mesh export is poor | Ship splat-only for the avatar stage and keep mesh export out of the API surface. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/744-plan-avatar-lhm-photoreal-selfie-lane.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `744-plan-avatar-lhm-photoreal-selfie-lane.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/oss-adoption-2026-09.md` (section "LHM, for one-selfie photoreal humans")

~~~~markdown
### LHM, for one-selfie photoreal humans

**[aigc3d/LHM](https://github.com/aigc3d/LHM)** (Apache-2.0, 2.7k stars,
ICCV 2025).

[workers/avatar-reconstruction](../workers/avatar-reconstruction/) fits a selfie
onto a fixed-topology Wolf3D template: MediaPipe landmarks, a TPS texture warp,
and a geometry morph. That is a sound, CPU-cheap, commercially clean design, and
it is bounded by the template. It cannot produce hair, clothing, or body shape
the template does not already have.

LHM reconstructs an **animatable** 3D human from a single image and drives it
with SMPL-X pose, which is the interface our retargeter already thinks in.
Published inference times are 1.41 s (LHM-MINI, 16 GB), 2.01 s (LHM-500M), and
6.57 s (LHM-1B). It outputs 3D Gaussians, with a mesh export path.

This moved up the list the moment Spark shipped: LHM's native output is splats,
and Spark is what lets that render on the existing avatar stage next to GLB
avatars instead of in a walled-off viewer. Together they are one feature,
"photoreal animatable avatar from one photo".

**Where it lands:** a new GPU lane beside the existing reconstruction worker, not
a replacement. The template path stays as the CPU-cheap default and the
guaranteed-riggable fallback.
~~~~

### `docs/oss-adoption-2026-09.md` (section "License traps")

~~~~markdown
## License traps

Every one of these is a well-known, high-star project that looks adoptable and
is not, or is not on the terms its popularity implies. Checked against the
actual LICENSE file, not the GitHub sidebar.

| Project | Reality |
|---|---|
| `briaai/RMBG-2.0` | CC BY-NC 4.0, commercial use needs a paid license. It is built on BiRefNet, which is MIT. Use BiRefNet |
| `nv-tlabs/PartField` | NVIDIA License 3.3: non-commercial research and education only |
| `facebookresearch/vggt` | Custom "VGGT License v1" with an Acceptable Use Policy and pass-through redistribution terms, not an OSI license. MapAnything (Apache-2.0) covers the same ground |
| `ByteDance-Seed/Depth-Anything-3` | Split licensing. DA3-SMALL, DA3-BASE, DA3MONO-LARGE, DA3METRIC-LARGE are Apache-2.0; DA3-LARGE, DA3-GIANT and the DA3NESTED series are CC BY-NC 4.0. The repo code is Apache-2.0, so the checkpoint choice is the whole question |
| `SWivid/F5-TTS` | Weights are CC BY-NC. Chatterbox (MIT) and Orpheus (Apache-2.0) are the commercial-safe equivalents |
| `NVIDIA/Audio2Face-3D` | NVIDIA Open Model License. Permissive in intent and not OSI-approved; read it and record the read before the lane ships |
| `zju3dv/GVHMR` | Custom Zhejiang University terms, not permissive |
| `graphdeco-inria/hierarchical-3d-gaussians` | Inherits the INRIA 3DGS license, which is non-commercial |
| `semgrep/semgrep` | LGPL-2.1. Fine as a developer tool, not as vendored code |

`microsoft/MoGe` is the inverse case: GitHub reports no license, and the LICENSE
file is plain MIT.

---
~~~~

