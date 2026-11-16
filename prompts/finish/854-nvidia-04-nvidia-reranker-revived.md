# nvidia 04: knowledge retrieval gets a working NVIDIA reranker again, enabled only if it measurably helps

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3254.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

[api/_lib/rerank.js](../../api/_lib/rerank.js) is pinned to `nvidia/rerank-qa-mistral-4b`, verified dead since 2026-09-10, and the stage is off. Cross-encoder reranking is the cheapest quality gain in retrieval, and NVIDIA ships current reranking models on the same key. The fix is a verified live model, a measured gain, and protection against the next silent retirement.

## Step 0: re-derive the current state

    sed -n 1,140p api/_lib/rerank.js
    grep -rn "KNOWLEDGE_RERANK_ENABLED\|rerank(" api --include=*.js | head
    curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).data.map(m=>m.id).filter(i=>/rerank/i.test(i)).forEach(i=>console.log(i)))"

Probe each candidate reranker against the retrieval endpoint with a real query and passages and record the HTTP status and response shape for each in the report.

## Tasks

1. **Pin a live reranker** with the probe evidence quoted in the code comment (date, model id, status).
2. **Eval**: on a labelled retrieval set built from the docs corpus (questions with relevance labels, recorded in `data/evals/rerank/`), measure nDCG@5 and answer-chunk hit rate with and without reranking, plus added p50 and p95 latency. Report in `docs/nvidia/evals/rerank-<date>.md`.
3. **Enable by rule**: if the gain clears a stated threshold and added p95 stays under a stated budget, enable by default with a hard timeout and the existing fail-open contract; otherwise leave it opt-in and say why.
4. **Retirement guard**: on 404 or 410 the stage disables itself for a cool-down, records the event once and pages ops through the existing alert path, so a retired model never adds latency to every request.
5. **Tests** for timeout, fail-open, the retirement guard and reordering.
6. **Docs.** Reranking section of [docs/nvidia-models.md](../../docs/nvidia-models.md) (anchored edit, last); changelog entry if enabled.

## Definition of done

- [ ] Probe evidence and eval report committed.
- [ ] A real retrieval on the dev server shows the reranked order and latency (output in the report).
- [ ] Tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No reranker is served on our account | Record the probe results, keep the stage off, add the retirement guard anyway, and note it for the owner to raise with NVIDIA. |
| The gain is too small | Keep it opt-in with the measured numbers in the doc. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
