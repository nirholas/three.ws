# nvidia 25: Every simulation-ready export is checked in NVIDIA's own physics and sensor libraries, and the report says what passed

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3275 (`npm run dev -- --port 3275 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, the Inception portal edit, any forum or social post) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **The export worker's existing behavior is pinned.** `workers/usd-export/` already serves OpenUSD exports. Its current routes, outputs and report fields stay byte-compatible for existing callers. The new check is an added, optional stage.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

At SIGGRAPH on 2026-07-20 NVIDIA released Omniverse libraries meant to be driven by agents: ovphysx (GPU physics) and ovrtx (RTX sensor simulation), described as openly available under `github.com/NVIDIA-Omniverse`. The startups NVIDIA named beside that release make simulation-ready assets: Lightwheel (assets from text prompts) and Palatial (CAD to SimReady). three.ws already turns any Forge model into OpenUSD with convex collision, mass and semantics (`workers/usd-export/`, validated with OpenUSD's validator and NVIDIA's asset validator) and already drop-tests assets. What we cannot say today is "this asset was simulated in the same physics and sensor stack Isaac Sim uses, and here is the result". That sentence, with a pass rate over a few hundred real assets, is the number this order leaves behind.

What is NOT known and must be read from the repositories: the licenses of ovphysx and ovrtx, how they install (pip wheels, containers, or a Kit dependency), and what GPU they need.

## Step 0: re-derive the current state

    sed -n 1,140p workers/usd-export/README.md
    sed -n 1,80p workers/usd-export/drop_test.py
    grep -n "def \|class " workers/usd-export/validate.py workers/usd-export/physics.py | head -60
    sed -n 1,60p docs/simready-assets.md
    grep -rn -i "ovphysx\|ovrtx" --include=*.md --include=*.py --include=*.js . 2>/dev/null | grep -v node_modules | head

Read `workers/usd-export/` end to end, including what `drop_test.py` already simulates and with which engine, and what `report.json` contains. Then read the ovphysx and ovrtx repositories under `github.com/NVIDIA-Omniverse` (and the `omniverse-labs` Blender example) in your session scratch directory: README, license, install, minimum GPU, and a minimal "load a stage, step physics, read poses" and "render a camera or lidar frame" example. Decide from that reading whether the check runs inside the export worker (CPU only today) or must be a separate GPU service.

## Tasks

1. **License and install, in writing.** Quote the license clause for each library. If either cannot be used in a hosted commercial service, do not use it, say so, and finish the order with the one that can.
2. **Physics check.** For an exported stage: load it in ovphysx, drop the object onto a ground plane from a small height in several orientations, step until rest or a time limit, and record whether it settles, how far it penetrates, whether it explodes (energy growth), its rest orientation, and the solver settings. Deterministic for a fixed seed. Thresholds are stated in code with the reason for each.
3. **Sensor check.** With ovrtx, render the settled object from a fixed camera ring (and a depth or lidar frame if the library offers one without extra licensing) and check that the semantic labels the exporter wrote come back in the annotation. Store the frames in our bucket.
4. **Where it runs.** If it needs a GPU: a new Cloud Run GPU service `workers/sim-validate/` in the house layout at minimum instances 0, in a region where it cannot compete with `trellis_selfhost` for quota, called by the API after the export finishes and never blocking the export itself. If it runs on CPU: an optional stage inside the export job behind a request flag that defaults to off. Either way an export without the check behaves exactly as before, proven by the worker's existing tests passing unmodified.
5. **Report and UI.** Add a `simulation` section to the export report (engine and version, settle result per orientation, penetration, sensor label match, links to frames). Show it where the export is offered to the visitor: a clear passed or failed state with what failed and what to try (for example regenerating with a simpler shape), not a bare badge.
6. **The number.** Run the check over at least 200 real Forge exports spanning the object classes the exporter knows (reuse existing public creations; this order generates no new models beyond 3 for the end-to-end test). Publish pass rates by class, the common failure causes and time per asset in `docs/nvidia/evals/simready-physics-<date>.md`.
7. **Fix what the check finds, inside the exporter's rules.** If a class fails often for a reason the exporter controls (collision decomposition settings, mass, origin), fix it test-first in the exporter with a regression test, and rerun that class. A change that alters existing exports for callers who did not ask for the check is reported with before and after numbers and left for the owner.
8. **Docs.** `workers/usd-export/README.md` and `docs/simready-assets.md` updated, a `STRUCTURE.md` row if a service was added, `docs/nvidia-models.md`, and a `data/changelog.json` entry for users (then `npm run build:pages`). The libraries are "under evaluation" in `docs/nvidia-apps-catalog-listing.md` until the check runs for real visitors in production.

## Definition of done

- [ ] License clauses quoted; the install is reproducible from the Dockerfile.
- [ ] The physics and sensor checks run on a real exported asset and the result is in its report.
- [ ] The export worker's existing test suite passes with no test edited, and an export without the check is unchanged.
- [ ] The 200-asset evaluation is in the eval doc with pass rates by class.
- [ ] The visitor sees the simulation result with designed passed, failed, pending and unavailable states, no console errors.
- [ ] `git diff --stat` shows no change under `workers/model-trellis/`. Tests and `npm test` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| ovrtx needs an RTX-class GPU that Cloud Run does not offer | Run the sensor check on the GPU type Cloud Run does offer if supported; otherwise ship the physics check, run the sensor evaluation once on a GCE VM that deletes itself, and report it as an offline evaluation. |
| A library is distributed only inside a larger Kit install | Use the smallest official container that includes it, record the image digest, and report the image size and cold start. |
| A library's license is evaluation-only | Label every result "evaluation", keep it out of the production path, and list the licensing decision in the owner message. |
| The existing drop test already covers the physics check | Keep it, add the NVIDIA engine as a second independent result, and report where the two disagree. |
| `gcloud` needs a login | Build and test in Cloud Build and locally, write the deploy command into the README, and list the login in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, the `three-ws-api` deploy, the Inception portal edit, any forum or social post); one-line judgment calls. No trailing questions.
