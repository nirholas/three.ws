# best3d 09: Real VRM: three-vrm integration and orphaned-avatar import

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

`src/game/vrm-loader.js` documents that it does no spring bones, MToon, expressions or look-at. pixiv/three-vrm (MIT) does all of it and loads `.vrma`. The largest cross-game avatar SDK shut down on 2026-01-31, orphaning every embed that used it.

Source of the finding: [docs/research/3d-landscape-2026-10.md](../../docs/research/3d-landscape-2026-10.md).

## Step 0: re-derive the current state

    sed -n 1,60p src/game/vrm-loader.js; grep -n "three-vrm" package.json

## Tasks

1. Add `@pixiv/three-vrm` and replace the hand loader: MToon, spring bones, constraints, look-at, the 18 expression presets, VRM 0.x and 1.0.
2. Map expression presets onto the ARKit-52 driver so voice and face capture drive VRM avatars.
3. Load `.vrma` clips into the animation library through the retargeter.
4. Import landing: accept an avatar GLB or VRM exported from the shut-down SDK, repair its rig through `glb-canonicalize`, and save it to the user's account. The outreach campaign is order 934 (owner-gated).
5. Update docs/avatar-engines.md and tests/glb-canonicalize cases.

## Definition of done

- [ ] A real VRM 1.0 file shows spring-bone motion and an expression change in the viewer.
- [ ] A .vrma clip plays on a VRM and on a non-VRM humanoid.
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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/075-best3d-09-three-vrm.md`) and append a dated entry to [_context/best3d-PROGRESS.md](_context/best3d-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
