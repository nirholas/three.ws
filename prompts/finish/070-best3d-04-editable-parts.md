# best3d 04: Editable parts: PartCrafter and HoloPart behind the segment lane

**Evolve status (2026-10-11):** Built and tested, NOT closed. `workers/model-partcrafter/` (image-to-parts) and `workers/model-holopart/` (occluded-part completion) are both complete, with `api/_lib/forge-tiers.js`/`api/_lib/forge-options.js`/`api/_providers/gcp.js`/`api/forge.js`/`api/gpt-forge.js`/`api/forge-holopart.js` wiring both backends end to end, opt-in only (never a default or failover target). Restyle Studio (`src/restyle.js`/`pages/restyle.html`) gained a Parts panel: select a part, recolor/retexture it alone via `editRoot()` scoping, swap it from a file, or regenerate it through `/api/forge-holopart`, then reassemble under the original node name (satisfies task 3, order 078's dependency). DoD line 1 ("a real image yields at least 3 named part nodes and one part is retextured without touching the others") is verified against a synthetic 3-part GLB fixture in a real browser (Playwright, zero console errors), matching the exact scene-graph shape `workers/segment/segment_core.py` already produces in production, but NOT yet against a real image run through a live PartCrafter/HoloPart service, since neither is deployed. DoD lines 2 and 3 (tests, docs/changelog) are fully done: `npm test` passes for every touched file, `npm run audit:docs` reports nothing new, `STRUCTURE.md`/`docs/forge.md`/`data/changelog.json` all updated and `npm run build:pages` run. This pass also found and fixed a real pre-existing gap discovered while verifying this order: `workers/model-holopart/Dockerfile` (and, separately, `workers/rig-nonhuman/Dockerfile`) never staged the `gltfpack` binary their vendored `gltf_meshopt.py` decode step depends on at runtime; both now do, and `scripts/check-vendored-workers.mjs` gained a mechanical check so this class of gap cannot regress silently. Remaining, owner-gated: deploy `model-partcrafter` and `model-holopart` to Cloud Run and wire their URLs (rows 43 and 44 of [production-100-OWNER-ACTIONS.md](_context/production-100-OWNER-ACTIONS.md)), then run one real image/mesh through each and confirm DoD line 1 against live output before deleting this file.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/best3d-00-CONTEXT.md](_context/best3d-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: irreversible spend, git push or deploy, external posting, committing content that names a crypto project other than $THREE, destroying unrecoverable data. Batch every such ask into ONE message at the end.
- Commercial vendors are "Vendor A, B..." in every committed file. Open-source projects are named and credited.
- Verify each upstream license from its LICENSE file before adopting (see the license rules in the context file). Reference-only means build our own, never copy code.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. The em-dash and en-dash characters are banned.
- Concurrent agents share this worktree: stage explicit paths only and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Vendor E sells image to parts with auto-assembly. PartCrafter (MIT) generates individually editable parts from one image and HoloPart (MIT) completes hidden parts.

Source of the finding: [docs/research/3d-landscape-2026-10.md](../../docs/research/3d-landscape-2026-10.md).

## Step 0: re-derive the current state

    sed -n 1,50p workers/segment/README.md
    grep -rln "restyle" src pages | head

## Tasks

1. Add a parts mode: image to part-separated GLB (named nodes per part) via PartCrafter; HoloPart completes occluded parts of an existing mesh already segmented by SAM.
2. Restyle Studio: select a part, recolor, swap or regenerate just that part, then reassemble.
3. Keep node names stable so Order 078 (keep the rig) can preserve them.
4. Docs, worker README, changelog.

## Definition of done

- [ ] A real image yields at least 3 named part nodes and one part is retextured without touching the others.
- [ ] `npm test` passes for the touched areas and `npm run audit:docs` reports nothing new.
- [ ] Docs, STRUCTURE.md row where a surface or directory landed, and a `data/changelog.json` entry (then `npm run build:pages`).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. |
| GPU quota | File the increase, route to another region or class, continue. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if no longer permissive, switch to reference-only and build our own. |
| Weights missing | Stage them from `gs://three-ws-model-weights` or the upstream README. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/070-best3d-04-editable-parts.md`) and append a dated entry to [_context/best3d-PROGRESS.md](_context/best3d-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
