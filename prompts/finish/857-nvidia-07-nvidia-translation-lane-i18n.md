# nvidia 07: restore site translation with an NVIDIA translation lane and a measured quality bar

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3257.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

three.ws translates its UI with an LLM pipeline ([scripts/i18n-translate.mjs](../../scripts/i18n-translate.mjs)), one of our published NVIDIA forum stories. As of 2026-11-13 the other backends were failing (rate caps, billing). NVIDIA publishes translation-specialized models alongside Nemotron on the same key. A dedicated NVIDIA translation lane with automatic quality checks unblocks the backlog and gives a fresh, measurable follow-up to the forum post.

## Step 0: re-derive the current state

    cat .i18nrc.json | head -60
    node scripts/check-i18n-parity.mjs 2>&1 | tail -20
    grep -n "nvidia" scripts/i18n-translate.mjs | head -20
    curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).data.map(m=>m.id).filter(i=>/translat|riva|nemotron/i.test(i)).forEach(i=>console.log(i)))"

Record missing keys per locale and which providers currently answer.

## Tasks

1. **Model choice per language**: evaluate the NVIDIA translation model(s) and the Nemotron default on a FLORES-200 devtest sample for each configured locale (chrF and a placeholder-integrity score), and pick per language. Report in `docs/nvidia/evals/translation-<date>.md`.
2. **Provider upgrade** in `scripts/i18n-translate.mjs`: the `nvidia` provider routes each language to its chosen model, preserves placeholders, HTML and ICU syntax, never translates brand terms (a glossary including three.ws and $THREE), and retries on 429 with backoff and resume.
3. **Quality gate**: every translated batch passes placeholder and HTML integrity, length sanity and a back-translation similarity check; failures are re-queued, never written.
4. **Run it**: translate the real backlog for every locale that passes the bar and commit one commit per locale.
5. **Tests** for routing, glossary, integrity checks and resume; docs in the i18n docs and [docs/nvidia-models.md](../../docs/nvidia-models.md) (anchored edit, last); changelog entry.

## Definition of done

- [ ] Evaluation report committed with per-language choices.
- [ ] `node scripts/check-i18n-parity.mjs` shows the backlog reduced (before and after counts in the report).
- [ ] Tests pass; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A string being translated names a crypto project other than $THREE | CLAUDE.md commit gate: keep those keys out of the commits, leave them translated in the working tree, and list them in the owner message for approval. |
| Free-tier limits | Run overnight in resumable batches; never drop the quality gate to go faster. |
| A language fails the bar on every model | Leave it untranslated, record the scores. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
