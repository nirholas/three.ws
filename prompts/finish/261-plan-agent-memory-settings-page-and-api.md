# Give the learning loop its owner surface: /settings/memory, memory and user-model routes, learned-skill review

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/261-plan-agent-memory-settings-page-and-api.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 78 of 100 inside the tier). **Area:** agent. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`api/agent/run.js` already injects memory and fires nudges and skill drafts (`api/_lib/agent-learning/runtime.js`), and the tables exist (`api/_lib/migrations/20260922190000_agent_memory_learning.sql`). But the account owner cannot see, edit, delete or switch off any of it: there is no page, no REST route for the account-level memory settings, the user-model document, or the learned-skill review queue. A system that silently remembers things about a person without a visible off switch and per-item delete is a privacy defect, and the prompt requires it. Skill drafts are saved disabled and "notify the user to review"; with no review UI they can never be enabled.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Library complete: `agent-learning/settings.js` (`getMemorySettings`, `updateMemorySettings`, `settingsPatchSchema`: `enabled`, `skill_drafts_enabled`, `nudge_every_turns`), `memory.js` (`listMemories`, `forgetMemory`, `memoryCounts`, `searchAgentMemory`), `user-model.js` (`getUserModel`, `addUserModelEntry`, `updateUserModelEntry`, `deleteUserModelEntry`, `clearUserModel`), `skill-drafts.js` (`listLearnedSkills`, `listSkillVersions`, `proposeSkillEdit`, `rollbackSkill`, `reviewLearnedSkill`), `session-search.js` (`searchSessions`), `tools.js` (agent-facing tools).
- Wired: only `api/agent/run.js` and `api/_lib/skill-candidates.js` import the library.
- Missing: no `pages/settings-memory.html` (the route `/settings/memory` returns 200 only through the generic fallback, the page itself does not exist), no `/api/memory/settings`, `/api/memory/user-model`, `/api/memory/skills` routes (`api/memory/` has only `context.js`, `curate.js`, `graph.js`, `search.js`), no entry in `data/pages.json`, no tests for the learning library (`tests/` has `memory-*.test.js` for the older Memory Studio only), no `docs/agent-memory.md` section for the owner controls.
- Distinct from order 456 (`/settings/mcp-tools`); do not touch that page.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls api/memory pages | grep -iE "memory|settings"
curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/api/memory/settings
curl -s https://three.ws/settings/memory | grep -o '<title>[^<]*'
grep -rn "agent-learning" api src --include=*.js -l | grep -v "_lib/agent-learning"
grep -n "settings/memory" vercel.json data/pages.json
ls tests | grep -iE "agent-learning|learned|user-model"
npm run db:status 2>&1 | tail -8
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first in `tests/agent-learning-settings.test.js`, `tests/agent-learning-user-model.test.js`, `tests/agent-learning-skill-drafts.test.js`: with `enabled=false`, `saveMemory`, `addUserModelEntry` and `draftSkillFromRun` write nothing and `memoryPromptSection` returns empty; `forgetMemory` removes the row from the next prompt section; `settingsPatchSchema` rejects unknown keys and `nudge_every_turns` outside 2 to 50; `qualifiesForDraft` honors the minimums; `rollbackSkill` restores a prior version and bumps the patch; memories of account A are never returned for account B. Fix real defects the tests expose.
2. Routes (one file `api/memory/[action].js` or siblings, auth via the existing session or API key with `memory:write`): `GET|PATCH /api/memory/settings`, `GET /api/memory/items?agent_id=&kind=&q=&before=` and `DELETE /api/memory/items/:id`, `GET|POST /api/memory/user-model`, `PATCH|DELETE /api/memory/user-model/:id`, `DELETE /api/memory/user-model` (clear, requires `confirm=true`), `GET /api/memory/skills?agent_id=`, `POST /api/memory/skills/:id/review` (`enable`), `POST /api/memory/skills/:id/rollback`. Add `vercel.json` routes. Zod-validate every body.
3. Page `pages/settings-memory.html` + `src/settings-memory.js`, route `/settings/memory` in `vercel.json` and entry in `data/pages.json`: global switch (with a confirm explaining that existing memories stay until deleted), user-model editor grouped by `USER_MODEL_SECTIONS` with inline edit and delete, memory list with kind filter, search, per-row delete, counts from `memoryCounts`, learned-skills review queue (draft diff, enable, disable, version history, rollback), nudge cadence control.
4. States on the page: skeleton rows while loading, designed empty states ("Your agent has not saved anything yet. Tell it a preference in chat."), error banner with retry, optimistic delete with undo toast, hover/focus/active on every control, full keyboard support, `prefers-reduced-motion` respected, mobile layout at 400px.
5. Link the page from the account menu and from the agent page "Brain" tab; add the `get_learning_status` read tool only if `api/_mcpagent` lacks an equivalent.
6. Privacy guarantees as tests: memories are excluded from the marketplace transfer path (`api/v1/marketplace/agents`) and from the community skills registry export; assert both in `tests/agent-learning-privacy.test.js`.
7. Docs: `docs/agent-memory.md` (owner controls, privacy, what is injected), linked from `docs/start-here.md` and `docs/agent-runtime.md`; `data/changelog.json` entry tagged `feature`; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/agent-learning-*.test.js` passes, including the off-switch and cross-account isolation tests.
- [ ] Flow in a real browser against `npm run dev`: tell an agent a preference in one session, see it on `/settings/memory`, start a new session and observe it honored, delete it and observe it gone from the next prompt, flip the global switch off and observe no new writes.
- [ ] A completed multi-tool run produces a draft that appears in the review queue, can be enabled, edited and rolled back.
- [ ] `curl` of each new route unauthenticated returns 401, and with a second account cannot read the first account's items (404).
- [ ] No console errors; all four states of the page screenshot-verified.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The learning migration is not applied locally | `npm run db:status`, then apply only that migration to the dev database with `npm run db:migrate`. |
| No LLM key to generate a skill draft | Use the existing brain proxy path `llm.js` already uses; for tests inject the completion function (the library accepts `complete`). |
| Page route collides with a catch-all | Add the explicit `/settings/memory` route above the fallback in `vercel.json`, as `/settings/mcp-tools` does. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/261-plan-agent-memory-settings-page-and-api.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `261-plan-agent-memory-settings-page-and-api.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/21-agent-memory-and-self-improvement.md` (whole file)

~~~~markdown
# 21. Agent memory, cross-session recall, and skills learned from experience

Read `docs/prompts/README.md` first.

## The problem

An agent has a persona and a chat history, and nothing else persists: no memory it curates, no model of the person it works for, no search over its own past sessions, and no way to turn a task it completed into a reusable skill. The best agents run a closed learning loop: they save memories, are nudged to persist what matters, search prior conversations, build a deepening user model, and author skills after complex tasks, then improve those skills while using them.

## Build

- **Memory store:** `agent_memories` migration (agent, kind: fact, preference, procedure, user-model; text, source run or message, confidence, created, last used). Tools `memory_save`, `memory_search`, `memory_list`, `memory_forget` (the last one irreversible, `confirm_delete`). Injected into the system prompt as a bounded, ranked section; ranking by recency and use.
- **Nudges:** the runtime (server loop in `api/agent/run.js` and the local runtime from prompt 20) prompts the agent at the end of a run or every N turns to persist anything worth keeping, with the nudge text in the prompt 03 skill.
- **Session search:** full-text index over messages and run steps (Postgres `tsvector` on Neon; SQLite FTS locally), tool `search_sessions` returning summaries generated on demand and cached.
- **User model:** a structured, editable "about the user" document per account that the agent updates through `memory_save` with kind `user-model`; the user sees and edits it on `/settings/memory` (in `data/pages.json`), with per-memory delete and a global off switch. Every state designed.
- **Skills from experience:** after a run with more than N tool calls succeeds, the runtime drafts a prompt-only custom skill (prompt 04) capturing the procedure, saves it disabled, and notifies the user to review and enable. While a skill is in use, the agent may propose edits; edits are versioned and the user can roll back.
- **Privacy:** memories are per account, never shared across accounts or into the community registry, and excluded from any marketplace transfer (prompt 10) unless the seller opts in.
- **Docs:** `docs/agent-memory.md` linked from `docs/start-here.md` and `docs/agent-runtime.md`; changelog entry tagged `feature`.

## Acceptance

- Tell an agent a preference in one session; a new session honors it without being told.
- A completed multi-step run produces a draft skill visible on the agent's skills page.
- Deleting a memory removes it from the next prompt; the off switch stops all writes.
- `npm test` green.
~~~~

### `docs/research/oss-landscape-2026-10-notes/chat-memory-evals.md` (whole file)

~~~~markdown
# OSS repos that beat three.ws chat, memory, observability and companion surfaces (state as of 2026-10-09)

Method note: star counts and license lines were read from each repo's GitHub page on 2026-10-09 (WebFetch summaries of the repo front page; license text itself not re-read except where a license URL is given). Verdict key: ADOPT-CODE = copy/depend on it, license compatible with Apache-2.0; ADOPT-DESIGN = rebuild the idea; COVERED = three.ws already ships equivalent. three.ws baseline: `@three-ws/agent-memory` is a tiered (working/recall/archival) embeddings store with free-first NVIDIA NIM embeddings, deterministic entity graph, no published LoCoMo/LongMemEval score ([README](../../../packages/agent-memory/README.md)); docs exist for memory, companion, concierge, monitor, persona-hub under [docs/](../../).

## Chat UIs

### Takeaway
Open WebUI (154k) dominates on scale and enterprise features but its license now has a branding clause, so reuse is design-only. MIT/Apache chat UIs (LibreChat, AnythingLLM, Jan, assistant-ui, CopilotKit, AG-UI) are safe to depend on or copy. None ships a 3D-embodied agent in chat; that stays three.ws's moat. The gaps to close are generative UI / AG-UI protocol, resumable streams, artifacts, scheduled agent tasks, and dynamic model routing.

### Cited Findings
- **Open WebUI** https://github.com/open-webui/open-webui : ~154.1k stars (2026-10-09). License: "Open WebUI License", modified BSD-3 with branding clause; page points to LICENSE and LICENSE_HISTORY. Clause effective v0.6.6 (2025-04-19): may not alter/remove "Open WebUI" branding unless <=50 users in 30 days, substantive-contributor written permission, or enterprise license; code up to v0.6.5 stays BSD-3-Clause; CLA for later contributions; Nixpkgs treats it as non-free - [license docs](https://docs.openwebui.com/license/), [analysis](https://wz-it.com/en/blog/open-webui-license-branding-business/), [repo](https://github.com/open-webui/open-webui). Features: RBAC/groups, Filters/Actions/Pipes/Tools/Skills plugins, MCP/OpenAPI tool servers, multi-vector-DB RAG, parallel multi-model chat, voice/video calls, persistent memory, notes, channels, calendar + scheduled automations, Open Terminal agent, SCIM/SSO/LDAP, OpenTelemetry. Commercial reuse: an Apache-2.0 platform may not copy post-v0.6.5 code without carrying the branding obligation (and cannot rebrand a 50+ user deployment). Verdict: ADOPT-DESIGN (channels, scheduled automations, parallel multi-model compare, OTel export).
- **LibreChat** https://github.com/danny-avila/LibreChat : ~45.5k stars, MIT. Standout: MCP, reusable Skills and Subagents, sandboxed code interpreter, Artifacts (React/HTML/Mermaid), resumable streams synced across tabs/devices, OTel + Langfuse export, OAuth2/LDAP - [repo](https://github.com/danny-avila/LibreChat). Verdict: ADOPT-CODE for resumable-stream and artifacts patterns (MIT is Apache-compatible, keep notice); three.ws has a Claude.ai artifact embed but not in-chat code artifacts/interpreter.
- **LobeChat (LobeHub)** https://github.com/lobehub/lobe-chat : ~83.1k stars. License ambiguous on page: footer says "LobeHub Community License", badge says Apache 2.0; resolve against the LICENSE file before any reuse. Standout: Agent Builder from a description, Agent Groups with shared context, Operator (hire/schedule/report agents), IM Gateway to messaging apps, editable structured Personal Memory, 10,000+ tools/MCP plugins - [repo](https://github.com/lobehub/lobe-chat). Verdict: ADOPT-DESIGN (agent groups, editable memory view, IM gateway); do not copy code until license confirmed.
- **AnythingLLM** https://github.com/Mintplex-Labs/anything-llm : ~66.9k stars, MIT. Standout: dynamic model routing rules, memories, cron-scheduled agent tasks, skill selection cutting tokens up to 80%, no-code agent builder, embeddable website chat widget (Docker), citations on documents - [repo](https://github.com/Mintplex-Labs/anything-llm). Direct competitor to three.ws Concierge/Assistant widget. Verdict: ADOPT-DESIGN (model routing, source citations, token-saving skill selection); concierge otherwise COVERED, and three.ws adds a 3D body.
- **Jan** https://github.com/janhq/jan : ~44.9k stars, Apache-2.0. Local models from Hugging Face, OpenAI-compatible server at localhost:1337, MCP, custom assistants, fully offline - [repo](https://github.com/janhq/jan). Verdict: COVERED for chat; ADOPT-DESIGN only for offline/local-model lane (desktop companion app).
- **Cherry Studio** https://github.com/CherryHQ/cherry-studio : ~52.5k stars. AGPL-3.0 Community Edition; commercial license with AGPL exemption via bd@cherry-ai.com; Enterprise Edition separate. 300+ preset assistants, multi-model simultaneous chat, WebDAV backup, MCP - [repo](https://github.com/CherryHQ/cherry-studio). AGPL means no code copy into Apache-2.0. Verdict: ADOPT-DESIGN (assistant preset gallery; three.ws already has persona hub).
- **assistant-ui** https://github.com/assistant-ui/assistant-ui : ~12.5k stars, MIT (optional paid Assistant Cloud). Composable Thread/Message/Composer primitives, generative UI from tool calls, inline human approvals, accessibility, LangGraph + AG-UI/A2A adapters - [repo](https://github.com/assistant-ui/assistant-ui). Verdict: ADOPT-CODE as a dependency or reference for tool-call-to-component rendering and approvals.
- **CopilotKit** https://github.com/CopilotKit/CopilotKit : ~37.9k stars, MIT source. Generative UI, shared agent-UI state, human-in-the-loop, `useAgent` hook, React/Angular/Vue/RN/Slack/Teams; paid "Intelligence" platform adds threads, user memories, analytics (not OSS) - [repo](https://github.com/CopilotKit/CopilotKit). Verdict: ADOPT-DESIGN (shared state sync between agent and embodied 3D UI).
- **AG-UI protocol** https://github.com/ag-ui-protocol/ag-ui : ~16.4k stars, MIT. "Open, lightweight, event-based protocol" for agent-to-user-app, complements MCP (tools) and A2A (agent-to-agent). README claims adoption by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI (self-reported) - [repo](https://github.com/ag-ui-protocol/ag-ui). Verdict: ADOPT-CODE (emit/consume AG-UI events from the agent runtime and embodiment layer; three.ws's Embodiment and Spatial MCP could be an AG-UI event extension). Highest-leverage standard to align with.

## Agent-memory systems

### Takeaway
Every serious entrant publishes >88% on LoCoMo/LongMemEval, but all numbers are vendor-reported on differing harnesses and the Mem0-vs-Zep dispute shows they are not comparable. Apache/MIT licensing means Graphiti, Cognee, Mem0, Supermemory and Memobase patterns can be adopted outright. three.ws's gaps: temporal fact invalidation, a published benchmark score, contradiction handling, user-profile synthesis, forget/improve verbs.

### Cited Findings
- **Mem0** https://github.com/mem0ai/mem0 : ~66.9k stars (2026-10-09), Apache-2.0. LoCoMo 92.5 and LongMemEval 94.4 with April 2026 algorithm (old: 71.4 / 67.8); BEAM 64.1 (1M) / 48.6 (10M); under ~7,000 tokens per retrieval. Scores are from the managed platform; OSS SDK "directionally similar but not identical" - [repo](https://github.com/mem0ai/mem0), [research](https://mem0.ai/research). An earlier page cited 91.6/93.4 - [Mem0 vs Zep](https://mem0.ai/blog/zep-vs-mem0-which-ai-memory-layer-should-you-choose). Verdict: ADOPT-DESIGN (single-pass hierarchical extraction, multi-signal retrieval) while keeping packages/agent-memory; ADOPT-CODE is possible (Apache-2.0).
- **Zep / Graphiti** https://github.com/getzep/graphiti : ~31.6k stars, Apache-2.0. Temporal knowledge graph: facts have validity windows and are invalidated not deleted, episode provenance, Pydantic ontologies, hybrid semantic+BM25+graph retrieval, Neo4j/FalkorDB/Neptune backends, MCP server, telemetry on by default (disable `GRAPHITI_TELEMETRY_ENABLED=false`) - [repo](https://github.com/getzep/graphiti). Zep self-reports 94.7% LoCoMo / 90.2% LongMemEval ([Zep](https://getzep.com/research)); Mem0 cites 80.3% / 71.2% for Zep ([Mem0](https://mem0.ai/blog/zep-vs-mem0-which-ai-memory-layer-should-you-choose)); contested. Verdict: ADOPT-DESIGN, top priority: temporal validity + provenance on top of three.ws's existing entity co-occurrence graph (three.ws graph is deterministic co-occurrence only).
- **Letta (MemGPT)** https://github.com/letta-ai/letta : ~25.1k stars, Apache-2.0. Pivoted to stateful agent harness (letta-code), TUI, desktop/web/mobile, Slack/Telegram/Discord, TS Agent SDK; V1 server archived - [repo](https://github.com/letta-ai/letta). 83.2% LoCoMo only in an unverified community table - [comparison](https://cdn.jsdelivr.net/gh/rohitg00/agentmemory@main/benchmark/COMPARISON.md). Verdict: ADOPT-DESIGN (self-editing memory blocks; three.ws has working/recall/archival tiers = COVERED in concept).
- **Cognee** https://github.com/topoteretes/cognee : ~31.9k stars, Apache-2.0. `remember`/`recall`/`improve`/`forget` verbs, local-only mode with GLiNER + local embeddings (no API key), Python/TS/Rust SDKs, MCP, migration tools from Mem0/Letta/Zep/Graphiti, graph viz UI - [repo](https://github.com/topoteretes/cognee). Verdict: ADOPT-DESIGN (improve/forget, import-from-competitor migration, local-no-key mode).
- **Supermemory** https://github.com/supermemoryai/supermemory : ~31.2k stars, MIT. Fact extraction with contradiction/expiry handling, static+recent user profile in one call, hybrid RAG+memory query, connectors (Drive, Gmail, Notion, OneDrive, GitHub), OCR/video, MCP, local mode. Self-reports #1 on LongMemEval, LoCoMo, ConvoMem; LongMemEval 95% Recall@15 at ~720 tokens - [repo](https://github.com/supermemoryai/supermemory). Not independently verified. Verdict: ADOPT-CODE/DESIGN for user-profile synthesis and connectors (three.ws already seeds memory from X, Farcaster, GitHub per docs).
- **Memobase** https://github.com/memodb-io/memobase : ~2.9k stars, Apache-2.0. "Memory for User, not Agent": configurable profile schema + event timeline, buffered batch flush, fixed 3 LLM calls per run, Go/Node/Python SDKs; claims LoCoMo SOTA without numbers on the page - [repo](https://github.com/memodb-io/memobase). Verdict: ADOPT-DESIGN (profile+timeline for the personal companion).
- **MemOS** https://github.com/MemTensor/MemOS : ~11.8k stars, Apache-2.0. Graph memory, multimodal (text/images/tool traces/personas), "memory cubes" with isolation/sharing, async MemScheduler, natural-language memory correction. Self-reported: LoCoMo 88.83, LongMemEval 89.20, PersonaMem v2 40.58, HaluMem 80.91, BEAM-10M 56.75 (OmniMemEval, no independent verification) - [repo](https://github.com/MemTensor/MemOS). Verdict: ADOPT-DESIGN (memory cubes map to per-agent/per-household memory sharing; NL correction UX).
- **2026 entrants (self-reported, single sources):** "Agent Zero Memory" paper claims 95.60% LongMemEval and 93.60% LoCoMo - [arXiv 2608.29606](https://arxiv.org/pdf/2608.29606); agentmemory (rohitg00) 95.2% LongMemEval-S self-measured - [comparison](https://cdn.jsdelivr.net/gh/rohitg00/agentmemory@main/benchmark/COMPARISON.md); Mastra cited at 94.87% LongMemEval in the arXiv paper; memU listed ~13.3k stars by a third-party directory (date unclear) - [SourcePulse](https://www.sourcepulse.org/projects/11539371). Treat as unverified.
- Benchmark caveat: LoCoMo is near-saturated and both benchmarks are contested; numbers from different harnesses/judges are not comparable - [search synthesis](https://mem0.ai/research).

## Observability and evaluation

### Takeaway
Langfuse, Opik, Helicone, DeepEval, Promptfoo, OpenLLMetry and Laminar are permissively licensed (MIT/Apache) and can be integrated or exported to. Phoenix is Elastic License 2.0: usable as a service dependency but not copyable code. three.ws's agent monitor, analytics, session-to-test recorder and feedback loop are product-embedded; competitors beat them on generic LLM tracing, LLM-as-judge metrics, datasets/experiments and prompt versioning.

### Cited Findings
- **Langfuse** https://github.com/langfuse/langfuse : ~35.6k stars; MIT except `ee` folders (not MIT; do not copy those) - [repo](https://github.com/langfuse/langfuse). Tracing, prompt management with caching, LLM-as-judge + manual labeling evals, datasets, playground jump-from-trace. Verdict: ADOPT-CODE as an optional exporter (LibreChat already ships Langfuse); ADOPT-DESIGN for prompt versioning and trace-to-playground in Agent Monitor.
- **Arize Phoenix** https://github.com/Arize-ai/phoenix : ~11.8k stars; **Elastic License 2.0 (ELv2)**, copyright Arize AI, some patent protected - [repo](https://github.com/Arize-ai/phoenix). OTel/OpenInference tracing, versioned datasets+experiments, PXI debugging agent, remote MCP server over traces. Commercial reuse: you may run it, but ELv2 forbids offering it as a hosted/managed service to third parties; cannot copy into an Apache-2.0 distribution. Verdict: ADOPT-DESIGN (MCP server over own traces; agent-that-debugs-traces).
- **Opik (Comet)** https://github.com/comet-ml/opik : ~22.5k stars, Apache-2.0 whole platform. Agent tracing, eval metrics (hallucination, moderation, RAG), Agent Optimizer SDK, guardrails, online eval rules, PyTest integration, MCP server - [repo](https://github.com/comet-ml/opik). Verdict: ADOPT-CODE (guardrail and online-eval rule concepts; Apache-compatible); three.ws recorder is session-to-test, they are CI-eval.
- **Helicone** https://github.com/Helicone/helicone : ~6.2k stars, Apache-2.0, appears actively developed on the page (no maintenance notice found; I did not check the project blog) - [repo](https://github.com/Helicone/helicone). AI gateway (100+ models, fallbacks), cost/latency analytics, PostHog export, public LLM cost API. Verdict: COVERED mostly (platform analytics, upstream resilience toolkit); ADOPT-DESIGN for public cost API.
- **Promptfoo** https://github.com/promptfoo/promptfoo : ~25.8k stars, MIT. README: "Promptfoo is now part of OpenAI" and remains MIT. Local evals, red teaming, side-by-side model comparison, CI code scanning - [repo](https://github.com/promptfoo/promptfoo). Verdict: ADOPT-CODE for CI red-team/eval of agent personas (MIT); watch vendor-neutrality risk after OpenAI acquisition.
- **DeepEval** https://github.com/confident-ai/deepeval : ~18.7k stars, Apache-2.0. Agent metrics (task completion, tool correctness, plan quality), multi-turn conversation and MCP metrics, synthetic datasets, pytest-style runs - [repo](https://github.com/confident-ai/deepeval). Verdict: ADOPT-CODE; strongest fit to extend the session-to-test recorder with multi-turn and tool-correctness scoring.
- **OpenLLMetry (Traceloop)** https://github.com/traceloop/openllmetry : ~7.5k stars, Apache-2.0. OTel instrumentations for LLM providers, vector DBs, frameworks, MCP; ~two dozen backends; telemetry removed in >=0.49.2 - [repo](https://github.com/traceloop/openllmetry). Verdict: ADOPT-CODE (emit standard OTel spans from the agent runtime so any backend works).
- **Laminar** https://github.com/lmnr-ai/lmnr : ~3.4k stars, Apache-2.0, Rust backend. Plain-English "Signals" that watch agent behavior and alert to Slack, SQL over traces via MCP/CLI, dashboards - [repo](https://github.com/lmnr-ai/lmnr). Verdict: ADOPT-DESIGN (natural-language behavior alerts for Agent Monitor fleet board).

## Character and companion platforms

### Takeaway
SillyTavern (AGPL) and RisuAI (GPL-3.0) are copyleft, so only their file formats and ideas can be used. The Character Card V2 spec is the de facto import format; V3 is a draft proposal (MIT repo). AIRI (MIT, ~50k stars) is the closest 3D/Live2D-embodied persistent-companion competitor and is code-adoptable; it still lists its memory ("Memory Alaya") as work in progress.

### Cited Findings
- **SillyTavern** https://github.com/SillyTavern/SillyTavern : ~34.3k stars, AGPL-3.0 (third-party parts MIT/Apache/OFL) - [repo](https://github.com/SillyTavern/SillyTavern). Lorebooks (WorldInfo), many backends, TTS, image gen via A1111/ComfyUI, extensions, visual novel mode. Commercial reuse: copying code forces AGPL on the combined work and network-use source disclosure; no. Verdict: ADOPT-DESIGN (lorebook/world-info keyword-triggered context injection; character card import for persona hub).
- **RisuAI** https://github.com/kwaroran/Risuai : ~1.7k stars, GPL-3.0 (as shown on page) - [repo](https://github.com/kwaroran/Risuai). Emotion images, group chats, plugins, regex scripts, lorebook, HypaMemory V2/V3 and SupaMemory context compression. Verdict: ADOPT-DESIGN (compression-based long-chat memory; emotion-mapped expression, which three.ws does with a 3D body so COVERED). Note: a different fork "RisuAI/RisuAI" has 2 stars; the original is kwaroran.
- **Character Card V2 spec** https://github.com/malfoyslastname/character-card-spec-v2 : fields `spec: "chara_card_v2"`, `data` with name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings, character_book, tags, creator, character_version, extensions; page states no license - [spec](https://github.com/malfoyslastname/character-card-spec-v2). Verdict: ADOPT-CODE (import/export V2 cards in persona hub; format interop, license unstated so implement from the spec).
- **Character Card V3 spec** https://github.com/kwaroran/character-card-spec-v3 : draft "updated spec built on CCv2", MIT license listed, finalization pending ("Living Standard" goal); field/asset details are in SPEC_V3.md which I did not read - [repo](https://github.com/kwaroran/character-card-spec-v3). Verdict: ADOPT-CODE for import once read; supports embedded assets that could carry a GLB/VRM body.
- **AIRI (moeru-ai)** https://github.com/moeru-ai/airi : ~50.2k stars, MIT. VRM and Live2D avatars, auto blink/look-at/idle, browser/Discord audio input, multi-provider TTS (ElevenLabs, Azure, OpenAI-compatible, Kokoro), in-browser DuckDB WASM/pglite, web+macOS+Windows, self-described "self hosted, you-owned Grok Companion"; "Memory Alaya" WIP - [repo](https://github.com/moeru-ai/airi). Verdict: ADOPT-CODE for VRM/Live2D look-at and blink layers and client-side talking detection (check against three.ws procedural animation, partly COVERED); three.ws leads on memory, wallet, marketplace.
- Other 2026 open companions (unverified, from aggregator listings, star counts undated): ClawSoul (AGPL-3.0, Markdown file memory, daily schedule, selfie generation) - [PyPI](https://pypi.org/project/clawsoul-ai/); Digital Life Project 2 / DLP3D (MIT, real-time 3D expressive avatars) and ElizaOS (character framework with pgvector memory) - [listing](https://fast.io/resources/top-openclaw-tools-ai-companion-character-chat-apps/); ZcChat desktop pet; Nekro Agent.

## Inferences
- The ordered adoption list by leverage: (1) AG-UI events in the agent runtime, (2) Graphiti-style temporal fact invalidation + provenance in packages/agent-memory, (3) DeepEval/Promptfoo-style multi-turn and tool-correctness scoring in the session-to-test recorder, (4) OTel export via OpenLLMetry/Langfuse from Agent Monitor, (5) Character Card V2/V3 import and SillyTavern-style lorebooks in persona hub, (6) a published, reproducible LoCoMo/LongMemEval score for agent-memory.
- Licenses that block copying: AGPL (SillyTavern, Cherry Studio CE), GPL-3.0 (RisuAI), ELv2 (Phoenix), Langfuse `ee`, Open WebUI post-v0.6.5 (branding), LobeChat (unresolved).
- No surveyed chat UI or companion repo combines a skinned 3D body that is the chat surface with a wallet-backed agent economy; AIRI is the nearest.

## Gaps
- Exact current versions and release dates were not captured (GitHub pages did not render release data).
- LobeChat's actual LICENSE text (Community License vs Apache-2.0) not resolved.
- Character Card V3 field list (SPEC_V3.md) not read; Memobase exact LoCoMo numbers not found.
- Supermemory, MemOS, Zep, Letta benchmark numbers are all self-reported; no independent leaderboard found. Helicone maintenance status not checked beyond its README.
- Star counts come from WebFetch summarization of the repo page and may be rounded ("k"); no GitHub API cross-check.
- No hands-on audit of three.ws chat UI against each feature; three.ws baseline comes from the agent-memory README and doc filenames only.
~~~~

