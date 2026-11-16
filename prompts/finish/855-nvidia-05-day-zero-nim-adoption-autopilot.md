# nvidia 05: a new NVIDIA model goes from catalog appearance to an evaluated, ready-to-apply proposal automatically

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3255.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

NVIDIA reshares partners whose news is NVIDIA's news, and the strongest version is "this release is live in a product the day it shipped" ([docs/nvidia-visibility-map.md](../../docs/nvidia-visibility-map.md), Day-0 adoption). [api/cron/free-model-audit.js](../../api/cron/free-model-audit.js) already detects a new model id within six hours, but everything after the alert is manual and takes a day, which turns a day-0 post into a day-3 changelog line. Automating the evaluation and the proposal makes day 0 routine.

## Step 0: re-derive the current state

    sed -n 1,200p api/cron/free-model-audit.js
    grep -rn "nim-new-release" api scripts | head
    ls data/evals docs/nvidia/evals 2>/dev/null
    grep -n "first rung\|FALLBACK\|rungs" api/_lib/llm.js api/_lib/vision.js api/_lib/embeddings.js | head -20

## Tasks

1. **Lane classifier**: given a new model id, determine its lane (chat, vision, embeddings, rerank, safety, speech) from catalog metadata and a probe, never from the name alone.
2. **Eval harness** `scripts/nvidia-lane-eval.mjs`: per lane a versioned eval set in `data/evals/<lane>/` (reuse sets a sibling created if present, else build licence-clean ones with recorded sources), run against the new model and the lane's current first rung; quality, latency p50 and p95, error rate, format adherence; JSON and markdown output.
3. **Pipeline**: the audit cron enqueues an eval job (Cloud Run job or a queued cron step, never inline in the audit request) and stores results in a table (migration). On completion, the ops alert carries the verdict, the report link, the exact rung config diff to apply, and a post draft in the visibility map's format (what it now does, the number, tagging per the table). Production config is never switched automatically.
4. **Admin view** listing releases, lanes, verdicts and reports, behind the existing admin guard.
5. **Backfill once**: run the pipeline over the backlog releases named in the visibility map and commit their reports.
6. **Tests** for classification, enqueue idempotency, report shape and the no-auto-switch guarantee; docs in the visibility map's Day-0 section (anchored edit) and [docs/nvidia-models.md](../../docs/nvidia-models.md); changelog entry.

## Definition of done

- [ ] Running the pipeline on one real catalog model produces a stored verdict, report, config diff and post draft (paths in the report).
- [ ] The backlog releases have committed reports.
- [ ] Tests pass, including the guarantee that production config never changes automatically; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No new release appears during the session | Drive the pipeline with a real existing catalog model through the same entry point the cron uses. |
| A lane has no eval set yet | Build it, licence-clean, with sources recorded. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
