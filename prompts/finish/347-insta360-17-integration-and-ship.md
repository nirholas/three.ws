# insta360 17 (runs last): end-to-end on real Insta360 footage, every seam fixed, one-command ship, one owner message

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Run it AFTER orders 331 to 346 have each been run once (archived or left with a dated status line). It does not need them to be perfect: finding and fixing their seams is this order's job. Dev port: 3347.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) and the whole of [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. You own the campaign's single owner message: every push, service creation, env var, deploy, store submission and post from every order, batched, ordered and ready to paste. Never contact Insta360, Adobe, Blender or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards`, `self-unblock-playbook` and `deploy-runbook` skills. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Sixteen orders built to one contract in parallel. Contracts drift, assumptions differ, and nobody has yet run a real Insta360 file through the whole thing. This order does that on every surface, fixes what breaks, and leaves the owner one message whose steps take minutes.

## Step 0: re-derive the current state

    ls prompts/finish | grep insta360; ls prompts/archive | grep insta360
    cat prompts/finish/_context/insta360-PROGRESS.md
    head -3 prompts/finish/3[34][0-9]-insta360-*.md | grep -A1 "^==>" | grep -iv "how to run" | head -40
    ls workers/model-pano2splat workers/model-panodepth integrations/premiere-uxp
    ls api/pano-capture.js api/pano-scene.js api/capture-upload pages/insta360.html pages/pano-scene.html
    git log --oneline --since=2026-11-21 | grep -iE "insta|pano|360|splat|capture" | head -40
    npm test 2>&1 | tail -15

For each order 331 to 346: record done, done-with-owner-step, or incomplete (with what is missing). Any order that is incomplete in a way that blocks the chain: finish that piece here, in its files, following that order's own Definition of done.

## Tasks

1. **Contract audit**: for every C1 to C5 boundary, compare both sides in code (field names, types, units, yaw convention, exit codes, error codes, URL shapes, env var names) and fix every mismatch on the side that deviates from the context file. Test-first for each fix.
2. **Full GPU verify**: run order 337's `verify.py` as a Cloud Run Job on the production image tag built from current main, over every fixture in the manifest. Every stage must run. Record per fixture: stitch, sfm and train stats, wall time, cost estimate (GPU-seconds times the published L4 price), holdout PSNR. Investigate and fix any fixture failure that is not a genuine capture-quality failure.
3. **Quality pass on real Insta360 footage**: at least one raw `.insv` walkaround (X4 or X5 preferred) end to end: tune quality presets, masks, the appearance-embedding switch (order 335 left it off), and Gaussian caps for the best result per GPU-minute, and record before and after PSNR and a visual note. Update contract C1 presets in the context file only if the change is compatible.
4. **Production-shaped chain without a production deploy**: Cloud Run Jobs expose no HTTP port, so run each worker image locally (CPU is acceptable for HTTP and orchestration correctness with the `preview` preset) or on a GPU VM you create and delete within the session (Compute Engine with an L4, startup script runs the container, firewall restricted to this machine's egress IP, deleted at the end, cost recorded), and point a local dev server (port 3347) at them through `GCP_PANO2SPLAT_URL` and `GCP_PANODEPTH_URL` with the real `GCP_RECONSTRUCTION_KEY`. Then drive, in a real browser and with real files:
   - `/capture` 360 mode: raw `.insv` upload with a forced interruption and resume, job progress through every stage, result in the splat viewer, PLY and SPZ downloads open in `/splat`, preview MP4 plays, "Your captures" lists it.
   - `/pano-scene`: a raw `.insp` and a stitched JPEG to depth shells.
   - Viewer environment from a 360 photo.
   - `/video-to-motion` 360 mode against the video2motion image with 341's change (run it the same way).
   - Blender extension headless against the local server; Premiere client logic against it.
   - MCP tools and CLI against it.
   - `/insta360` landing page link check: zero 404s; any section 346 left as copy only now gets its real result embedded.
   Record every defect found and fixed with its commit SHA.
5. **Ship script**: one command, `npm run ship:insta360` (a script under `scripts/`, registered in `package.json`, hot file, anchored edit), that performs the owner's infra steps in order with checks between them: create or update the `model-pano2splat`, `model-panodepth` and video2motion Cloud Run services from the verified image digests (GPU, region with quota, concurrency 1, min instances 0, max from quota, timeouts, service account `three-ws@`), wait for `/health` ok on each, `gcloud run services update three-ws-api --update-env-vars` (never `--set-env-vars`) for `GCP_PANO2SPLAT_URL` and `GCP_PANODEPTH_URL`, verify through the production API that each lane answers (an authenticated job on a real fixture with the `preview` preset, result fetched), and print a summary. It does not push git and does not run `deploy:gcp:full`; those stay separate owner commands. Dry-run mode (`--dry-run`) prints every command without running it; prove dry-run here.
6. **Docs and records**: `STRUCTURE.md` rows for every new surface and worker not yet listed; one consolidated changelog entry for the launch if siblings did not add per-feature entries (do not duplicate); `npm run build:pages`; `docs/ops/insta360-ship.md` runbook (what the ship script does, rollback per service, cost per capture measured in task 2, quotas); update the research doc's "Unverified" section with what was verified (anchored edit).
7. **Insta360 SDK inquiry draft**: `docs/marketing/insta360-sdk-inquiry.md`, a short professional email to Insta360's developer or enterprise contact asking for written terms for server-side use of the Media SDK and whether a listing in their partner or plugin directory is possible. The owner decides whether to send it.
8. **Campaign close**: every order whose remaining step is in the owner message keeps its dated status line; every order fully done is archived (`git mv` to `prompts/archive/`) in one closing commit with inbound links repointed. Update the queue row in [prompts/README.md](../README.md) and the band in [prompts/RUN-ORDER.md](../RUN-ORDER.md).

## Definition of done

- [ ] Contract audit table in the report: every boundary checked, every mismatch fixed with a test.
- [ ] GPU verify report with every stage running on every fixture; cost per capture computed.
- [ ] Every surface in task 4 exercised with real files against the real worker images; defects fixed; no console errors.
- [ ] `npm run ship:insta360 -- --dry-run` prints the full ordered command list; script tests pass.
- [ ] `npm test`, `npm run audit:docs`, `npm run check:vendored` pass. Any GPU VM you created is deleted (show `gcloud compute instances list`).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A sibling order was never run | Run its work here, following its own file, before the chain; note it. |
| GPU VM quota in every region | Run the images locally on CPU with the `preview` preset for HTTP correctness, and rely on the GPU job verify (task 2) for GPU proof; say so. |
| A fixture fails on capture quality | That is a real result; keep it as the documented failure example with its visitor message. |
| A finding needs a production change | It goes into the ship script or the owner message, never run ad hoc. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and `type(scope): ...` subjects; one topic per commit.
3. Leave this file in `finish/` with a dated status line ("ship waits on owner") until the owner has run the message, or archive it if nothing remains.
4. Append the campaign summary to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md): per-lane status, measured quality and cost, defects fixed.
5. Report, then the **one owner message**, ordered, each step one line plus its exact command or link:
   1. Review the commits: `git log --oneline <first campaign sha>..HEAD`.
   2. `git push threews main`.
   3. `npm run ship:insta360` (creates the worker services, sets the two env vars, verifies each lane in production).
   4. `npm run deploy:gcp:full` (frontend, API, pages).
   5. Premiere: load `integrations/premiere-uxp/` in the UXP Developer Tool, run the in-host checks listed in its README, then submit the `.ccx` with the prepared listing.
   6. Blender: upload the built extension zip (SHA in the report) to extensions.blender.org with the prepared changelog.
   7. CLI publish and MCP registry listing updates if 345 left them.
   8. Optional: post the launch drafts; optional: send the Insta360 SDK inquiry.
   No trailing questions.
