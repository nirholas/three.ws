# Clear the last 84 OSV advisories in the Python worker pins (transformers, diffusers, rembg, basicsr)

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/725-plan-workers-python-osv-residual-bumps.md`.

**Priority:** P2, new capability with clear value (score 55 of 100 inside the tier). **Area:** workers. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The 2026-09-07 scan found 321 advisories across 19 pinned package versions in the Python worker fleet. Most were cleared since (Pillow 13, usd-core 25.11, pyassimp dropped from remesh and stylize with libassimp gone from their Dockerfiles, requests 2.33.1, pynacl 1.6.2, torch 2.13.0 on texture, pytorch-lightning 2.6.6, onnx 1.22.0, rembg 2.0.86 on the rembg worker). What remains is concentrated in a few pins that decode caller-supplied images or prompts. Each remaining advisory belongs to a pinned version reachable on a GPU worker that takes public input (rembg cutouts, text prompts through tokenizers), so the residue is worth closing and recording honestly rather than leaving the Sept report reading as 285 open.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

Running `node scripts/check-deps.mjs` on 2026-11-03 reported **84 advisories across 9 package versions**:

| Package version | Where pinned |
|---|---|
| `transformers==4.57.6` | `workers/model-hunyuan3d/requirements.txt` and `requirements.hunyuan21.txt`, `workers/model-triposg/requirements.txt`, `workers/texture/requirements.txt`, `workers/modly/requirements-hunyuan.txt`, `workers/modly/requirements-triposg.txt` |
| `transformers==4.41.0` | `workers/longcat/requirements-model.txt` |
| `diffusers` 0.30.0 / 0.31.0 / 0.35.1 | `model-hunyuan3d` (21 image), `model-hunyuan3d`, `model-triposg`, `texture`, `modly`, `longcat` |
| `rembg` 2.0.59 / 2.0.65 / 2.0.69 | `model-triposr`, `avatar-reconstruction`, `model-hunyuan3d`, `modly/requirements-hunyuan.txt`, `modly/requirements-triposg.txt` (the rembg worker itself is on 2.0.86) |
| `basicsr==1.4.2` | `workers/model-hunyuan3d/requirements.hunyuan21.txt` (no fixed release published) |

Advisories with "no fixed version published" cannot be cleared by a bump (for example the transformers custom-generation-code consent one and the LightGlue one). Several loose pins (`Pillow>=10.3.0` in `model-triposg`, `model-triposr`, `model-triposplat`, `model-hunyuan3d`, `avatar-reconstruction`, `garment-forge`, and `Pillow>=10,<12` in `model-sam3d-objects`) resolve to whatever the build finds and are invisible to the scanner. `node scripts/check-deps.mjs --unpinned` lists them.

Parser is covered by `tests/check-deps.test.js`; `npm run audit:deps` is deliberately not in the gate (needs network) and is registered in `data/guards.json`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
node scripts/check-deps.mjs 2>&1 | grep -E '^[A-Za-z0-9_.\[\]-]+@[0-9]|^check-deps'
node scripts/check-deps.mjs --unpinned
git log --oneline --since=2026-09-07 -- 'workers/*/requirements*.txt' 'workers/*/Dockerfile'
```

Skip any package that no longer appears. Never edit anything that the scan reports clean.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Triage the transformers and diffusers advisories by reachability, as the Sept report asks: model/config deserialization (pinned weights staged by us, not caller reachable) versus tokenizer/regex ReDoS (a user prompt reaches a tokenizer on the generation lanes). Record the verdict per worker in a new section appended to `docs/audit/python-deps-2026-09-07.md` titled "Status 2026-11-03", with the post-session advisory count.
2. Cheap, caller-reachable first: bump `rembg` to the latest release the rembg worker already runs (2.0.86) in `model-triposr`, `avatar-reconstruction`, `model-hunyuan3d` (both files) and the two `modly` files. Rembg changes the cutout path, so each worker's smoke test (the rembg worker's 20-check test, or the worker's own test under `workers/<name>/`) must pass on the new version before the pin ships. Record the pass line.
3. Check that the transformers 5.x line is compatible with each generation worker's model code (read the worker's imports and `pip check` inside a throwaway venv or the worker image build; the CPU image build is allowed). If compatible, bump; if a model repo pins an older API, record the exact incompatibility and leave the pin, listing "no fix available without upstream change" in the status section. Do not bump a GPU image major version without running the worker's smoke test or at minimum a CPU import and one forward pass of the tokenizer path.
4. diffusers: bump to the single version every worker can share (0.38.0 or latest compatible) where the same dependency solver passes; one version across the fleet reduces drift.
5. `basicsr`: it has no fixed release. Determine whether the Hunyuan 2.1 image really needs it (read `workers/model-hunyuan3d/` imports). If only a vendored function is used, replace the dependency with the minimal inlined code and delete the pin; otherwise document the exposure as accepted with the reachability reason.
6. Replace each loose `Pillow>=` pin with `Pillow==13.0.0` (the version already validated on rembg, remesh, texture and modly), except `model-sam3d-objects` where `<12` is a model constraint: test whether 13.0.0 works there and relax if it does; otherwise leave and state why.
7. Add a drift test: extend `tests/check-deps.test.js` (or a new `tests/worker-requirements-pins.test.js`) to assert no worker requirements file contains a `Pillow` line that is not an exact pin, so the next loose pin fails a unit test rather than a scan.
8. Rebuild proof: for every worker whose requirements file changed, build the image locally if Docker is present (`docker build workers/<name>`), otherwise run `pip install --dry-run -r workers/<name>/requirements.txt` in a clean venv and report the resolver result. Image deploys go through the normal worker pipeline (owner deploy), so stop at "built and verified".
9. Run `node scripts/check-deps.mjs` again; record the final advisory count and the list of accepted residues with reasons in the status section. Run `npm run check:vendored` (some workers vendor shared modules byte-identical).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/check-deps.mjs` advisory count is lower than 84, and every remaining package version is listed in the status section with a reason ("no fixed version published", "not caller reachable", or "blocked by model code incompatibility with the exact error").
- [ ] `npx vitest run tests/check-deps.test.js` (and the new pin test) passes.
- [ ] Every worker whose pins changed has a recorded smoke test or import test result (command and pass line).
- [ ] `npm run check:vendored` passes and `npm run check:rules -- --paths workers docs/audit` is clean.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No GPU for the smoke test | Run the CPU path of the smoke test; for generation workers run a tokenizer and import check, and state that the GPU forward pass happens at the next worker deploy. |
| api.osv.dev unreachable | Retry later; the tool is a plain GET. Do not fake counts. |
| Resolver conflict on a bump | Keep the older pin for that worker, record the conflict with the resolver output, move on to the next worker. |
| Docker not installed | Use `pip install --dry-run` in a throwaway venv under the scratchpad. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/725-plan-workers-python-osv-residual-bumps.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `725-plan-workers-python-osv-residual-bumps.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/audit/python-deps-2026-09-07.md` (section "What is left, in priority order")

~~~~markdown
## What is left, in priority order

### 1. `libassimp5`, not `pyassimp` (remesh, stylize)

33 advisories against `pyassimp==5.2.5`, and **bumping the pin cannot fix any of
them**: 5.2.5 is the last release on PyPI, and the vulnerable code is the assimp
C++ library, which both Dockerfiles install from Debian as `libassimp-dev
libassimp5`. The scanner points at the Python binding because that is what a
requirements file can name.

This matters because assimp is the trimesh backend for **FBX and DAE input**, so
a caller's mesh file goes through it. The lever is the base image: rebuild both
workers on a Debian release carrying a patched `libassimp5`, or drop the FBX/DAE
input path to Blender, which remesh already ships for FBX export.

### 2. `transformers` 4.41.0 / 4.46.0 / 4.46.3 / 4.47.1 (longcat, hunyuan3d, triposg, texture)

43 advisories each, 6 HIGH, fixed in 5.0.0. Two different classes hide in that
number and they need separating before anyone bumps a major version across four
GPU workers:

- **Unsafe deserialization when loading a model or config.** Not caller
  reachable: every worker loads pinned weights we staged ourselves.
- **ReDoS in tokenizer and config regexes.** Potentially caller reachable, because
  a user's text prompt does reach a tokenizer on the generation lanes.

Read the second class first; it decides whether this is urgent or housekeeping.

### 3. `torch` 2.3.1 (texture)

23 advisories, one CRITICAL: `torch.load` with `weights_only=True` leading to
remote code execution. Same reachability answer as transformers, the worker loads
its own weights. The fix is 2.7.1, which is a CUDA-compatibility decision for the
whole image rather than a pin edit, so it belongs with the next texture worker
rebuild.

### 4. The cheap ones

| Package | Pinned | Fixed in | Worker |
|---|---|---|---|
| `requests` | 2.32.3 | 2.33.0 | avatar-reconstruction |
| `pynacl` | 1.5.0 | 1.6.2 | stylize |
| `rembg` | 2.0.56 / 2.0.59 / 2.0.65 | 2.0.75 | avatar-reconstruction, model-triposr, model-hunyuan3d, rembg |
| `diffusers` | 0.30.0 / 0.31.0 / 0.35.1 | 0.38.0 | model-hunyuan3d, model-triposg, texture, longcat |
| `onnx` | 1.18.0 | 1.22.0 | longcat |
| `pytorch-lightning` | 1.9.5 | 2.4.0 | model-hunyuan3d (2.1 image) |
| `basicsr` | 1.4.2 | no fix published | model-hunyuan3d (2.1 image) |

`requests` and `pynacl` are one-line bumps with no model-behaviour risk and
should go with the next deploy of those workers. `rembg` changes the inference
path this platform's cutouts run on, so it wants the same treatment BiRefNet got:
run the worker's smoke test against the new version first.
`pytorch-lightning` 1.9.5 to 2.4.0 is a major version inside a GPU image whose
Python stack is already pinned around torch 2.5, and `basicsr` has no fixed
release at all, so both are constrained by the Hunyuan 2.1 image rather than by
the pin.
~~~~

### `docs/audit/python-deps-2026-09-07.md` (section "Notes on the scan itself")

~~~~markdown
## Notes on the scan itself

- **`npm run audit:deps` needs network and is deliberately not in the gate.** A
  build must not fail because api.osv.dev is having a bad afternoon. It is
  registered as an on-demand guard in [data/guards.json](../../data/guards.json).
- **It only sees exact pins.** `pkg>=1.2`, `pkg~=1.2` and a bare `pkg` resolve to
  whatever the build found that day, which is a reproducibility problem before it
  is a security one. `node scripts/check-deps.mjs --unpinned` lists them.
- **A locally built wheel is queried on its public version.** The CUDA wheels
  (`torch-cluster==1.6.3+pt21cu121`) are our rebuild of an upstream release, and
  OSV indexes the release.
- **The parser is tested** ([tests/check-deps.test.js](../../tests/check-deps.test.js)),
  including an assertion that every requirement line in the tree is classified.
  A parser that silently drops a line reports a package clean without ever
  looking at it, which is worse than not scanning.
~~~~

