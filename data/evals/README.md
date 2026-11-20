# data/evals

Fixed inputs for the platform's model evaluations. Each subdirectory (`chat/`, `embeddings/`, `rerank/`, `vision/` and the rest) belongs to the eval script that names it. The `llm-<task>.jsonl` files below feed `npm run grok:eval-llm` ([scripts/grok-eval-llm.mjs](../../scripts/grok-eval-llm.mjs)); the method and results are in [docs/evals/grok-4-7-on-three-ws.md](../../docs/evals/grok-4-7-on-three-ws.md).

## The five LLM task sets

One JSON object per line, 50 lines per file. Every row carries `id`, `task`, `source` (where the input came from) and `input` (what the harness sends). Sets graded against a known answer also carry `expect`.

The five tasks are the highest-traffic LLM calls whose output a person reads, measured from `usage_events` (kind `llm`, last 30 days, 2026-11-20). News summarisation and the market read were left out: their inputs are third-party publisher text.

| File | Task | Production path | Calls in 30 days |
|---|---|---|---|
| `llm-forge_director.jsonl` | Forge prompt director | `api/_mcp-studio/forge-client.js` and `gpt-forge-client.js` | 11,136 |
| `llm-agent_tools.jsonl` | Agent chat, tool selection | `api/chat.js` | 2,884 (chat total) |
| `llm-agent_chat.jsonl` | Agent chat, persona replies | `api/chat.js` | (same calls) |
| `llm-x_reply.jsonl` | Public X replies | `api/_lib/x-mention-reply.js` | 200 |
| `llm-agent_spec.jsonl` | Agent spec from a brief | `api/agents/suggest-spec.js` | 152 |

No row holds a user id, wallet, handle, email, link to a user's file, or any text that could identify the person who wrote it.

### llm-forge_director.jsonl (real data, 50 rows)

`input`: `{ prompt, director }`. `director` is `mesh` (object, 36 rows) or `avatar` (character, 14 rows), the same split the Forge makes before it picks a director prompt.

- **15 rows, `source: forge_creations`**: real Forge prompts typed by users. Only prompts submitted word for word by two or more different accounts were eligible, so no row is traceable to one person; the 15 were drawn from that pool by a hash order, not chosen by hand. Length 24 to 63 characters, median 47.
- **25 rows, `source: forge_seed_jobs`**: prompts the platform itself wrote to seed the public gallery (12 objects, 13 characters). Median 78 characters.
- **10 rows, `source: forge_autonomous_props`**: prompts the platform's autonomous prop generator wrote. Median 76 characters.

Observed distribution for context (`forge_creations`, all time, 63,270 prompts): 0 to 50 characters 10,820; 50 to 100: 9,385; 100 to 150: 4,812; 150 to 200: 7,116; 200 to 250: 1,604; 250 to 300: 1,162; 300 to 350: 18,777; 350 to 400: 5,660; over 400: 3,934. The duplicate-across-accounts rule keeps the user rows in the short head of that distribution; the platform-written rows cover the middle. Long one-off prompts (300 characters and up) are under-represented on purpose, because a long prompt typed once is the kind that identifies its author.

### llm-agent_tools.jsonl (self-written, 50 rows)

Written for this eval to match what agent chat receives: short imperative requests to the 3D viewer. `input`: `{ message }`. `expect` names the tool the model should call and the arguments it must pass, using these matchers:

| Matcher | Meaning |
|---|---|
| a plain value | equal to that value |
| `{ "$in": [...] }` | one of these values |
| `{ "$hex": "blue" }` | a valid hex colour whose strongest channel is blue (also `red`, `green`) |
| `{ "$nonempty": true }` | present and not empty |
| `{ "$match": "regex" }` | matches, case-insensitive |
| `{ "none": true }` | the model should answer in words and call no tool |
| `"forbid": [...]` | tools that must not be called |

Mix: playAnimation 10, setBgColor 5, setWireframe 3, setGrid 3, setAutoRotate 3, setEnvironment 3, takeScreenshot 3, setSkeleton 2, setTransparentBg 2, loadModel 2, runValidation 2, showMaterialEditor 2, setCameraTarget 2, no tool 8. The two `loadModel` URLs are public sample avatars served by three.ws.

### llm-agent_chat.jsonl (self-written, 50 rows)

Ten personas, five turns each: three on-topic questions, one off-topic question and one prompt-injection attempt asking for the system prompt. `input`: `{ persona_name, persona_prompt, message }`. Every persona carries a checkable rule (writes only in Spanish, stays under 60 words, never uses an exclamation mark, opens with a fixed phrase, and so on), and `expect.rubric` states it: `require_any`, `require_regex`, `forbid_regex`, `language`, `lowercase`, `max_words`, `no_leak`. Personas and questions were written for this eval; none is copied from a user's agent.

### llm-x_reply.jsonl (self-written, 50 rows)

Public posts addressed to the platform's X account, written to match the observed mention traffic. `input`: `{ post, intent }`, intent `chat` (43) or `help` (7), the two intents that get a written reply. Includes the hard cases the reply guard exists for: requests for a price target or investment advice, a link request, a giveaway injection, a contract-address request, a request to tag a person, and a request to use a dash character.

Observed distribution (`x_mention_events`, all 1,347 rows, 2026-11-20): post length p10 28, p25 44, p50 86, p75 177, p90 293 characters. This set: p10 36, p25 55, p50 100, p75 194, p90 272. The real posts were not copied because each is a public post by an identifiable account.

### llm-agent_spec.jsonl (self-written, 50 rows)

Briefs typed into the "describe your agent" box. `input`: `{ brief }`. Five rows are empty (the box left blank, which asks the model to invent an agent); the other 45 run from 35 to 91 characters, median 50. Production briefs were not copied because they are private drafts tied to an account.

## Regenerating results

```bash
npm run grok:eval-llm -- --prod-env                             # current production lane, all five tasks
npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget    # the Grok columns (needs GROK_API_KEY on Cloud Run)
npm run grok:eval-llm -- --retry-failed --concurrency 1         # re-run rows that errored (NIM 429s)
npm run grok:eval-llm -- --regrade                              # re-grade saved outputs after a grader change, no calls
npm run grok:eval-llm -- --report                               # rebuild the doc from saved results
```

`--prod-env` loads the provider keys from the Cloud Run service. Raw results land in [llm-results/](llm-results/) (`results.jsonl`, `judged.jsonl`, `runs.json`) and the report in [docs/evals/grok-4-7-on-three-ws.md](../../docs/evals/grok-4-7-on-three-ws.md). Flags and the result file format are documented at the top of [scripts/grok-eval-llm.mjs](../../scripts/grok-eval-llm.mjs).
