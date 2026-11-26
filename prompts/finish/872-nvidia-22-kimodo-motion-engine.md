# nvidia 22: Text to motion gets a second engine, NVIDIA Kimodo, on its own service and measured against the one that serves today

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3272 (`npm run dev -- --port 3272 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, setting the worker URL on `three-ws-api`, the Inception portal edit, the decision about which motion engine serves) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **Measure the motion lane before touching it.** The current engine is `workers/model-text2motion/` (MDM by default, MoMask selectable), reached through `GCP_TEXT2MOTION_URL`. If step 0 shows it working, it is protected: do not edit its worker, redeploy it, or change what `api/_lib/motion-seed.js` sends it. Kimodo is a separate service.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

three.ws turns a sentence into an animation clip for any rigged avatar. The engine is MDM or MoMask (both MIT) in `workers/model-text2motion/`, with output on our canonical skeleton that `src/animation-retarget.js` maps to the visitor's rig. NVIDIA released Kimodo on 2026-03-16: a text-to-motion diffusion model trained on 700 hours of motion capture, code Apache-2.0 at `github.com/nv-tlabs/kimodo`. One variant, `nvidia/Kimodo-SOMA-SEED-v1.1` (2026-04-10), is marked ready for commercial use under the NVIDIA Open Model License: a 30-joint SOMA skeleton, root translation plus joint rotations, 30 frames per second, 10 seconds maximum, 282 million parameters, and about 17 GB of VRAM by the readme (mostly the text encoder). A second engine gives motion a fallback it does not have today, and puts a NVIDIA-published model in a lane with none.

**Use only `Kimodo-SOMA-SEED-v1.1`.** The SMPL-X and G1 variants are research-only and must not be downloaded into our bucket or served.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/version | head -c 320; echo
    curl -s https://three.ws/api/nvidia/stats | head -c 5000; echo
    sed -n 1,120p workers/model-text2motion/README.md
    grep -n "text2motion" api/_lib/forge-health.js api/_lib/motion-seed.js api/_lib/motion-quality.js | head -40
    ls workers | grep -iE "motion|kimodo"

Read `workers/model-text2motion/main.py`, `smpl_to_clip.py` (the `SMPL_TO_WOLF3D` map) and `motion_decode.py`, then `api/_lib/motion-seed.js` and `api/_lib/motion-quality.js` end to end. Write down the exact clip JSON the API expects from a motion worker (track names, rotation basis, root translation convention, frame rate) and the quality checks a clip must pass. That is the contract. Find how many motion jobs finished and failed in the last 7 days (the lane stats, `forge_worker_stats`, or Cloud Run logs) and state whether the current engine is protected.

Clone Kimodo and `github.com/NVIDIA/soma-retargeter` into your session scratch directory and read the readmes, licenses and the model card. Establish from the source: the SOMA joint list and rest pose, the output tensors, the text encoder and its license, the real VRAM need, and whether the retargeter can target an arbitrary humanoid skeleton or only specific robots and characters.

## Tasks

1. **License, in writing.** Quote the clause for the code, the SOMA-SEED-v1.1 weights and the text encoder. If the text encoder's license does not permit a hosted commercial service, stop and report; do not substitute a research-only component.
2. **Skeleton map.** Build the SOMA 30-joint to canonical skeleton conversion so a Kimodo clip comes out in the same clip JSON as the current worker: same track names, same rotation basis, same root convention. Prove it with tests on fixed inputs (a T-pose stays a T-pose, a 90 degree elbow bend lands on the right joint and axis, the root moves forward on the forward axis) and by playing three clips on two different rigs in a real browser.
3. **Build the worker** as `workers/model-kimodo/` in the house layout (`main.py`, `Dockerfile`, `cloudbuild.yaml`, shared-key auth, tests, README). Same request and response as the current motion worker so the API needs no new shape. Weights from `gs://three-ws-model-weights`. Seeds are honored: the same prompt and seed return the same clip. Requests over 10 seconds are answered with a clear error naming the limit, never silently truncated.
4. **Deploy it** as a new Cloud Run GPU service, minimum instances 0, maximum 1, in a region where it cannot compete with `trellis_selfhost` or the current motion service for quota. Measure five forced cold starts and thirty warm requests.
5. **Wire it behind the current engine.** Behind an environment variable for the worker URL, Kimodo is taken only when the current motion engine has failed for that request. Unset variable means the code path does not exist. Test-first: "current engine errors, Kimodo answers and the clip passes the existing quality checks", and one proving the request sent to the current engine is byte-for-byte unchanged.
6. **Measured comparison.** Run the same 40 prompts (walks, gestures, dances, sports, idles, sit and stand transitions, taken from real motion prompt shapes) through both engines with fixed seeds. Score each clip with the checks in `api/_lib/motion-quality.js` plus foot sliding and prompt match judged blind by a vision model already on our NVIDIA key. Report success rate, latency and scores per category.
7. **Evidence and docs.** `docs/nvidia/evals/kimodo-motion-<date>.md` with the comparison, cold and warm numbers, and the exact one-line change that would serve Kimodo first, for the owner. Worker README, a `STRUCTURE.md` row, `docs/nvidia-models.md`, a `data/changelog.json` entry for users (then `npm run build:pages`). Kimodo stays "under evaluation" in `docs/nvidia-apps-catalog-listing.md` until it has served real requests in production.

## Definition of done

- [ ] License clauses quoted for code, weights and text encoder; only the commercial variant is in our bucket.
- [ ] Skeleton map tests pass and three clips play correctly on two rigs in a browser with no console errors.
- [ ] The service is deployed at minimum 0 with five cold and thirty warm measurements.
- [ ] With the variable set on the dev server and the current engine forced to fail, a motion request returns a Kimodo clip that plays. With it unset, behavior is unchanged, proven by a test.
- [ ] The 40-prompt comparison is in the eval doc. `git diff --stat` shows no change under `workers/model-text2motion/` or `workers/model-trellis/`.
- [ ] Worker tests and `npm test` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The model does not fit a 24 GB L4 | Load the text encoder in reduced precision if the model card allows it and quality holds on the 40 prompts, or deploy to a larger NVIDIA GPU type with quota. Report the measured VRAM. |
| NVIDIA's retargeter does not target our skeleton | Write the joint map and rest-pose correction yourself, the way `smpl_to_clip.py` does for SMPL, and validate it with the tests in task 2. |
| The model repository is gated | Record the gate, list the click in the owner message, and finish the skeleton map, worker, tests and wiring against the published tensor format so only the weights are missing. |
| No region has free GPU quota | File the quota request, record the link, and deploy where there is headroom. |
| `gcloud` needs a login | Build and test locally and in Cloud Build, write the deploy command into the README, and list the login in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, the `three-ws-api` deploy, setting the worker URL on `three-ws-api`, the Inception portal edit, the decision about which motion engine serves); one-line judgment calls. No trailing questions.
