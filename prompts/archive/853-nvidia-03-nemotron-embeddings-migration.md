# nvidia 03: agent memory moves to the newest Nemotron embedder with a measured win and no retrieval gap during migration

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3253.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Agent memory and knowledge retrieval embed with `nvidia/nemotron-3-embed-1b` ([api/_lib/embeddings.js](../../api/_lib/embeddings.js)) while a newer Nemotron embedder is in the catalog. Switching embedders is not a config change: every stored vector was produced by the old model and cannot be compared with the new one. Done carelessly it silently breaks retrieval; done properly it is a measured quality win and a credible NVIDIA adoption story.

## Step 0: re-derive the current state

    sed -n 1,140p api/_lib/embeddings.js
    grep -rln "vector(" api/_lib/migrations | xargs grep -n "vector(" | head
    grep -rln "embeddings.js" api | head -20
    curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).data.map(m=>m.id).filter(i=>/embed/i.test(i)).forEach(i=>console.log(i)))"

Count stored vectors per table and model (read-only) and note the vector dimension each column uses.

## Tasks

1. **Retrieval eval** `npm run nvidia:embed-eval`: a labelled set built from the three.ws docs corpus (questions written against specific doc sections, relevance labels recorded) plus a public BEIR subset; recall@5, recall@10, nDCG@10 and latency for old versus new (and any supported reduced dimension). Report in `docs/nvidia/evals/embeddings-<date>.md`.
2. **Model-tagged vectors.** If the new model wins: every stored vector carries its model id and dimension; a query is embedded with the same model as the vectors it is compared against. Test-first: no code path may compare vectors from different models.
3. **Resumable re-embed.** A batch (Cloud Run job or a cron with a cursor) that re-embeds every row with the new model, throttled to the NIM limits, idempotent, with `npm run nvidia:reembed -- --status` showing progress per table. Reads use new vectors where present and old ones elsewhere until a table reaches 100 percent; then cutover per table.
4. **Old vectors** are kept until the cutover is verified by the eval on production data, then removed in a separate migration noted for the owner if the table is large.
5. **Docs.** Embeddings section of [docs/nvidia-models.md](../../docs/nvidia-models.md) (anchored edit, last); changelog entry.

## Definition of done

- [ ] Eval report with numbers committed.
- [ ] Mixed-model comparison is impossible (test output in the report).
- [ ] Re-embed runs against the real database with progress visible, or the eval shows no win and nothing was migrated (state which).
- [ ] `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The corpus is large and the free tier is slow | Run the re-embed as a Cloud Run job over hours with a cursor; reads stay correct throughout. |
| New dimension differs from the column | Add a new column or table per model with its own index (migration via the documented path); never cast or truncate vectors. |
| The new model does not win | Commit the eval, change nothing, say so. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
