# quality-bar: the GCP-credit quality campaign

Owner directive 2026-07-16: spend the Google Cloud credits liberally to make the platform's
UX and UI excellent and 3D generations as real-looking as IRL people and objects. No new
non-GCP paid APIs. Agents complete their work order 100% and never stop to ask questions.

**Read `quality-bar-_shared.md` before any work order.** Each work order is also self-contained: paste the
file into a fresh Claude Code chat and it runs.

## The thesis

IRL-real 3D is a chain and every work order owns one link: photoreal reference images, then the
strongest mesh and texture model at fleet scale, then complete PBR materials, then cinematic
viewers, wrapped in a flagship UX, measured so it cannot regress, with humans as the hardest
special case.

## Open work orders

| # | File | Owns | State |
|---|------|------|-------|
| 03 | [03-gpu-fleet-scaleout.md](../006-quality-bar-03-gpu-fleet-scaleout.md) | Scale ceilings, cold-start honesty, keep-warm, load test | Partial. Cold-start honesty (task 2) and keep-warm (task 3) are DONE and verified; do not redo them. Scale ceilings (task 1) need one `gcloud auth login`. The load test (tasks 4-5) is blocked by a production outage, not by capacity: every `/api/forge` generation fails on a rejected object-storage credential, so nothing can be measured until it is rotated and the pending commits deploy. |
| 04 | [04-pbr-texture-material-realism.md](../003-quality-bar-04-pbr-texture-material-realism.md) | Full PBR sets, measured presets, skin/eye/hair | Partial. Everything but the bench delta is verified: the channel matrix, the derive pass wired opt-out into `forge-store.js`, the presets rendered under all four shipped HDRIs (`docs/assets/material-presets/`), the avatar skin/eye/hair readback at 320/768/1440 (the check had been aimed at `/viewer`, which never runs that pass, and had been reporting zero meshes), and the mobile payload gate with measured 4K byte sizes (`npm run check:glb:payload`). The quality-bench comparison needs Vertex, and this Codespace's gcloud credentials have expired: `gcloud auth application-default login` unblocks it. |
| 07 | [07-design-system-sweep.md](../002-quality-bar-07-design-system-sweep.md) | Tokens, states, microinteractions sitewide | Open |
| 08 | [08-mobile-performance.md](../005-quality-bar-08-mobile-performance.md) | Mobile excellence, GLB delivery | Partial. A measured baseline exists in `_generated/08/`; the fixes and the re-measure are open. |
| 10 | [10-avatar-likeness-irl-people.md](../007-quality-bar-10-avatar-likeness-irl-people.md) | IRL people: likeness, hands, rig, AR | Partial. Animation dignity is proven across ten rig conventions; one runtime-lane defect plus the likeness audit are open. |

Retired after verification (readable in git history): 01 photoreal reference pipeline, 02 the
Hunyuan3D flagship lane, 05 cinematic viewers, 06 the `/forge` generation flow (the pre-submit
progress channel, `api/_lib/forge-progress.js`, so the reference view appears while the POST is
still open; the stacked-layout reveal; the designed storage-outage state; reduced-motion and the
result-moment click-through), 09 the realism eval harness (now `scripts/quality-bench.mjs` plus
the weekly cron).

Suggested order: 04, 07 and 08 have no dependencies and can run in parallel. 03 unblocks
throughput. 10 lands best after 04.

## Ground rules recap (full versions in `quality-bar-_shared.md` and `CLAUDE.md`)

- GCP spend approved; no new external paid APIs; never trade quality for cost.
- Explicit-path commits only; concurrent agents share this worktree; no push or external post
  without the owner saying so. GCP deploys of the surface a work order owns are in scope.
- Every user-visible change gets a `data/changelog.json` entry. Every claim is verified with the
  receipts in the final report. Blockers are routed around and documented, never asked about.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'quality-bar-README' prompts/finish/
       git rm prompts/finish/_context/quality-bar-README.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.
