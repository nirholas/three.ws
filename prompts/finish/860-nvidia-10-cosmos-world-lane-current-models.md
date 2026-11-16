# nvidia 10: the /cosmos world lane moves to current NVIDIA Cosmos models, with worlds conditioned on the avatar and its scene

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3260.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

`/cosmos` renders a photoreal world behind a 3D avatar, but it is pinned to `nvidia/cosmos-predict1-7b` ([api/_lib/env.js](../../api/_lib/env.js), [api/cosmos.js](../../api/cosmos.js)). NVIDIA has shipped newer Cosmos generations since, including control-conditioned transfer models. Running the current models, and conditioning the world on the avatar's own scene, makes the feature better and keeps three.ws a current Cosmos showcase rather than a stale one.

## Step 0: re-derive the current state

    sed -n 1,200p api/cosmos.js
    grep -n -i "cosmos" api/_lib/env.js
    sed -n 1,90p docs/cosmos.md

Read NVIDIA's current Cosmos documentation and the build.nvidia.com catalog for every Cosmos generation endpoint our key can call (model ids, input modes such as text, image and video conditioning, control inputs, durations, job API). Probe each with a real request. Check 30 days of `/api/cosmos` errors in Cloud Logging.

## Tasks

1. **Model ladder**: the best current Cosmos model first, older ones behind it while they are served, each with its own request builder and limits.
2. **Avatar conditioning**: image-to-world from a still of the avatar's current scene so the world matches framing and light; when a control-conditioned model is available, derive depth or edge control from a three.js render of the user's scene so their layout drives the world.
3. **Robust jobs**: poll with backoff, timeouts, resumable status after a page reload, storage through the existing media path, clear failure reasons.
4. **UI** on `/cosmos`: mode picker (text, from my scene), real progress, preview, download, error and empty states.
5. **Measure** generation time and a side-by-side for five prompts old versus new; commit the comparison to `docs/nvidia/evals/cosmos-<date>.md`.
6. **Tests**, docs ([docs/cosmos.md](../../docs/cosmos.md), [docs/nvidia-models.md](../../docs/nvidia-models.md) anchored last), changelog entry, and a post draft for the owner.

## Definition of done

- [ ] A real generation on the dev server completes on the new model in both modes available (output and media path).
- [ ] Comparison doc committed with measured times.
- [ ] Tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No newer Cosmos model is hosted for our key | Keep the ladder ready with the probe evidence, ship the conditioning on the current model, and record the gap. |
| Generation takes minutes | Wait for real results; never stub a preview. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
