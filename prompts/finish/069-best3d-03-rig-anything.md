# best3d 03: Rig non-humanoids: SkinTokens, UniRig and AniGen

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

`workers/rig` rigs humanoids only. VAST's SkinTokens, UniRig and AniGen (all MIT, LICENSE files read 2026-10-09) rig quadrupeds, creatures and props, and AniGen goes image to rigged asset in one pass.

Source of the finding: [docs/research/3d-landscape-2026-10.md](../../docs/research/3d-landscape-2026-10.md).

## Step 0: re-derive the current state

    sed -n 1,60p workers/rig/README.md
    for r in SkinTokens UniRig AniGen; do gh api repos/VAST-AI-Research/$r --jq '[.full_name,.pushed_at[:10],.license.spdx_id]|@tsv'; done

## Tasks

1. Add a non-humanoid branch to `workers/rig`: classify the mesh (humanoid vs other) and route non-humanoids to UniRig skeleton prediction plus SkinTokens skinning. Keep Make-It-Animatable for humanoids.
2. Add AniGen as an image-to-rigged-asset lane in Forge (Forge option "rigged at generation").
3. Output must load in the viewer and survive `src/glb-canonicalize.js`; a rig that cannot map to the canonical set still plays its own clips and falls back per the existing `supportsCanonicalClips()` gate.
4. Rig Doctor: add a non-humanoid report (joint count, max influences, unweighted vertices).
5. Docs, README, changelog.

## Definition of done

- [ ] A real quadruped GLB rigs end to end and plays a clip in the viewer.
- [ ] Humanoid rigging output is unchanged on the existing rig tests.
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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/069-best3d-03-rig-anything.md`) and append a dated entry to [_context/best3d-PROGRESS.md](_context/best3d-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
