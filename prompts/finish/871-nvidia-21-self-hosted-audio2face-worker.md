# nvidia 21: Talking avatars get their own Audio2Face-3D service, built from NVIDIA's open SDK, so facial animation stops depending on a hosted endpoint that mostly fails

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3271 (`npm run dev -- --port 3271 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, setting the worker URL on `three-ws-api`, the Inception portal edit, the decision to serve our service first) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **Not protected, measured 2026-11-26:** the hosted Audio2Face lane (`audio2face` in `api/_lib/nvidia-lanes.js`) answered 7 of 55 probes in 7 days. It is the thing being fixed. Re-measure in step 0; if it has since become healthy (20 or more probes, 85% or better), it is protected: keep it first and add yours strictly behind it.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

Every talking avatar on three.ws asks NVIDIA's hosted Audio2Face-3D function for facial animation (`api/_lib/a2f-nvidia.js`, over NVCF gRPC). In the 7 days to 2026-11-26 that function answered 7 of 55 health probes. NVIDIA open-sourced Audio2Face on 2025-09-24: the SDK at `github.com/NVIDIA/Audio2Face-3D-SDK` is MIT licensed and the weights (`huggingface.co/nvidia/Audio2Face-3D-v3.0` and the v2 regression models) are under the NVIDIA Open Model License with a model card that says the model is ready for commercial use. Stated requirements: Linux, CUDA 12.8 or newer below 13, TensorRT 10.13 or newer below 11, Python 3.8 to 3.10, 4 GB or more of GPU memory. Running it ourselves fixes a broken feature, and it is a NVIDIA SDK on a NVIDIA GPU with TensorRT in the request path, which is a claim we can publish once it serves real traffic.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/version | head -c 320; echo
    curl -s https://three.ws/api/nvidia/stats | head -c 5000; echo
    sed -n 1,120p api/_lib/a2f-nvidia.js
    grep -n "export\|blendShape\|frames\|arkit" api/a2f.js src/voice/a2f-player.js | head -60
    ls workers | grep -iE "a2f|audio2face|face"
    ls workers/model-triposg && sed -n 1,80p workers/model-triposg/README.md

Read `api/a2f.js`, `api/_lib/a2f-nvidia.js` (`openA2fSession`, `createFunctionHealer`, `StreamingResampler`), `api/_lib/a2f-emotion-wire.js` and `src/voice/a2f-player.js` end to end, and write down the exact response shape the browser consumes: frame rate, blendshape names, value ranges, timecodes, how emotion is sent. That shape is the contract your service must reproduce. Read `docs/ops/worker-and-avatar-rules.md` and one existing GPU worker for the house layout. If a face worker already exists, finish it instead of starting a second one.

Clone the SDK into your session scratch directory (not the repo) and read its README, license, samples and the model cards. Establish from the source, not from memory: what the SDK outputs (ARKit blendshape weights through a blendshape solve, or raw vertex motion), which model variants exist, how TensorRT engines are built and whether an engine is tied to the GPU model it was built on, and what streaming looks like. Do not trust any performance figure you have not measured: check the TensorRT documentation for the version the SDK pins.

Check GPU quota per region before choosing where to deploy: `gcloud compute regions describe <region> --project aerial-vehicle-466722-p5 --account nich@sperax.io`. us-central1 L4 quota is fully held.

## Tasks

1. **License and fit, in writing.** Quote the SDK license and the weights license clause that permits a hosted commercial service. Record which model variant you chose (regression or diffusion) and why, on measured quality and latency.
2. **Build the worker** as `workers/model-a2f/` in the house layout (`main.py`, `Dockerfile`, `cloudbuild.yaml`, `worker_security.py` shared-key auth, tests, README with the deploy command). Input: speech audio at the sample rate the hosted lane already sends, plus the optional emotion the hosted lane accepts. Output: the same frame shape the browser consumes today, so `src/voice/a2f-player.js` needs no change. Weights come from `gs://three-ws-model-weights`, never downloaded on the request path. TensorRT engines are built once for the deployed GPU type and cached in the bucket keyed by GPU model, TensorRT version and model version; a cache miss rebuilds and stores, it never fails the request.
3. **Deploy it** as a new Cloud Run GPU service, minimum instances 0, maximum 1, in a region where it cannot compete with `trellis_selfhost` for quota. Measure five forced cold starts and thirty warm requests on the real service, with clips of 2, 8 and 20 seconds.
4. **Wire it into `api/a2f.js`** behind an environment variable for the worker URL. Unset means the code path does not exist for the request. The hosted lane keeps its position. Ours is taken when the hosted lane fails, and when the hosted lane's existing health signal already says it is down the request goes straight to ours without making the visitor wait for a hosted timeout. Whatever the browser does today when no facial animation arrives stays as the last resort. Test-first: a failing test for "hosted lane errors, our service answers with the same frame shape", one for "hosted lane marked down, hosted is not attempted", and one proving behavior with the variable unset is unchanged.
5. **Parity.** For at least ten clips where the hosted lane does answer, run the same audio through both and compare the blendshape curves (per-channel correlation and mean absolute difference, mouth channels reported separately). Put the table in the eval doc. If the SDK emits vertex motion and not blendshapes, the solve to the ARKit set our rigs use is part of this task, validated the same way.
6. **Lane health.** Register the service as its own lane in `api/_lib/nvidia-lanes.js` so `/api/nvidia/stats` and `/nvidia` show its probes beside the hosted one.
7. **Evidence and docs.** `docs/nvidia/evals/audio2face-selfhost-<date>.md` with cold and warm numbers, parity, and the exact one-line change that would serve ours first, for the owner to approve or not. Worker README, a `STRUCTURE.md` row, `docs/nvidia-models.md`, and a `data/changelog.json` entry written for users (then `npm run build:pages`). In `docs/nvidia-apps-catalog-listing.md` the SDK and TensorRT stay "under evaluation" until the API deploy is live and the service has answered real visitors.

## Definition of done

- [ ] License clauses quoted; model variant chosen on measured numbers.
- [ ] The service is deployed at minimum 0 with five cold and thirty warm measurements in the report.
- [ ] On the dev server with the variable set, `/demos/audio2face` animates a face from our service while the hosted lane is failing, with no console errors, in a real browser.
- [ ] With the variable unset, `api/a2f.js` behaves exactly as before, proven by a test.
- [ ] Parity table for ten or more clips; lane visible on `/api/nvidia/stats` locally; worker tests and `npm test` pass; docs and changelog landed.
- [ ] `git diff --stat` shows no change under `workers/model-trellis/` and no change to the hosted lane's request.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The gated emotion model needs a license click on Hugging Face | Ship without the separate emotion model, accept emotion as an explicit input the way the hosted lane does, and list the click in the owner message. |
| No region has free L4 quota | File the quota request, record the link, and deploy to the region with the most headroom on another NVIDIA GPU type the SDK supports. |
| The TensorRT engine build is slow | Build it in Cloud Build or at first start, cache it in the bucket, and report the time. Do not raise the minimum-instance floor. |
| Cold start is too long for a live conversation | Keep the service as the fallback, report the number, shorten load (engine cache, smaller image, lazy model variants), and say plainly in the eval what a visitor experiences on a cold request. |
| The SDK needs a newer CUDA than the base image | Use an NVIDIA CUDA base image that matches the SDK's pins. Never change another worker's image. |
| `gcloud` needs a login | Build and test locally and in Cloud Build, write the exact deploy command into the README, and list the login in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, the `three-ws-api` deploy, setting the worker URL on `three-ws-api`, the Inception portal edit, the decision to serve our service first); one-line judgment calls. No trailing questions.
