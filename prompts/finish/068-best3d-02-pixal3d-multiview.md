# best3d 02: Pixal3D fidelity lane and 1 to 4 image multi-view input in Forge

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

Multi-image input is table stakes at every serious vendor and Forge takes one image. TencentARC/Pixal3D (MIT) back-projects pixel features so the result matches the input photo; MV-Adapter (Apache-2.0) generates consistent extra views.

Source of the finding: [docs/research/3d-landscape-2026-10.md](../../docs/research/3d-landscape-2026-10.md).

## Step 0: re-derive the current state

    gh api repos/TencentARC/Pixal3D --jq '[.stargazers_count,.pushed_at[:10],.license.spdx_id]|@tsv'
    grep -rn "image_url\|imageUrl" api/forge* api/_lib/forge* -l 2>/dev/null | head
    ls workers/model-trellis2 2>/dev/null

## Tasks

1. Run Pixal3D inside the `workers/model-trellis2` image as a second entrypoint (they share the backbone) or as its own worker if dependencies conflict.
2. Extend the Forge request schema with `images: [url...]` (1 to 4) plus an optional view label (front, back, left, right). Validate count and dimensions at the boundary. Single image keeps working unchanged.
3. Add MV-Adapter as the optional view-synthesis rung: when only one image is given and the user picks "fill in the other sides", synthesize views first, then reconstruct.
4. Forge UI: a multi-image drop zone with view labels, the fidelity lane named "Match my photo", real progress from the worker.
5. Docs: api-reference.md Forge section, changelog entry, worker README.

## Definition of done

- [ ] A 3-image request returns a GLB and the forge_creations row records all input URLs.
- [ ] Single-image requests are byte-for-byte the same path as before (existing tests green).
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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/068-best3d-02-pixal3d-multiview.md`) and append a dated entry to [_context/best3d-PROGRESS.md](_context/best3d-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
