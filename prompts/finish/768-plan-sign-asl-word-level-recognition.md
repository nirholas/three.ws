# Webcam ASL recognition understands 250 everyday signs, not only fingerspelling

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/768-plan-sign-asl-word-level-recognition.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 32 of 100 inside the tier). **Area:** sign. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The live `model-asl-recognition` worker only reads fingerspelling, which is how deaf signers spell names and URLs, not how they talk. Most real signing is whole-word signs, so a user signing "hello" or "thank you" to the webcam gets nothing useful. The docs roadmap item 2 and the worker README name the clean-provenance route: train the Kaggle ISLR 1st-place architecture on the PopSign ASL v1.0 corpus (CC BY 4.0, 250 signs) and serve it behind the same worker and endpoint. This makes the sign-language surface two-way for everyday signs and is the largest accessibility gap on it. Provenance is the product constraint: research-only datasets (WLASL, How2Sign, ASL Citizen and derivatives) must not be used.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/model-asl-recognition/` is live on Cloud Run (`model-asl-recognition`, us-central1), CPU only, `ai-edge-litert` TFLite, serving the Kaggle ASL Fingerspelling 1st-place model (weights at `gs://three-ws-model-weights/aslfr-1st-place/cfg_2-fold-1/model.tflite`). Files: `main.py`, `decode.py`, `inference_args.json`, `cloudbuild.yaml`, `Dockerfile`, tests `test_decode.py` and `test_model_smoke.py`. `POST /transcribe` takes 390-column landmark frames (130 landmarks x 3), `GET /schema`, bearer auth with the shared `avatar-reconstruction-key`.
- Public proxy `api/asl-recognition.js` (GET schema, POST `{frames}` returning `text, raw, cleaned, confidence, frames, ms`), browser landmark extraction in `src/sign-input.js` (MediaPipe in the browser, no video leaves the machine), page `src/sign-language-page.js`, tests `tests/sign-input.test.js`. `@three-ws/sign-language` is already on npm (0.1.1), so roadmap item 4 is done.
- No word-level model, training code, evaluation harness or PopSign data exists in the repo (`grep -ril popsign` hits only docs). The README Roadmap is a three-line note.
- The 390-column fingerspelling layout differs from a typical 543-landmark ISLR layout, so the training data must be extracted with the layout the browser sends.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -ril "popsign\|islr" workers api src docs scripts | head
ls workers/model-asl-recognition
curl -s https://model-asl-recognition-93741856042.us-central1.run.app/health
curl -s https://three.ws/api/asl-recognition | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['columns']), d.get('max_frames'), d.get('min_frames'))"
gcloud storage ls -r gs://three-ws-model-weights/ 2>&1 | grep -i -E 'asl|islr|sign|popsign'
gcloud secrets list --project aerial-vehicle-466722-p5 | grep -i kaggle
gcloud run services describe model-asl-recognition --region us-central1 --project aerial-vehicle-466722-p5 --format='value(status.url)'
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Provenance memo: add `workers/model-asl-recognition/PROVENANCE.md` recording the licence text and attribution requirements for the ISLR 1st-place code (verify the licence in the upstream repository, do not assume) and PopSign ASL v1.0 (CC BY 4.0), and the exact attribution string the UI must show. If the reference code licence is not clearly permissive, use a smaller Apache or MIT 1D-conv or transformer encoder and state the choice.
2. Data (licensed and recorded): obtain the PopSign ASL v1.0 isolated-sign corpus from its public release. If it is only on Kaggle, check Secret Manager for a Kaggle token first. Store raw and landmark-extracted data under a new GCS prefix in the project's bucket, never in the repo. Add `workers/model-asl-recognition/training/DATA.md` with source URL, licence, version, SHA-256 of the archive and attribution string.
3. Data pipeline `training/prepare_popsign.py`: run from a Cloud Build or Vertex AI job, extract landmarks with the same MediaPipe Holistic tasks-vision version `src/sign-input.js` uses and the identical column selection `GET /schema` serves, write sharded TFRecords. Add `training/test_columns.py` checking the extracted landmark layout against the served schema.
4. Training `training/train_islr.py` plus a Vertex AI custom job spec (one GPU, about one GPU-day, GCP credits pre-approved): 250-way classification head, label map, signer-disjoint validation split (hold out signers, not clips), augmentation, metrics logged to GCS, TFLite export that runs under the `ai-edge-litert` runtime already in `requirements.txt`.
5. Evaluation `training/eval_islr.py`: top-1 and top-5 on signer-disjoint held-out data, per-class worst 20 and a confusion list. Write `training/RESULTS.md` and `workers/model-asl-recognition/eval/` results with the exact reproducing command and publish the numbers in the README. Quality bar: signer-disjoint top-1 of at least 80 percent. Below it, iterate on augmentation, architecture and training length; never lower the bar or wire in an unvalidated model. Mirror passing weights to `gs://three-ws-model-weights/popsign-250/` and record their sha256 in the README.
6. Worker endpoint, test-first: add `POST /recognize-signs` (frames to top-5 `{sign, probability}` plus `confidence`) and `GET /signs-schema` to `main.py` with the same bearer auth and fail-closed behavior. Leave `/transcribe` and `/schema` unchanged and backward compatible. The Dockerfile fetches the new weights the way it fetches the fingerspelling model. Add `test_signs_decode.py` (NumPy label and softmax handling) and extend `test_model_smoke.py` with real validation clips (skip only when weights are absent). Red first, then green.
7. Proxy and client: extend `api/asl-recognition.js` with `mode: 'signs' | 'fingerspelling'` (default unchanged) and the matching schema on GET. Extend `src/sign-input.js` with a `mode` option and the landmark layout the new model needs. Write `tests/api-asl-recognition.test.js` (validation, mode routing, rate limit, breaker behavior) and add cases to `tests/sign-input.test.js`.
8. UI: on `/sign-language` (`src/sign-language-page.js`, `pages/` shell) and the agent chat webcam button, add a mode switch with hover, focus and active states; designed empty state ("Sign a word, we show our best guesses"), error states (camera denied, low confidence), a skeleton while the model warms on cold start, top-3 guesses with confidence, tap to insert the chosen word into chat, and the dataset attribution string.
9. Docs: worker README (API section, FSboard and PopSign attribution, licence story), `docs/sign-language.md` (recognition section, "Can it read signs, not just spelling?" answer, roadmap item 2 marked done), `docs/api-reference.md`, `STRUCTURE.md` if directories change, `data/changelog.json`, then `npm run build:pages`.
10. Deploy readiness only: update `cloudbuild.yaml`, run a build-only verify, and document the single owner command to roll the new revision and set `GCP_ASL_RECOGNITION_URL` if needed. Do not deploy.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `training/RESULTS.md` and `eval/` contain signer-disjoint top-1 and top-5 with the reproducing command, and the README states the bar and whether it is met.
- [ ] `python -m pytest -q -p no:cacheprovider` in `workers/model-asl-recognition` passes with the real weights present (smoke test not skipped).
- [ ] `npx vitest run tests/api-asl-recognition.test.js tests/sign-input.test.js` passes; the fingerspelling path passes `tests/sign-input.test.js` unchanged.
- [ ] `curl -s -X POST localhost:3000/api/asl-recognition -d '{"mode":"signs","frames":[...]}'` with frames from a validation clip returns a top-5 list whose top entry equals the clip label.
- [ ] `PROVENANCE.md` and `DATA.md` exist with dataset and code licence statements and the attribution string, and the UI renders that string.
- [ ] `/sign-language` in a real browser: mode switch works, a recorded or live sign yields guesses, no console errors, empty, error and loading states observed.
- [ ] If the bar is not met, the mode switch is not shipped and the README says why, with the numbers.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Kaggle credentials for PopSign | Check Secret Manager first; else fetch from PopSign's public distribution link; if truly gated, build the full pipeline against the public sample split, ship everything else, and name the one missing download in the report |
| PopSign hosting URL changed | Find the current official release (Kaggle or the authors' page) and record its licence; never substitute a research-only dataset |
| GPU quota missing in a region | Try another region, Spot L4 or T4, or Vertex AI custom training under the same project; training is small and credits are pre-approved |
| Accuracy below bar | Do not wire it in; iterate (augmentation, larger model, label smoothing, longer training) and report the numbers |
| MediaPipe landmark layout mismatch | Extract with the same tasks-vision package version the browser uses and train on that layout |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Deploying the worker and setting `GCP_ASL_RECOGNITION_URL` are production deploys and wait for the owner's yes; everything else is agent-doable. Batch the ask into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/768-plan-sign-asl-word-level-recognition.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `768-plan-sign-asl-word-level-recognition.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `workers/model-asl-recognition/README.md` (section "Roadmap")
- `workers/model-asl-recognition/README.md` (section "The model (and why it is legally clean)")
- `docs/sign-language.md`
- `docs/sign-language.md` (section "Roadmap")
- `docs/sign-language.md` (section "Reading signing: the recognition API")
- `workers/model-asl-recognition/README.md`

## Status (2026-11-04)

Built and tested: worker `/recognize-signs` and `/signs-schema` (fail closed with 503 until weights exist), proxy `mode: "signs"`, `SignInput` signs mode, Cloud Build verify config, and the full training pipeline under `workers/model-asl-recognition/training/` (landmark extraction, signer-disjoint split, model + TFLite export, eval with the 80% bar). Docs and PROVENANCE.md written. Owner-owned remainder: Kaggle token and PopSign download (none exists on this machine), GPU training run, eval at or above 80% top-1, copy weights into `signs-weights/`, worker deploy, then the UI mode switch.
