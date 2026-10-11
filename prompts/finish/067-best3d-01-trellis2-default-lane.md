# best3d 01: TRELLIS.2 becomes the default image-to-3D lane; Hunyuan3D 2.1 is territory-gated or retired

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

The production default, Hunyuan3D 2.1, ships under a license that excludes the EU, the UK and South Korea for the model and its output (Territory clause, Section 5.c) and caps at 1M MAU. three.ws serves those regions. TRELLIS.2 (microsoft/TRELLIS.2, MIT, 4B flow transformer, PBR with transparency, up to 1536 cubed, 24 GB VRAM) is both the upgrade and the compliance fix. This is the most urgent order in the campaign.

Source of the finding: [docs/research/3d-landscape-2026-10.md](../../docs/research/3d-landscape-2026-10.md).

## Step 0: re-derive the current state

    ls workers | grep model-; sed -n 60,80p workers/model-hunyuan3d/README.md
    grep -rn "hunyuan" api/_lib --include=*.js -il | head -20
    gh api repos/microsoft/TRELLIS.2 --jq '[.stargazers_count,.pushed_at[:10],.license.spdx_id]|@tsv'

## Tasks

1. Create `workers/model-trellis2/` on the pattern of `workers/model-trellis` (own Dockerfile, `cloudbuild.yaml` pinned to the `three-ws-build@` service account, vendored shared modules checked by `npm run check:vendored`, weights staged from `gs://three-ws-model-weights`, GPU class from `docs/ops/gcp-credits-plan.md`). Emit a PBR GLB with alpha preserved, meshopt-compressed through the existing gltfpack step.
2. Register the lane in the Forge lane registry and make it the default for image-to-3D, with the existing failover chain behind it (TRELLIS v1, TripoSG, TripoSR). Expose the resolution tier (512, 1024, 1536) as a request option.
3. Hunyuan3D 2.1 decision: add territory enforcement (country of the requester resolved server side; EU, UK and South Korea never routed to a Tencent lane) and keep it as an explicit lane for other regions, or retire it if TRELLIS.2 quality is at least equal on the Forge benchmark set. Record the measured comparison and the decision in the PROGRESS log.
4. Add the Notice file Hunyuan requires for any region where it stays, and update `workers/model-hunyuan3d/README.md` License section with the territory rule.
5. Write `workers/model-trellis2/README.md`, a `data/changelog.json` entry, and a STRUCTURE.md row.

## Definition of done

- [ ] `node --test` or vitest coverage for the territory router: EU, UK and KR requests never select a Tencent lane.
- [ ] A real generation through the new worker returns a valid GLB (validated with `packages/glb-tools`) and its forge_creations row shows backend trellis2.
- [ ] `npm run check:vendored` passes.
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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/067-best3d-01-trellis2-default-lane.md`) and append a dated entry to [_context/best3d-PROGRESS.md](_context/best3d-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
