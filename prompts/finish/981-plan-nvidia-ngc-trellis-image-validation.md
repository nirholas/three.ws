# The TRELLIS NGC container passes real Ampere and Hopper inference and a CVE-clean two-stage build

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/981-plan-nvidia-ngc-trellis-image-validation.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 30 of 100 inside the tier). **Area:** nvidia. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The NGC Catalog is the only NVIDIA directory with a self-serve door, and `workers/model-trellis` is the chosen publishable container (MIT upstream, no baked weights). Gate 1 (runs outside our GCP project) is implemented and a multi-arch candidate image (`TORCH_CUDA_ARCH_LIST=8.0;8.6;8.9;9.0+PTX`) was built 2026-10-08, but it has only passed build-time contract tests. The GPU half of gate 2 (real inference on an Ampere or Hopper GPU) was never run because Cloud Run offers no such GPU, and NVIDIA's step 3 security scan will likely flag CVEs from the `devel` CUDA base. Doing both now leaves the owner with only the legal agreement and the staging push.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/model-trellis/Dockerfile` is single-stage `FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04` with `ARG TORCH_CUDA_ARCH_LIST="8.9"` default. `workers/model-trellis/cloudbuild.ngc.yaml` builds the `ngc-candidate` tag without deploying. `storage_backend.py` + `test_storage_backend.py` cover the local-output mode (gate 1).
- Candidate image per the doc: `us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server:ngc-candidate`, digest `sha256:8c9d543dbc563bfd1bf80133ae9865e407bad9666d8724259872419d0fa45629`, built from commit `85372d38d`. Verify it still resolves; rebuild from HEAD if the Dockerfile or main.py has since changed.
- The EULA page exists (`/legal/nvidia-ngc-eula` per the docs). Listing copy and intake-form answers are already written in `docs/nvidia-ngc-listing.md`; they have a placeholder sentence on the final architecture matrix.
- Not done: Ampere/Hopper inference run, two-stage (devel build to runtime) image, vulnerability scan, answer on the multi-GPU prerequisite, NGC partner legal agreement (owner).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
sed -n 55,140p docs/nvidia-ngc-listing.md
grep -n 'FROM\|TORCH_CUDA_ARCH_LIST' workers/model-trellis/Dockerfile
cat workers/model-trellis/cloudbuild.ngc.yaml
gcloud artifacts docker images list us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server --include-tags 2>&1 | head
gcloud compute accelerator-types list --project aerial-vehicle-466722-p5 --filter='name~a100|h100|l4' 2>&1 | head
git log --oneline -5 -- workers/model-trellis
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Convert `workers/model-trellis/Dockerfile` to a two-stage build: compile the CUDA extensions (nvdiffrast, diff-gaussian-rasterization, kaolin and any others it builds) in the `devel` stage, then copy the built artifacts and a pinned Python environment into an `nvidia/cuda:*-cudnn*-runtime-ubuntu22.04` stage. Keep the production Cloud Run image behavior identical (same entrypoint, same env contract, `8.9` default arch arg). Run the in-image tests (`python3 test_app_contract.py`, `test_request_policy.py`, `test_storage_backend.py`, `test_instance_health.py`) in the final stage during build.
2. Build the `ngc-candidate` tag from HEAD with `gcloud builds submit workers/model-trellis --project aerial-vehicle-466722-p5 --config workers/model-trellis/cloudbuild.ngc.yaml` (build-only, no deploy). Compare image size and layer count before and after; record both.
3. Run a vulnerability scan on the candidate (Artifact Registry on-demand scanning via `gcloud artifacts docker images scan`, or `trivy` if installable) and record HIGH/CRITICAL findings before and after the two-stage change. Fix what is fixable in our layers (base image patch version, apt upgrades, pinned Python deps) and list what is upstream-only.
4. Real GPU validation (Gate 2, GPU half): create a short-lived GCE VM with an A100 (Ampere, sm_80) in project `aerial-vehicle-466722-p5` using the pre-approved credits, run the candidate with the mounted `TRELLIS-image-large` weights and `OUTPUT_DIR` mode (no GCS), submit a real image through `POST /infer`, poll, download via `GET /results/{task_id}.glb`, and assert the GLB loads (trimesh or gltf-transform validate). Repeat on an H100 (Hopper, sm_90) if quota allows (request quota; if refused, state it and rely on the PTX path). Delete the VM when done and confirm with `gcloud compute instances list`. Save the run evidence (commands, timings, GLB stats) to `workers/model-trellis/NGC-VALIDATION.md`.
5. Pin the final `TORCH_CUDA_ARCH_LIST` matrix to what passed, update the `Dockerfile` comment block, and replace the "will be finalized during NVIDIA staging" sentence and the "GPUs supported" intake answer in `docs/nvidia-ngc-listing.md` with the measured matrix. Update the Gate 2 status line from "validation pending" to the real result.
6. Prepare the staging push as a script that only runs on explicit owner command: `scripts/ngc-stage-trellis.sh` that tags the validated digest as `nvcr.io/<org>/trellis-mesh-server:<version>` and pushes to the NGC private staging repo using `docker login nvcr.io` with an NGC API key from the environment. It must refuse to run without an explicit `--yes-push` flag. Document the exact owner steps (sign the NGC Partner Legal Agreement, create the staging repo, export the key) in the listing doc under Gate 4.
7. Gate 3: add the multi-GPU question to the doc as a ready-to-send message (text already drafted in the intake section) and, since the answer is unknown, implement nothing speculative; state in the doc that process-per-GPU replication is built only if NVIDIA says service-per-GPU is not acceptable.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `docker run --rm <candidate> python3 test_app_contract.py` passes on the two-stage image; image size is smaller than before (numbers in the report).
- [ ] `workers/model-trellis/NGC-VALIDATION.md` shows a real A100 inference producing a loadable GLB, with the arch list used.
- [ ] Vulnerability scan numbers before and after are recorded; no CRITICAL findings remain in layers we control.
- [ ] `gcloud compute instances list --project aerial-vehicle-466722-p5` shows no leftover validation VM.
- [ ] `docs/nvidia-ngc-listing.md` Gate 2 reads as validated with the measured matrix; `node scripts/ngc-stage-trellis.sh` without `--yes-push` exits non-zero without contacting NGC.
- [ ] `npm run check:vendored` exits 0.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No A100/H100 quota in us-central1 | Try other zones (us-central1-f, us-east4, europe-west4) and the L4/RTX PRO 6000 Blackwell for sm_89/sm_120 evidence; request quota increases through `gcloud` and continue with the PTX forward-compat claim marked unverified. |
| TRELLIS weights are not on the VM | Download `TRELLIS-image-large` from Microsoft's Hugging Face repo onto the VM; it is MIT licensed. |
| CVE scan flags base-image issues we cannot fix | Document them in `NGC-VALIDATION.md` with upstream advisory links; NVIDIA's own scan decides, so the order is done when ours is no worse than the previous image and our layers are clean. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Final actions that need the owner and are NOT performed by this order: signing the NGC Partner Legal Agreement, submitting the NGC partner intake form, and pushing the image to NGC staging (`scripts/ngc-stage-trellis.sh --yes-push`). Everything up to that point (build, scan, GPU validation, listing copy, push script) is done here; ask for those three in one message at the end. GCE validation spend is covered by the standing GCP credit approval.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/981-plan-nvidia-ngc-trellis-image-validation.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `981-plan-nvidia-ngc-trellis-image-validation.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/nvidia-ngc-listing.md` (whole file)

~~~~markdown
# NGC Catalog listing: the one NVIDIA directory with a self-serve door

[nvidia-visibility-map.md](./nvidia-visibility-map.md) records that no self-serve
"list my product" form exists on any NVIDIA surface. That is true of every
surface except one. The [NGC Software Partner program](https://www.nvidia.com/en-us/gpu-cloud/ngc-software-partners/)
publishes a **Become an NGC Software Partner** form, and a container published
through it lands in [catalog.ngc.nvidia.com](https://catalog.ngc.nvidia.com/)
permanently, hosted by NVIDIA, on NVIDIA's domain, in front of NVIDIA's
enterprise audience.

The Accelerated Apps Catalog is a marketing listing of the company. An NGC
listing is a distribution channel for the software itself. They are worth
pursuing in parallel and this doc covers only the second; the first has its own
kit in [nvidia-apps-catalog-listing.md](./nvidia-apps-catalog-listing.md).

Prerequisites and process below were re-fetched from NVIDIA's page on
2026-09-02. Every claim about our own containers is cited to the file that
proves it.

---

## Verdict

**Publishable candidate: [workers/model-trellis](../workers/model-trellis).**
Single image in, textured GLB out, on one L4. It is the strongest of the GPU
fleet for an outside user because its model is MIT-licensed, its weights are not
baked into the image, and it collects nothing.

**The two portability blockers are now implemented.** The container keeps its
production GCS backend when `GCS_BUCKET` is set and switches to a mounted local
output volume when it is not. The CUDA architecture list is also a build
argument, so the NGC build can target a broader GPU matrix without changing the
production L4 image.

One published prerequisite still needs resolution: NVIDIA asks for an
automatically multi-GPU-capable application, while this inference server
deliberately runs one job on one GPU. The NGC intake should ask whether
service-per-GPU orchestration satisfies that requirement or whether NVIDIA
expects in-container model replication. Do not claim this prerequisite as met
until NVIDIA answers or a multi-GPU implementation is validated.

## Prerequisite audit

NVIDIA's four published prerequisites, each against the code:

| NVIDIA prerequisite | Status | Evidence |
|---|---|---|
| Containerized using the CUDA 9 or later base container | **Met** | `FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04` in [workers/model-trellis/Dockerfile](../workers/model-trellis/Dockerfile). Eight GPU workers in the tree are built on `nvidia/cuda` 12.1 to 12.8. |
| GPU accelerated, automatically multi-GPU capable, runs on Pascal or newer | **Partly met** | GPU acceleration is implemented with TRELLIS, nvdiffrast, diffoctreerast, diff-gaussian-rasterization, and NVIDIA Kaolin. The architecture list is now configurable, but the server remains single-GPU by design. See [gate 2](#gate-2-the-kernels-are-compiled-for-one-gpu-generation) and [gate 3](#gate-3-multi-gpu-requirement-needs-nvidia-guidance). |
| An end-user license agreement for the application | **Met by this change** | [NVIDIA NGC Container EULA](https://three.ws/legal/nvidia-ngc-eula), source at [public/legal/nvidia-ngc-eula.html](../public/legal/nvidia-ngc-eula.html). It covers the Apache-2.0 code, the third-party components, and the fact that the image ships no weights. |
| Container does not collect personal data or violate GDPR | **Met** | The worker has no analytics, telemetry, or reporting of any kind: a search of [workers/model-trellis](../workers/model-trellis) for `posthog`, `analytics`, `telemetry`, `mixpanel`, and `sentry` returns nothing. The only outbound calls it makes are the ones the caller asks for, and those go through the SSRF guard in [worker_security.py](../workers/model-trellis/worker_security.py). |

## Why this container and not the others

| Worker | Model license | Verdict for NGC |
|---|---|---|
| [model-trellis](../workers/model-trellis) | Microsoft TRELLIS, MIT | **Candidate.** Commercial-safe upstream, weights fetched by the user. |
| [model-text2motion](../workers/model-text2motion) | MDM, MIT | **Second candidate.** Commercial-safe code and model, but the deployed HumanML3D checkpoint inherits research-only dataset terms, so the listing would have to point users at the upstream checkpoint and say so plainly. |
| [model-hunyuan3d](../workers/model-hunyuan3d) | Tencent Hunyuan **non-commercial** | **Not publishable.** The license is documented in [its README](../workers/model-hunyuan3d/README.md). Publishing a serving image for it into an enterprise catalog invites exactly the use the license forbids. |
| [model-triposg](../workers/model-triposg), [model-triposr](../workers/model-triposr), [model-video2scene](../workers/model-video2scene), [avatar-reconstruction](../workers/avatar-reconstruction), [longcat](../workers/longcat) | Mixed | Not first. Each carries its own upstream terms to clear, and one clean listing beats five contested ones. |

None of these images bake weights, which is what makes any of this possible: the
container is our serving code plus a CUDA build, and the user brings the model.

## The gates

### Gate 1: the container must run outside our cloud project

**Status: implemented.**

[main.py](../workers/model-trellis/main.py) now treats `GCS_BUCKET` as optional.
When it is set, production behavior remains GCS-backed. When it is unset, the
worker uses `OUTPUT_DIR` (default `/output`) for atomic task records and GLBs,
returns `result_url` plus `result_path`, and serves authenticated downloads from
`GET /results/{task_id}.glb`. `GET /health` reports the active backend.

Path and persistence behavior is isolated in
[storage_backend.py](../workers/model-trellis/storage_backend.py) and covered by
[test_storage_backend.py](../workers/model-trellis/test_storage_backend.py).

The worker's tests run inside the built image (`docker run --rm model-trellis
python3 test_app_contract.py`), so this change is verified by a GPU build, not
from a laptop. Budget one Cloud Build run for it.

### Gate 2: the kernels are compiled for one GPU generation

**Status: configurable, validation pending.**

The Dockerfile sets `TORCH_CUDA_ARCH_LIST="8.9"`, deliberately, to keep our own
builds fast on the L4 fleet. An image compiled for `sm_89` alone does not run on
the Ampere, Hopper, or Blackwell hardware an NGC user is most likely to have,
and NVIDIA's prerequisite reads "Pascal or newer".

The Dockerfile now exposes `TORCH_CUDA_ARCH_LIST` as a build argument and keeps
`8.9` as the production default. The first NGC candidate build should use
`8.0;8.6;8.9;9.0+PTX`, then run on at least one Ampere or Hopper GPU plus the
existing L4 validation. Pin the final matrix only after those compiled
extensions pass the real build and inference checks.

The build-only Cloud Build configuration is
[cloudbuild.ngc.yaml](../workers/model-trellis/cloudbuild.ngc.yaml). It builds
and pushes the `ngc-candidate` tag without deploying or changing the production
Cloud Run service.

**Current candidate (rebuilt 2026-10-08).** The first candidate (2026-09-14) predated
the system-library fix in commit `35d798585`, the one behind the 2026-09-19 to 09-25
TRELLIS outage, so it was rebuilt from commit `85372d38d` as Cloud Build
`e336574a-7141-46bf-9514-b15c492d79c8`: `TORCH_CUDA_ARCH_LIST=8.0;8.6;8.9;9.0+PTX`,
image `us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server:ngc-candidate`,
digest `sha256:8c9d543dbc563bfd1bf80133ae9865e407bad9666d8724259872419d0fa45629`.
The build-time gate passed inside that exact image: 25 request-policy and
storage-backend tests, and the full served-contract test including the TRELLIS
import chain, auth boundary, and dead-pipeline 503 behaviour. What is still not
done is the GPU half of gate 2: an inference run on an Ampere or Hopper GPU, which
Cloud Run does not offer, so it needs a short-lived GCE A100 or H100 VM.

```bash
gcloud builds submit workers/model-trellis \
  --project aerial-vehicle-466722-p5 \
  --config workers/model-trellis/cloudbuild.ngc.yaml
```

### Gate 3: multi-GPU requirement needs NVIDIA guidance

**Status: open.**

The current server serializes inference on one GPU because a TRELLIS job fills
most of an L4. Horizontal replicas provide production concurrency, but the NGC
FAQ specifically says "automatically multi-GPU capable." Ask NVIDIA whether
one service replica per GPU is acceptable for this inference workload. If it
is not, build and validate process-per-GPU model replication before pushing the
staging image.

### Gate 4: the NGC partner legal agreement

Owner action. It is step 1 of NVIDIA's published process and nothing technical
depends on it, so it can be signed while gates 1 and 2 are being built.

## The publishing process, as NVIDIA documents it

1. Sign the NGC Partner Legal Agreement.
2. Push the container to an NGC private staging repository.
3. Pass container security scanning and quality-assurance testing.
4. Complete final sign-off, after which the image goes live in the catalog.

Step 3 is the one to prepare for. A `devel` CUDA base ships a compiler and a
large package surface, so expect the scan to flag CVEs in build tooling we do
not need at run time. If it does, the answer is a two-stage build that compiles
the CUDA extensions in the `devel` image and copies them into a `runtime` base,
which also cuts the published image size.

## Listing content, paste-ready

**Publisher:** three.ws

**Container name:** `three-ws/trellis-mesh-server`

**Display name:** three.ws TRELLIS Mesh Server

**Short description (about 120 characters)**

> A GPU inference server that turns a single image into a textured, ready-to-use 3D mesh with Microsoft TRELLIS.

**Overview**

> This container serves single-image 3D reconstruction over HTTP. Post one image (or up to six turnaround views of the same subject) and it returns a textured GLB, generated with Microsoft TRELLIS on one NVIDIA GPU, through the same serving code that runs the free text-to-3D and image-to-3D lanes on three.ws.
>
> It is the production server, not a demo wrapper: asynchronous job handling with a task API, four quality tiers from draft to max, optional background matting before reconstruction, an SSRF guard on every caller-supplied image URL, and a health endpoint that reports whether the pipeline finished loading so an orchestrator can route around a cold instance.
>
> Model weights are not included. Download `TRELLIS-image-large` from Microsoft's Hugging Face repository and mount it at `/weights/trellis-large`. TRELLIS is MIT licensed; this container is licensed under the three.ws NVIDIA NGC Container EULA and its source is Apache-2.0 at github.com/nirholas/three.ws.

**Tags:** 3D, generative AI, mesh generation, inference server, digital humans, TRELLIS, computer vision

**Labels:** framework PyTorch, task Image to 3D, precision FP16, architecture Ada and newer (final list set by the build in gate 2)

**Links**

- Publisher: https://three.ws
- Live product using this container: https://three.ws/forge
- Source: https://github.com/nirholas/three.ws/tree/main/workers/model-trellis
- EULA: https://three.ws/legal/nvidia-ngc-eula
- Upstream model: https://github.com/microsoft/TRELLIS

## NGC partner intake form, paste-ready

The live NVIDIA form asks for these product fields. Identity, job-title, and
location selections must match the account holder's legal information.

**Organization / University Name:** three.ws

**Industry:** Media and Entertainment

**Product Name:** three.ws TRELLIS Mesh Server

**Link to Product Home Page:** https://three.ws/forge

**What does your product do?**

> three.ws TRELLIS Mesh Server is a containerized GPU inference service that
> turns one image, or multiple views of the same subject, into a textured GLB
> 3D asset. It uses Microsoft TRELLIS with NVIDIA CUDA, Kaolin, nvdiffrast, and
> custom CUDA extensions. The container supports authenticated asynchronous
> jobs, configurable quality tiers, SSRF-protected image intake, health checks,
> and local mounted-volume output without requiring a cloud account. Model
> weights are mounted separately and are not included in the image.

**List NVIDIA GPUs supported by your Product:**

> NVIDIA L4 is the verified production target. RTX PRO 6000 Blackwell has been
> validated for the heavy image-to-3D lane. The portable NGC architecture
> matrix for Ampere, Ada, and Hopper will be finalized during NVIDIA staging
> and validation.

**Question for the NVIDIA contact after submission:**

> This inference service schedules one model replica per GPU and scales through
> service replicas because one TRELLIS job uses most of an L4. Does NGC's
> automatically multi-GPU-capable prerequisite accept service-per-GPU
> orchestration, or should the staging image implement process-per-GPU model
> replication inside one container?

**Quick start (goes in the listing body, once gate 1 lands)**

```bash
docker run --gpus all -p 8080:8080 \
  -e API_KEY=choose-a-secret \
  -v /path/to/trellis-image-large:/weights/trellis-large:ro \
  -v /path/to/output:/output \
  nvcr.io/three-ws/trellis-mesh-server:latest

curl -X POST http://localhost:8080/infer \
  -H "Authorization: Bearer choose-a-secret" \
  -H 'Content-Type: application/json' \
  -d '{"images":["https://three.ws/avatars/thumbs/default.png"],"tier":"standard"}'
```

Poll the returned task, then download its local result with the same bearer:

```bash
curl -H "Authorization: Bearer choose-a-secret" \
  http://localhost:8080/tasks/TASK_ID

curl -L -H "Authorization: Bearer choose-a-secret" \
  -o result.glb http://localhost:8080/results/TASK_ID.glb
```

## What is owner-gated

Everything that leaves the machine. Submitting the partner form, signing the
legal agreement, and pushing to the staging repository are all outward-facing
and none of them are an agent's call:

1. Submit **Become an NGC Software Partner** at [nvidia.com/en-us/gpu-cloud/ngc-software-partners](https://www.nvidia.com/en-us/gpu-cloud/ngc-software-partners/). Mention the Inception membership in the form; it is the same company record.
2. Sign the NGC Partner Legal Agreement when it comes back.
3. Confirm the multi-GPU interpretation with NVIDIA, then run the portable image
   build and GPU validation.

## Verification log

| Claim | Checked how | Result |
|---|---|---|
| NGC prerequisites and the four-step process | `WebFetch` on the NGC Software Partners page, 2026-09-02 | Quoted verbatim in the audit table above |
| A self-serve intake form exists | Same fetch | "Become an NGC Software Partner" form on that page; no email address published |
| Base images are CUDA 12.x | `grep FROM workers/*/Dockerfile` | Eight GPU workers on `nvidia/cuda` 12.1 to 12.8 |
| The container collects nothing | `grep -rniE "posthog|analytics|telemetry|mixpanel|sentry" workers/model-trellis` | No matches |
| Weights are not baked into the image | [workers/model-trellis/README.md](../workers/model-trellis/README.md) and the Dockerfile | Weights mount at `/weights`; no `COPY` of any checkpoint |
| Standalone storage | [main.py](../workers/model-trellis/main.py), [storage_backend.py](../workers/model-trellis/storage_backend.py) | Local mounted-volume mode implemented; GCS remains the production path |
| CUDA architecture configuration | [Dockerfile](../workers/model-trellis/Dockerfile) | Production defaults to `8.9`; catalog builds can pass a wider list |
| Upstream licenses | Worker READMEs | TRELLIS MIT, MDM MIT, Hunyuan3D non-commercial |

## Related

- [NVIDIA visibility map](./nvidia-visibility-map.md): every other NVIDIA surface and its intake route
- [Accelerated Apps Catalog listing kit](./nvidia-apps-catalog-listing.md) and [inclusion request](./nvidia-apps-catalog-request.md)
- [NVIDIA Inception membership](./nvidia-inception.md): what membership is, and the rule that it is not an endorsement
- [NVIDIA models on three.ws](./nvidia-models.md): the source of truth for every NVIDIA technical claim
- [Listings and distribution](./listings.md): the canonical program and directory inventory
~~~~

### `docs/nvidia-visibility-map.md` (section "Tier 2: needs a build first")

~~~~markdown
## Tier 2: needs a build first

Real listings, real effort, honest gates. Do not pitch these before the code exists.

| Surface | Intake | The gate |
|---|---|---|
| **NGC Catalog** (via the [NGC Software Partner program](https://www.nvidia.com/en-us/gpu-cloud/ngc-software-partners/)) | A **self-serve "Become an NGC Software Partner" form** on that page, then the partner legal agreement, a push to an NGC private staging repo, security scanning and QA, final sign-off | **The closest Tier 2 surface to reachable, and the only NVIDIA directory with a self-serve door.** It now has its own kit: [nvidia-ngc-listing.md](./nvidia-ngc-listing.md) audits all four prerequisites against the code, names the publishable container ([model-trellis](../workers/model-trellis), MIT upstream, no baked weights, no telemetry), and carries the paste-ready listing copy. The EULA prerequisite is closed ([/legal/nvidia-ngc-eula](https://three.ws/legal/nvidia-ngc-eula)). What remains is one Cloud Build run to make the image runnable outside our GCP project, plus the owner-signed legal agreement. |
| **ACE / digital-human ecosystem** | No public form found. Ask for the redirect in the Showcase email | Genuinely strong: Riva, Magpie, and Audio2Face-3D are shipping, and a **browser-native** A2F demo is rare (most A2F work lives in Unreal or Omniverse). This is our most differentiated technical story. Do not overclaim: we consume ACE microservices, we do not self-host NIM. |
| **NVIDIA Technical Blog** ([developer.nvidia.com/blog](https://developer.nvidia.com/blog/)) | No public guest-submission process. Route via the forum Technical Blog category and the program team | Editorially controlled by NVIDIA. The realistic path is a forum post that performs, then a pitch. Our two live forum posts are the audition tape. |
| **Omniverse Exchange** | [Omniverse Exchange Publishing Portal](https://developer.nvidia.com/omniverse-exchange-publishing-portal) (early access), plus a GitHub repo tagged with the `omniverse-kit-extension` topic | **Blocked and should stay blocked.** OpenUSD interop is roadmap, not shipping, and [nvidia-apps-catalog-listing.md](./nvidia-apps-catalog-listing.md) already rules that Omniverse Kit stays under "Considering". Note the Omniverse Launcher was deprecated 2025-10-01, so old guides mislead. |
~~~~

