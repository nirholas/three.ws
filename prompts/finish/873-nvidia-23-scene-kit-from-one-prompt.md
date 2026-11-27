# nvidia 23: One scene idea becomes a matched kit of 3D props, delivered as GLBs, one OpenUSD stage and a Blender import, without slowing anyone else's generation

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3273 (`npm run dev -- --port 3273 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, the Inception portal edit) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **This order adds a caller, not a lane.** A kit is made by submitting ordinary jobs through the same Forge path every visitor uses. Do not add a new generation route, do not change the tier order, and do not change what any lane is sent.
- **The image budget is the hard limit.** With about 1 reference image per 45 seconds for the whole site, a kit must queue behind interactive visitors and must never hold the image rung while a visitor is waiting.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

NVIDIA's 3D Object Generation Blueprint (2025-09-03, `github.com/NVIDIA-AI-Blueprints/3d-object-generation`) works like this: an LLM brainstorms up to 20 objects from one scene idea, an image model draws previews, Microsoft TRELLIS turns each into 3D, and the set exports to Blender. It needs an RTX GPU with 16 GB of VRAM, 48 GB of RAM, WSL and ComfyUI. Forge already does the second half (prompt, reference image, TRELLIS on our own NVIDIA GPUs) in a browser tab. The half we lack is the first step. A visitor who wants a "cozy wizard's study" today types and waits for each object by hand, and the objects do not match each other. A kit makes one visit produce a usable scene.

## Step 0: re-derive the current state

A design doc for this build exists at `docs/nvidia/builds/873-scene-kit.md`. It is a plan written on 2026-11-26, not a spec: this order is complete without it, and where the code or a license disagrees with it, the code and the license win.

    curl -s https://three.ws/api/version | head -c 320; echo
    curl -s https://three.ws/api/nvidia/stats | head -c 4000; echo
    sed -n 1,80p docs/cookbook/parallel-asset-pack.md
    grep -rn "asset.pack\|asset_pack\|scene.kit" --include=*.js --include=*.html --include=*.md api src pages docs 2>/dev/null | head -30
    sed -n 1,60p workers/usd-export/README.md
    grep -n "ladderBudgetMs\|laneTimeoutMs\|rate_limited" api/_mcp3d/text-to-image.js | head -20

Read `docs/forge.md`, the Forge submit and status handlers in `api/forge.js`, how a signed-in visitor's job is queued and polled, and how per-user and site-wide limits are enforced. Read `integrations/blender/` for how a GLB is imported today. If a pack or kit feature already exists, extend it instead of adding a second one. Find the existing mechanism, if any, that separates background work from interactive requests on the image rung; if there is none, the kit needs its own gate (task 3).

## Tasks

1. **Brainstorm step.** A new API handler takes a scene idea and returns 4 to 12 object proposals: a short name, a Forge-ready prompt, a size hint in meters and a shared style line that every prompt carries so the objects match. Use a Nemotron model on NVIDIA NIM through the existing LLM chain (the `NVIDIA_API_KEY` already in use), with the chain's normal fallbacks. Validate the JSON strictly, drop duplicates, refuse unsafe ideas through the moderation path chat already uses, and never invent objects on failure: an error state tells the visitor to retry.
2. **Kit page.** A new page (not a change to `/forge` beyond one link to it) where the visitor types the idea, sees the proposals, edits or removes any, and starts the kit. Each object shows its real job state from the real job API as a skeleton that becomes the model. Designed empty, loading, partial-failure and error states; hover, active and focus states on every control; works on a phone. Register the page in `data/pages.json`.
3. **Fairness gate.** A kit's jobs are submitted one at a time, and the next is submitted only when no interactive job is waiting on the image rung. Enforce it on the server, with a test that proves an interactive request arriving mid-kit is served before the kit's next object. A kit is capped (12 objects, one running kit per account), survives a page reload (state lives on the server, keyed to the account), and can be cancelled. Tell the visitor the honest expected time before they start, computed from the current image rate.
4. **Delivery.** When the kit finishes (or the visitor stops it), offer: each GLB, a zip of all of them, one OpenUSD stage that references every object laid out on a ground plane at its size hint (through `workers/usd-export`, called as it is today, with no change to that worker's behavior for existing callers), and a small Blender Python script that imports the set at the same layout. Objects that failed are named in the result, never silently missing.
5. **Tests.** Unit tests for proposal validation, the fairness gate, cap enforcement and resume. One end-to-end run on the dev server with a real kit of at most 4 objects (this order's total live generation budget is 6 objects).
6. **Docs.** A feature doc at `docs/scene-kit.md`, a cookbook cross-link from `docs/cookbook/parallel-asset-pack.md`, a `STRUCTURE.md` row, and a `data/changelog.json` entry for users (then `npm run build:pages`). In the doc, a short paragraph comparing the requirements honestly with NVIDIA's blueprint (theirs runs locally on an RTX PC, ours runs hosted in a browser), with no claim of endorsement.

## Definition of done

- [ ] A scene idea returns validated, style-matched proposals from a NVIDIA-hosted model, with the fallback chain exercised in a test.
- [ ] The kit page is reachable from navigation, shows real job progress, and has no console errors in a real browser.
- [ ] The fairness test passes: an interactive job is never delayed by a running kit.
- [ ] A real kit of up to 4 objects finished on the dev server and produced working GLBs, a zip, a USD stage that opens (validator report clean) and a Blender script that imports them.
- [ ] `git diff --stat` shows no change to the tier order, to `api/_mcp3d/text-to-image.js` rung order, or under `workers/model-trellis/`.
- [ ] `npm test` passes; docs, pages entry and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The image rung is throttled during your test | That is the normal state. Wait for it, record the real elapsed time, and make sure the page tells the visitor the same number. Do not add a faster image source in this order. |
| The Nemotron model returns malformed JSON | Use the structured-output mode the chain supports, validate, and retry once with the validation error in the prompt. Then fail with an actionable message. |
| `usd-export` has no multi-object entry point | Compose the stage on the API side from the per-object exports it already returns, as references in one layer. Do not change the worker's existing routes. |
| No QA login for the authed flow | `AUDIT_EMAIL` and `AUDIT_PASSWORD` in `.env`; if missing, `npm run audit:web:provision`. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner. Then bring this build's design doc `docs/nvidia/builds/873-scene-kit.md` and its row in `docs/nvidia/builds/README.md` up to date: the status, the measured numbers, anything the design got wrong, and the commit hash in place of the link to this order (the order is archived, so the link would break).
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, the `three-ws-api` deploy, the Inception portal edit); one-line judgment calls. No trailing questions.
