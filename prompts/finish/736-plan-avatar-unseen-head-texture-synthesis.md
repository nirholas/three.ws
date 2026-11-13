# Texture the unseen 60 percent of the head from identity-gated synthesised views

**Status 2026-11-13 (second check):** Re-ran the same three suites (42 passed, 1 skipped) and probed `gemini-2.5-flash-image:generateContent` in us-central1 again: still 403 "pay your outstanding balance" for project 93741856042. No standalone Gemini API key exists in `.env` to route around it, and none may be onboarded without the owner. Nothing changes below.

**Status 2026-11-13:** Re-verified: test_view_synthesis.py, test_face_projection.py and eval/test_texture_eval.py give 42 passed, 1 skipped (the skip is the recorded-fixture test). Vertex generateContent still returns 403 "pay your outstanding balance" for project 93741856042, and prod logged 200+ billing-account errors in the last day. All 40 references are already mirrored at gs://three-ws-avatar-reconstructions/eval-refs/, so the owner does not need to rerun make_refs. Owner action: pay the GCP balance. After that, any agent can run these from workers/avatar-reconstruction: `gsutil -m cp "gs://three-ws-avatar-reconstructions/eval-refs/*" eval/refs/`, `python -m eval.capture_vertex_fixture`, `python -m eval.texture_eval --make-heldout`, `python -m eval.texture_eval`, `python -m eval.measure_projection_coverage`, `python -m eval.run_eval --compare off.json on.json`. Set RECON_VIEW_SYNTHESIS=1 only if held-out SSIM and histogram distance improve and seams pass on all 40.

**Status 2026-11-04:** Built and unit-tested (view_synthesis.py, view_texture.py, multi-view projection, identity/pose/seam gates, texture_eval, flag RECON_VIEW_SYNTHESIS default off). Remaining, owned by the owner: restore the GCP billing hold (Vertex returns 403), then run make_refs, `eval.capture_vertex_fixture`, `eval.texture_eval --make-heldout` and `eval.texture_eval`, calibrate the provisional gate thresholds, and enable the flag only if the held-out SSIM and histogram distance improve and seams pass on all 40.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/736-plan-avatar-unseen-head-texture-synthesis.md`.

**Priority:** P2, new capability with clear value (score 50 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

A selfie covers one side of a face under one lighting condition. Projective texturing (shipped) lifted photographic coverage of the head from 10.5 to 41.1 percent, but about 59 percent of head texels (scalp, back of the ears, under the jaw, far cheek, neck) are still the tinted template texture, which is what reads as "avatar" instead of "person" the moment the head turns. The program's measured conclusions constrain the design: do not inpaint the UV atlas directly (UV-incoherent seams), and synthesised views are unusable for geometry but fine for texture (same-pose control divergence 0.0069; complexion, beard, hairline and ear survive a 30 degree turn). So the correct route is to synthesise extra camera views, gate them on identity, and project them through the existing camera-and-mesh projection path.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/avatar-reconstruction/face_projection.py` projects one photo through a weak-perspective Umeyama camera with four gates (inside photo, facing camera, depth-buffer occlusion, foreground pixel) and cos^1.5 facing falloff (floor 0.06), blending under the face-oval composite capped at `MAX_BLEND`.
- No synthesised-view code exists in the worker (`grep -rniE "imagen|gemini|vertex" workers/avatar-reconstruction/*.py` only finds eval helpers `eval/make_refs.py`, `eval/make_adversarial.py`). The worker is CPU-only Cloud Run with `google-cloud-storage` and `google-cloud-firestore` but no Vertex client.
- Reusable Vertex image calls exist elsewhere: `api/_mcp3d/vertex-imagen.js`, `api/_lib/ai-image-lanes.js`, `api/_lib/forge-reference-image.js`, `workers/garment-forge/pipeline.py`. `gemini-2.5-flash-image` was the model used for the identity-divergence measurement.
- `eval/measure_projection_coverage.py` reports oval versus projected coverage per face; `eval/identity_eval.py` (ISE) is texture-blind by design, so this track needs its own metrics.
- GCP spend on Vertex AI is pre-approved (CLAUDE.md standing approvals); no new paid third-party API may be introduced.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -niE "imagen|gemini|vertex|synthes" workers/avatar-reconstruction/*.py workers/avatar-reconstruction/requirements.txt
python -m eval.measure_projection_coverage --help 2>&1 | head   # run from workers/avatar-reconstruction
sed -n 1,60p api/_mcp3d/vertex-imagen.js
sed -n 150,230p docs/avatar-reconstruction.md
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add `workers/avatar-reconstruction/view_synthesis.py`: given the selfie, request N extra views from Vertex AI (gemini-2.5-flash-image or Imagen, whichever the measurement favours) at known yaw/pitch targets (for example +/-35, +/-65 degrees yaw and a high pitch for the scalp). Use Application Default Credentials via the worker's service account, region us-central1, with the worker's existing SSRF-safe fetch conventions (`worker_security.py`) and bounded timeouts.
2. Identity gate before compositing: reject any synthesised view whose same-pose appearance divergence or detected-landmark ratios fall outside a threshold calibrated on the 40-face reference set (control divergence 0.0069 is the same-pose floor). A rejected view is dropped silently; the job still succeeds with whatever views passed, down to zero (the shipped single-photo behaviour).
3. Solve each accepted view's camera with the same weak-perspective Umeyama fit and feed it through `face_projection` (add a multi-photo entry point that keeps the original photo authoritative where it already applies, lower `MAX_BLEND` for synthesised views, and uses the existing four gates). Never run a view through the landmark TPS warp for the scalp: there are no scalp landmarks.
4. Seam and colour coherence: match each synthesised view's skin statistics to the original photo in the overlap before blending, and add a seam-continuity check across UV island boundaries. A view that breaks continuity beyond threshold is dropped.
5. Metrics (ISE cannot move): extend `eval/` with `eval/texture_eval.py` computing masked SSIM and LPIPS against held-out views (render the 40 synthetic reference faces at the held-out yaws, since references are synthesised and rebuildable by any agent) plus the seam-continuity score, and extend `measure_projection_coverage.py` to report photographic-plus-synthesised coverage. LPIPS must use a commercially clean weight set; if none is acceptable, use masked SSIM plus a colour-histogram distance and say so.
6. Tests: `test_view_synthesis.py` with the Vertex call injected at the HTTP boundary using recorded real response bytes (no fabricated images; capture one real response during development and store it under the test fixtures), covering gate accept/reject, zero-views fallback, timeout fallback, and that identity geometry output is byte-identical with the feature on or off (texture only). Extend `test_face_projection.py` for the multi-camera path.
7. Operational: feature flag `RECON_VIEW_SYNTHESIS` (default off until the report passes), per-job cost and latency logged, a hard wall-clock cap, and quota/429 backoff that degrades to the shipped path. Add the Vertex user role to the worker's runtime service account (`three-ws@`) with a config-only change documented in the README.
8. Docs and changelog: update Track 2 status and measured before/after numbers in `docs/avatar-fidelity-program.md`, the Phase 3 section and roadmap row in `docs/avatar-reconstruction.md`, the worker README, and add a `data/changelog.json` entry. Enable by default only if the held-out SSIM/LPIPS improve and seams pass on all 40 references.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `cd workers/avatar-reconstruction && python -m pytest -q` passes including the new tests.
- [ ] `python -m eval.texture_eval` report exists for flag off and flag on; the held-out masked SSIM/LPIPS and seam scores are recorded in `docs/avatar-fidelity-program.md` with the reference set named.
- [ ] `python -m eval.measure_projection_coverage` shows coverage above the shipped 41.1 percent on the 40 references with the flag on.
- [ ] `python -m eval.run_eval --compare <off.json> <on.json>` shows mean ISE unchanged (geometry untouched).
- [ ] A reconstruction of one reference face rendered at 0, 45 and 90 degrees yaw is viewed in `/viewer` and the scalp, ear and under-jaw are visibly personalised, with no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex model quota or 429 | Back off, fall back to the shipped single-photo path, and run measurement sweeps as Vertex AI custom jobs per docs/ops/gcp-credits-plan.md. |
| Model refuses or distorts identity | That is what the identity gate is for: drop the view; if every view fails across the reference set, ship the flag off and record the negative result. |
| No real held-out photographs | The reference set is synthesised on purpose (no real biometrics). Render held-out views from it; do not collect real people's photos. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/736-plan-avatar-unseen-head-texture-synthesis.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `736-plan-avatar-unseen-head-texture-synthesis.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/avatar-fidelity-program.md`
- `docs/avatar-reconstruction.md`
