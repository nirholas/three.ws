# grok-startups 09: evaluate Grok 4.7 on real three.ws tasks and route by evidence

Status 2026-11-20: built and baselined (task sets, graders, judge, harness, LLM_ROUTE_<TASK> flags incl. LLM_ROUTE_AGENT_CHAT, report at docs/evals/grok-4-7-on-three-ws.md with the Nemotron 3 Ultra baseline on all 250 inputs). Remaining: the Grok columns, which wait on order 927 (owner installs GROK_API_KEY on Cloud Run), then `npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget`.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3279.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, flipping a production routing flag) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Credits are a reason to try Grok, not a reason to route traffic to it. three.ws runs several LLM tasks where quality is visible to users: agent chat in persona, tool selection in the MCP servers, prompt rewriting before a 3D generation, structured JSON for scene and anatomy specs, and short copy. If Grok 4.7 beats the current lane on any of them at acceptable latency, routing it there improves the product and spends credit that would otherwise expire. If it loses, we know, and the eval report is still a credible public artifact. Routing changes go behind flags, by task, only where the numbers say so.

## Step 0: re-derive the current state

    sed -n 1,120p api/_lib/llm.js
    grep -n "GROK_MODELS\|export const" api/_lib/chat-models.js | head -40
    grep -rn "callLLM\|chatComplete\|llmChat" api --include=*.js | grep -v test | cut -c1-140 | head -40
    ls data/evals 2>/dev/null; ls scripts/*eval* 2>/dev/null
    npm run check:xai-models 2>&1 | tail -20
    gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c GROK_API_KEY

From the call-site list, pick the five highest-traffic LLM tasks with a user-visible output (use `usage_events` counts from production through a read-only `--prod-env` query if a CLI for it exists; otherwise count call sites and say so). Record which provider and model serves each today. Read docs.x.ai for Grok 4.7 parameters (reasoning effort, structured outputs, tool calling) and pricing.

## Tasks

1. **Task sets from real inputs.** For each of the five tasks build 50 inputs from real, non-personal data: public agent personas, real catalog queries, the prompts users typed into the free forge if a privacy-safe source exists (otherwise prompts you write that match the observed length and style distribution, stated as such), real anatomy machine names. Strip anything that identifies a user. Commit as `data/evals/llm-<task>.jsonl` with a README describing the source of each set.
2. **Graders.** Objective graders first: JSON schema validity for structured tasks (use the repo's real schemas), tool-call correctness against the expected tool for MCP selection, length and banned-phrase rules for copy (no dashes), persona consistency by a rubric. A blind pairwise judge for open-ended outputs using a model that is neither of the two being compared, with position swapping to cancel order bias. Write the graders as reusable modules in `scripts/lib/llm-eval/`.
3. **The harness.** `scripts/grok-eval-llm.mjs` (npm script `grok:eval-llm`): runs every task against the current lane and against Grok 4.7 (and one cheaper Grok id from `GROK_MODELS` if one exists), in parallel within rate limits, resumable from a results file, recording quality score, p50 and p95 latency, and cost per 1,000 calls from `api/_lib/xai-pricing.js` if a sibling created it (otherwise a local price table with source URLs). Output `docs/evals/grok-4-7-on-three-ws.md` with the method, a table per task, confidence intervals from bootstrap resampling, failure examples, and a plain recommendation per task.
4. **Routing by flag.** Add a per-task routing override in [api/_lib/llm.js](../../api/_lib/llm.js) (or the module the call sites actually use) read from env (`LLM_ROUTE_<TASK>=grok-4.7`), defaulting to today's behavior. Where Grok wins with a confidence interval that excludes a tie, set the recommended value in the eval doc and the owner message; do not change the default in code without that evidence. Tests cover override on, off and invalid values, plus fall-through to the existing chain on an xAI error.
5. **Docs.** Link the eval from `docs/grok.md` (hot file, small anchored edit). Changelog entry only if a default changed.

## Definition of done

- [ ] Five task sets of 50 real inputs each, committed with provenance.
- [ ] `npx vitest run tests/llm-route-override.test.js tests/llm-eval-graders.test.js` passes.
- [ ] With a key: `npm run grok:eval-llm` completed every task on both lanes and the doc reports real numbers with intervals. Without a key: the harness ran the current lane on all five tasks (the real baseline is committed in the doc), the live Grok call returned the documented 401, and the owner message holds the one command that fills the Grok columns.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No xAI key | Context file, no-key rule. Task sets, graders, harness, baseline and routing flags all land now. |
| The current lane's provider is down (memory notes Vertex billing and dead i18n backends) | Run the baseline on whatever lane production actually serves today (step 0 found it), state it, and keep the harness provider-agnostic. |
| No privacy-safe source of real user prompts | Write inputs matched to observed distribution and say so in the set's README. Never use personal data. |
| A judge model is unavailable | Objective graders alone, stated in the doc. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (Grok columns after order 927, a production routing flag): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (tasks where Grok wins, or the baseline scores without a key).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
