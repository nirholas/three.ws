# nvidia 09: NVIDIA Cosmos Reason judges generated 3D models for physical plausibility in the Forge quality gate

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3259.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The Forge quality gate ([api/_lib/forge-quality-gate.js](../../api/_lib/forge-quality-gate.js), [api/_lib/seed-quality.js](../../api/_lib/seed-quality.js)) decides which generated models are good enough. Many failures are physical: floating parts, impossible geometry, wrong scale or orientation. NVIDIA Cosmos Reason is a vision-language model trained for physical common sense. Using it as a judge on multi-view renders is a novel, measurable use of an NVIDIA world model inside a 3D pipeline.

## Step 0: re-derive the current state

    sed -n 1,120p api/_lib/forge-quality-gate.js
    sed -n 1,60p api/_lib/seed-quality.js
    cat api/_lib/migrations/20260812210000_forge_seed_gate_attempts.sql
    curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).data.map(m=>m.id).filter(i=>/cosmos/i.test(i)).forEach(i=>console.log(i)))"

Find how renders for judging are produced and how many labelled gate decisions exist.

## Tasks

1. **Judge prompt and schema**: multi-view renders in, structured verdict out (plausible or not, issues from a fixed list, prompt match, confidence), with reasoning stripped from what is stored.
2. **Eval** against at least 100 real labelled decisions (existing gate attempts with human or downstream outcomes): agreement, precision on rejects, latency. Report in `docs/nvidia/evals/cosmos-reason-judge-<date>.md`.
3. **Shadow mode first**: run alongside the current judge, log both verdicts, change nothing.
4. **Promote by rule**: where Cosmos Reason is measurably better (overall or for a failure class), make it primary or a tie-breaker behind a flag; keep the current judge as fallback.
5. **Admin view** of disagreements with renders, for tuning.
6. **Tests**, docs ([docs/forge-pipeline.md](../../docs/forge-pipeline.md) and [docs/nvidia-models.md](../../docs/nvidia-models.md), anchored edit last), changelog entry if promoted.

## Definition of done

- [ ] Eval report committed; shadow mode logs real verdicts on the dev server (output).
- [ ] The promotion decision matches the eval and is behind a flag.
- [ ] Tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cosmos Reason is not hosted for our key | Record it; if NVIDIA publishes open weights, evaluate it on a GCE GPU VM under evaluation terms and label it as such. |
| Too few labelled decisions | Label more from real stored outputs with a written rubric, recording who labelled and how. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
