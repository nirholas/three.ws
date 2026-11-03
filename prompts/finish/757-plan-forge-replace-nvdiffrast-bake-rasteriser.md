# Replace nvdiffrast in Forge workers with a permissively licensed rasteriser behind one bake interface

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/757-plan-forge-replace-nvdiffrast-bake-rasteriser.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 40 of 100 inside the tier). **Area:** forge. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The Forge workers depend on nvdiffrast for texture baking and rendering. Its license (NVIDIA non-commercial) is a commercial-use risk flagged by the research. A single bake interface with a clean-licensed backend removes the risk and the CUDA build fragility.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- nvdiffrast is used by `workers/model-trellis2` (`main.py` around lines 555 and 726, Dockerfile `setup.sh --nvdiffrast`), `model-trellis`, `model-pixal3d`, `model-anigen`; `api/_lib/forge-tiers.js` (around line 873) requires `texture_size` to be a power of two.
- No abstraction layer exists.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
grep -rn "nvdiffrast" workers api --include=*.py --include=Dockerfile --include=*.js --include=*.sh --include=*.txt | head -30
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read the license of nvdiffrast in the installed version and confirm the restriction; record in `docs/research/forge-3d-adoption-2026-10-30.md` addendum (do not rewrite the source).
2. Create a shared module `workers/_shared/bake.py` (vendored byte-identical per worker, follow `npm run check:vendored`) exposing `rasterize(mesh, camera, size)` and `bake_texture(...)` with two backends: `nvdiffrast` (existing, default) and `pytorch3d` or `kaolin`/`moderngl` (choose the permissively licensed one after a timing test).
3. Tests first: a deterministic render test comparing both backends on a unit mesh within a pixel tolerance, run in each worker's suite.
4. Switch one worker (`model-trellis2`) behind an env flag, benchmark speed and quality on 10 meshes, record numbers.
5. Document the migration path and flip defaults only if quality and speed are within 5 percent.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Render parity test passes for both backends.
- [ ] `npm run check:vendored` passes.
- [ ] Benchmark table committed in the research addendum with real numbers.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| GPU needed for the benchmark | Run on a GCP GPU worker with pre-approved credits. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/757-plan-forge-replace-nvdiffrast-bake-rasteriser.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `757-plan-forge-replace-nvdiffrast-bake-rasteriser.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/research/forge-3d-adoption-2026-10-30.md` (whole file)

~~~~markdown
# Forge 3D quality: what to adopt next (2026-10-30)

Follow-up to [3d-landscape-2026-10.md](3d-landscape-2026-10.md). Licenses were read from the LICENSE files and Hugging Face cards on 2026-10-30, not from blog posts.

## Finding 1: the biggest quality gap is a deploy, not a new model

The repo already contains workers for TRELLIS.2, Pixal3D, PartCrafter, HoloPart, AniGen and SAM 3D Objects. In production only TRELLIS v1 serves image-to-3D: `/api/forge-quote` reports `trellis_selfhost`, and `gcloud run services list` shows no `model-trellis2` or `model-pixal3d`. `api/_lib/forge-tiers.js` routes every tier to `trellis2` first and skips it while `MODEL_TRELLIS2_URL` is unset, so every job silently falls back to v1.

Status on 2026-10-30:
- `model-trellis2`: Artifact Registry repo created, weights already staged at `gs://three-ws-model-weights/trellis2-4b/`, Cloud Build submitted (build `68a20930-157f-43ca-a298-aad01f4aa35f`, `three-ws-build@`, scale-to-zero). After it succeeds: smoke-test the service directly, then set `MODEL_TRELLIS2_URL` with `--update-env-vars`.
- `model-pixal3d`: no staged weights yet (not under `gs://three-ws-model-weights/`). Stage after TRELLIS.2 is verified.

## Finding 2: candidates that are new since the October 9 sweep

| Project | License (verified) | Fit | Verdict |
|---|---|---|---|
| [LoHhhha/LATO.2](https://github.com/LoHhhha/LATO.2) (Meshy, Jul 2026) | MIT code, MIT weights | Mesh in, artist-style low-poly mesh out. 200 to 5000 vertices, about 8 GB VRAM, about 5 s on an H800. Upstream warns outputs can contain holes. | **Adopt** as an "Artist mesh" retopology lane beside QuadriFlow, gated by a watertight check with QuadriFlow as the fallback. This is the first permissive open model that closes the retopology gap named in the October sweep. |
| [yiboz2001/UltraTex](https://github.com/yiboz2001/UltraTex) (SIGGRAPH Asia 2026) | MIT code; weights on ModelScope, license to be read before use | 2048 px multi-view diffusion texturing. Our `workers/texture` is SDXL plus ControlNet-Depth back-projection. | **Adopt** as the texture lane successor after reading the weights license. Triton kernels, Python 3.12, PyTorch 2.5.1. |
| [Stability-AI/arbor](https://github.com/Stability-AI/arbor) | MIT code; HF weights card says "other" | Text to 3D under hull, avoidance and touch constraint meshes, TRELLIS decoder. | **Evaluate** after TRELLIS.2 is live. Read the weights license first. Fits "fit inside this volume" and print-bbox use cases. |
| [PKU-YuanGroup/UltraShape-1.0](https://github.com/PKU-YuanGroup/UltraShape-1.0) | Repo LICENSE is the Tencent Hunyuan 3D 2.1 license (excludes EU, UK, South Korea); weights card says Apache-2.0 | Geometry refinement on a coarse mesh. | **Reject for now.** The code license carries the territory exclusion we already gate around. |
| [DerKleineLi/triflow](https://github.com/DerKleineLi/triflow) | Automotive Development Public Non-Commercial License | Artist-like topology. | **Reject.** Non-commercial. |
| [Xrvitd/MeshMosaic](https://github.com/Xrvitd/MeshMosaic), [Xrvitd/SATO](https://github.com/Xrvitd/SATO) | AGPL-3.0, GPL-3.0 | Artist-style meshes. | **Reject.** Copyleft in a hosted service. |
| [Roblox/cube](https://github.com/Roblox/cube) (CubePart) | NOASSERTION | Part-controllable generation. | **Reference only** until the LICENSE is read. |

## Finding 3: what to do with each

1. Finish the TRELLIS.2 deploy and flip the lane (in progress). Then Pixal3D on about 50 real inputs, promote the winner (the plan from `docs/ops/image-selfie-3d-review-2026-10-09.md`).
2. Build `workers/model-lato2`: FastAPI `/infer` taking a mesh URL and a vertex budget, validating the output is watertight, returning a GLB. Wire it as the `retopo` mode in `api/forge-gameready.js` and the pipeline remesh stage with QuadriFlow as the failover rung.
3. Build the UltraTex texture rung in `workers/texture` once the weights license is confirmed.
4. Open question that decides the roadmap: nvdiffrast (NVIDIA Source Code License) sits under both TRELLIS lanes. Replacing the bake rasteriser removes the only commercial-use risk in the default lane.
~~~~

