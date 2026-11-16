# nvidia 02: agents see with Nemotron: the vision lane leads with the newest Nemotron VL model, chosen by a measured eval

> Status 2026-11-16: code complete, eval committed (docs/nvidia/evals/vision-2026-11-16.md) and every vision consumer verified live on the dev server. Not archived: the full `npm test` (36 failures in 18 files) and `npm run audit:docs` (16 findings) fail only in other orders' files. Live after the owner pushes and runs `npm run deploy:gcp:full`.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3252.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The visibility map's backlog shows the vision lane ([api/_lib/vision.js](../../api/_lib/vision.js)) runs `meta/llama-3.2-11b-vision-instruct` while NVIDIA ships a Nemotron vision-language model in the same catalog on the same key. "Agents that see, on Nemotron, end to end" is a story NVIDIA's developer accounts promote, but only if the switch is backed by a real eval and does not make any consumer worse.

## Step 0: re-derive the current state

    sed -n 1,120p api/_lib/vision.js
    grep -rln "from '.*vision.js'\|from \"\.\/vision\"" api src | head -30
    curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).data.map(m=>m.id).filter(i=>/vl|vision/i.test(i)).forEach(i=>console.log(i)))"

List every consumer of the vision lane and what it asks (captioning, photo-to-3D precheck, moderation assist, screenshot reading, structured JSON). Load the key from the Cloud Run env per the `self-unblock-playbook` skill if it is not local.

## Tasks

1. **Eval set** `data/evals/vision/` covering each consumer's task with at least 60 images from licence-clean sources (platform assets the platform owns, NVIDIA SimReady renders, CC0 collections), each with an expected answer or a rubric. Record each image's source and licence.
2. **Eval runner** `npm run nvidia:vision-eval`: runs every candidate NVIDIA VL model from step 0 plus the current first rung on the set and reports accuracy per task, JSON-schema adherence, p50 and p95 latency and error rate. Write the report to `docs/nvidia/evals/vision-<date>.md`.
3. **Rung change.** If the Nemotron model wins or ties within a stated threshold, make it the first rung and keep the current model behind it. Handle its specifics: reasoning output stripped before consumers see it, image size and count limits, URL versus base64 input. If it wins only some tasks, route those tasks to it. If it loses, keep the order and publish the eval honestly.
4. **Tests** for rung order, task routing, reasoning stripping and fallback on 404, 410, 429 and timeout.
5. **Docs.** Update the vision section of [docs/nvidia-models.md](../../docs/nvidia-models.md) (anchored edit, last) with the eval numbers; changelog entry; a day-0 style post draft in the eval doc (owner posts).

## Definition of done

- [ ] Eval report committed with numbers for every candidate (path in the report).
- [ ] Each vision consumer verified on the dev server with a real request on the chosen rung (output in the report).
- [ ] Tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The named Nemotron VL id is not served on our account | Evaluate the NVIDIA VL models that are served (step 0 list) and record the absence. |
| Nemotron loses the eval | Keep the current order, commit the eval, and say so. An honest eval is the deliverable. |
| Rate limits slow the eval | Throttle and resume from the last finished item; never shrink the set to finish faster. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
