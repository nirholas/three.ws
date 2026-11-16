# nvidia 06: NemoGuard guards agent chat: jailbreak detection, content safety on input and output, and per-agent topic control

Status 2026-11-16: code, editor panel, owner endpoint, eval report (docs/nvidia/evals/guardrails-2026-11-16.md), dev-server live check, docs, STRUCTURE row, changelog and pages entry committed. Measured: jailbreak detection 95.0% TPR at 0% FPR on 350 benign prompts, p50 455 ms. Live: jailbreak blocked, benign streamed, off-topic redirected; guardrails suites 151/151 and `npm run audit:docs` has no finding in this order's files. Not archived: full `npm test` exits 1 (41 failures in 21 files, all in other orders' in-flight work: vision, Cosmos i18n, OAuth, audit scripts, Dockerfiles) and `npm run audit:docs` reports 11 findings in other orders' files. Waiting on the owner: git push, deploy:gcp:full (three-ws-api), then the Inception portal product record.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3256.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

NemoGuard content safety screens outbound publishing today ([api/_lib/publish-safety.js](../../api/_lib/publish-safety.js)), not live agent chat. NVIDIA ships three guard models (content safety, jailbreak detection, topic control) on the same key. Agents that business owners embed on their sites need exactly that: refuse jailbreaks, stay safe, and stay on the topics the owner chose. It is also a concrete, measurable NVIDIA safety story.

## Step 0: re-derive the current state

    grep -rn "granite-guardian\|publish-safety\|moderat" api/_lib/*chat* api/brain api/agents 2>/dev/null | head -20
    sed -n 1,80p api/_lib/publish-safety.js
    curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).data.map(m=>m.id).filter(i=>/guard|jailbreak|topic|safety/i.test(i)).forEach(i=>console.log(i)))"

Map where agent chat input and output are screened today and by what. IBM Granite Guardian is also a partner model in the stack; keep it wherever it wins.

## Tasks

1. **Eval** `npm run nvidia:guard-eval` on public held-out sets (for example the test split of NVIDIA's Aegis safety dataset, a jailbreak benchmark, and benign everyday prompts for false positives), measuring true and false positive rates and latency for each NemoGuard model and the current screen. Report in `docs/nvidia/evals/guardrails-<date>.md`.
2. **Input checks**: jailbreak detection and content safety on each user turn, run in parallel within a stated latency budget. Decide and document fail-open or fail-closed per check from the eval.
3. **Output checks**: content safety on the reply without breaking streaming (screen by sentence buffer, stop and replace on a hit).
4. **Topic control**: an owner setting in the agent editor listing allowed topics in plain language; enforced through the topic-control model with a designed, polite redirect message. Off by default.
5. **Observability**: counts of blocks by check per agent visible to the owner, no message text stored beyond the existing retention rules.
6. **Tests** for ordering, budgets, fail modes and the streaming stop; docs ([docs/nvidia-models.md](../../docs/nvidia-models.md) safety section, anchored edit last, and the agent docs); changelog entry.

## Definition of done

- [ ] Eval report committed; the chosen configuration matches it.
- [ ] On the dev server: a known jailbreak is blocked, a benign prompt passes, an off-topic prompt is redirected for an agent with topic control on (outputs in the report).
- [ ] Streaming still streams (timing evidence); tests, `npm test`, `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A guard model is not served on our account | Use the ones that are, record the gap. |
| Latency budget exceeded | Run checks in parallel with the model call and gate only the output; record the trade-off. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
