# Open-source AI agent frameworks and personal-assistant platforms vs three.ws (state as of 2026-10-09)

Method notes for the writer:
- Every star / fork / license SPDX figure below was read from the GitHub REST API (`gh api repos/<owner>/<repo>`, authenticated) on **2026-10-09 05:14 UTC**. The cited URL is the repo page; the API returns the same numbers the page shows. "NOASSERTION" means GitHub could not classify the LICENSE file, and the exact license was then read from the raw LICENSE file (cited).
- The three.ws baseline (what it already ships) was read read-only from the repo: the surfaces list, `STRUCTURE.md`, `workers/agent-gateway/README.md`, `api/_lib/agents-v1/runs.js`, `docs/agent-runtime.md`, `docs/memory.md`, `docs/agent-skills.md`, `docs/multi-agent.md`, `docs/agent-vitals.md`, `package.json`. Repo paths are given as `repo:<path>` because they have no URL.
- Verdict vocabulary: **adopt code** (license lets an Apache-2.0 commercial platform vendor or depend on it; module named), **adopt design, rebuild** (license or language makes copying impractical or forbidden), **already covered**.
- CRYPTO FLAG marks repos tied to a crypto project. three.ws has a commit gate on naming any coin other than $THREE, so anything from these repos must not be named in committed files without owner approval.

## three.ws baseline used to judge "lacks" (from the repo, read-only)

- Chat channels: a shared gateway core serves **Telegram and Discord only** (webhook receivers `api/gateway/telegram.js`, `api/gateway/discord.js`; adapters `workers/agent-gateway/src/adapters/{telegram,discord}.js`), with voice notes, photos, slash commands, and trade previews with Approve / Cancel buttons. No Slack, WhatsApp, Signal, iMessage, Teams or Google Chat adapter exists. `repo:workers/agent-gateway/README.md`
- Durable runs: agents-v1 runs are DB-backed ("A run never lives in one process"; every model call, tool call and result is a step row; `schedule_cron` / `scheduled_for` fields). No graph/DAG API, no state editing or time travel. `repo:api/_lib/agents-v1/runs.js`
- Human-in-the-loop: a seven-layer transaction guard with a per-tool approval policy (`never` / `required` / `always`), dollar caps, rolling windows and an auto-execute ceiling, scoped to fund-moving tools. `repo:docs/agent-runtime.md`
- Memory: two layers, a salience-ranked in-memory store plus Markdown files with YAML frontmatter, one file per topic, four memory types. `repo:docs/memory.md`; packaged as `@three-ws/agent-memory` (surfaces list).
- Skills: an in-app skill bundle format (`manifest.json` + `tools.json` + `handlers.js`) with a marketplace, skill bundles, trials and x402 per-call pricing; plus an external Agent Skills pack that follows the agentskills.io standard. `repo:docs/agent-skills.md`, surfaces list.
- Multi-agent: a frontend `<agent-stage>` that hosts several `<agent-3d>` characters with turn-taking and orchestration patterns; no server-side crew/handoff abstraction. `repo:docs/multi-agent.md`
- Observability: `agent-vitals` answers "can it act right now" (liveness of credentials, models, workers); it is not per-run LLM tracing. `repo:docs/agent-vitals.md`. `package.json` has `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` and none of langfuse / opentelemetry / langgraph / mastra / inngest.
- Agent-to-agent: a native a2a payment mandate path (`api/agents/a2a-mandate.js`, `a2a-call.js`), not the Google A2A protocol. `repo:docs/a2a-payments.md`
- Visual builders: Scene Studio, Tour Builder and Diorama are 3D/tour builders; there is no node-graph builder for agent logic (STRUCTURE.md rows, surfaces list).
- Already strong (do not recommend): MCP servers, x402 paid APIs, marketplace, custodial Solana wallets, coin launchpad, embeddable avatars, multiplayer world, voice cloning, smart-home, iOS / Mac / desktop companion apps (surfaces list).

## Key question 1: Which agent frameworks have the most traction in 2026 and what do users praise?

### Takeaway
Two personal-assistant harnesses born in late 2025 now dwarf every developer framework: OpenClaw (391k stars, the most-starred project on GitHub) and Hermes Agent (252k). Among frameworks, the visual/low-code platforms (n8n 207k, AutoGPT 187k, Dify 158k, Langflow 155k) lead on stars, while the code-first libraries cluster at 20k to 60k (AutoGen 61k in maintenance, CrewAI 59k, Goose 55k, LangGraph 43k, Agno 43k, OpenAI Agents 30k, smolagents 30k, Mastra 29k, Letta 25k). What users praise is consistent: talk-to-it setup in the chat app they already use, memory they can read in plain files, proactive scheduled behavior, and an installable skill ecosystem.

### Cited Findings

Star table, all observed 2026-10-09 05:14 UTC via the GitHub API (stars | forks | SPDX per API | last push | created):
- openclaw/openclaw: 391,499 | 82,300 | MIT | 2026-10-09 | created 2025-11-24. Latest release v2026.9.9 on 2026-10-08. [Source](https://github.com/openclaw/openclaw)
- NousResearch/hermes-agent: 252,089 | 54,397 | MIT | 2026-10-09 | created 2025-07-22. Latest release v0.21.6 on 2026-10-08. [Source](https://github.com/NousResearch/hermes-agent)
- n8n-io/n8n: 206,752 | 61,027 | NOASSERTION (Sustainable Use License, see KQ3) | 2026-10-09. [Source](https://github.com/n8n-io/n8n)
- Significant-Gravitas/AutoGPT: 187,488 | 45,933 | NOASSERTION (PolyForm Shield + MIT split, see KQ3) | 2026-10-09. [Source](https://github.com/Significant-Gravitas/AutoGPT)
- langgenius/dify: 157,953 | 24,946 | NOASSERTION (modified Apache-2.0, see KQ3) | 2026-10-09. [Source](https://github.com/langgenius/dify)
- langflow-ai/langflow: 155,408 | 10,191 | MIT | 2026-10-09. [Source](https://github.com/langflow-ai/langflow)
- browser-use/browser-use: 117,335 | 12,986 | MIT | 2026-10-07. [Source](https://github.com/browser-use/browser-use)
- OpenHands/OpenHands (redirect target of All-Hands-AI/OpenHands): 90,319 | 11,952 | MIT | 2026-10-09. [Source](https://github.com/OpenHands/OpenHands)
- FoundationAgents/MetaGPT: 70,782 | 9,000 | MIT | last push 2026-01-21 (stale). [Source](https://github.com/FoundationAgents/MetaGPT)
- mem0ai/mem0: 66,860 | 7,872 | Apache-2.0 | 2026-10-08. [Source](https://github.com/mem0ai/mem0)
- microsoft/autogen: 61,313 | 9,276 | API says CC-BY-4.0 because the root LICENSE is Creative Commons Attribution 4.0; the code is under LICENSE-CODE, MIT. Last push 2026-04-15 (maintenance). [Source LICENSE](https://raw.githubusercontent.com/microsoft/autogen/main/LICENSE); [Source LICENSE-CODE](https://raw.githubusercontent.com/microsoft/autogen/main/LICENSE-CODE); [repo](https://github.com/microsoft/autogen)
- crewAIInc/crewAI: 59,478 | 8,663 | MIT | 2026-10-08. [Source](https://github.com/crewAIInc/crewAI)
- FlowiseAI/Flowise: 55,495 | 25,066 | NOASSERTION (Apache-2.0 + commercial enterprise dir, see KQ3) | last push 2026-08-13. [Source](https://github.com/FlowiseAI/Flowise)
- aaif-goose/goose (redirect target of block/goose): 55,093 | 6,390 | Apache-2.0 | 2026-10-09. Org `aaif-goose` describes itself as "The goose ai agent platform", homepage goose-docs.ai. [Source](https://github.com/aaif-goose/goose)
- langchain-ai/langgraph: 42,925 | 7,295 | MIT | 2026-10-08. Latest release 1.2.14 on 2026-10-06. [Source](https://github.com/langchain-ai/langgraph)
- agno-agi/agno: 42,627 | 6,113 | Apache-2.0 | 2026-10-09. [Source](https://github.com/agno-agi/agno)
- langfuse/langfuse: 35,546 | 3,953 | NOASSERTION (MIT core + ee/, see KQ3) | 2026-10-09. [Source](https://github.com/langfuse/langfuse)
- openai/openai-agents-python: 29,924 | 4,855 | MIT | 2026-10-08. [Source](https://github.com/openai/openai-agents-python)
- huggingface/smolagents: 29,743 | 3,051 | Apache-2.0 | 2026-10-06. [Source](https://github.com/huggingface/smolagents)
- mastra-ai/mastra: 28,654 | 2,946 | NOASSERTION (Apache-2.0 core + ee/, see KQ3) | 2026-10-09. [Source](https://github.com/mastra-ai/mastra)
- a2aproject/A2A: 26,078 | 2,659 | Apache-2.0 | 2026-10-08. [Source](https://github.com/a2aproject/A2A)
- letta-ai/letta: 25,082 | 2,644 | Apache-2.0 | last push 2026-09-10; README says current source moved to letta-ai/letta-code. [Source](https://github.com/letta-ai/letta)
- google/adk-python: 21,753 | 4,120 | Apache-2.0 | 2026-10-09. [Source](https://github.com/google/adk-python)
- pydantic/pydantic-ai: 20,495 | 2,885 | MIT | 2026-10-09. [Source](https://github.com/pydantic/pydantic-ai)
- camel-ai/owl: 20,153 | 2,296 | no LICENSE file; README says "The source code is licensed under Apache 2.0." [Source](https://raw.githubusercontent.com/camel-ai/owl/main/README.md)
- elizaOS/eliza: 19,565 | 5,787 | MIT | 2026-10-09 | created 2024-07-09. CRYPTO FLAG. [Source](https://github.com/elizaOS/eliza)
- camel-ai/camel: 17,836 | 2,108 | Apache-2.0 | 2026-10-05. [Source](https://github.com/camel-ai/camel)
- microsoft/agent-framework: 14,023 | 2,448 | MIT | 2026-10-08 | created 2025-04-28. Releases python-1.21.0 (2026-10-08), dotnet-1.24.0 (2026-10-07). [Source](https://github.com/microsoft/agent-framework)
- HKUDS/AutoAgent: 9,805 | 1,359 | MIT | last push 2025-10-16 (stale). [Source](https://github.com/HKUDS/AutoAgent)
- anthropics/claude-agent-sdk-python: 8,229 | 1,330 | MIT | 2026-10-09. [Source](https://github.com/anthropics/claude-agent-sdk-python)
- inngest/inngest: 5,927 | 373 | NOASSERTION (SSPL + "Apache 2.0 Future License", see KQ3) | 2026-10-08. [Source](https://github.com/inngest/inngest)
- openai/openai-agents-js: 3,902 | 988 | MIT | 2026-10-08. [Source](https://github.com/openai/openai-agents-js)
- game-by-virtuals/game-node: 93 | 91 | MIT | last push 2026-03-06. CRYPTO FLAG. [Source](https://github.com/game-by-virtuals/game-node)

Traction context:
- Hacker News thread "OpenClaw surpasses React to become the most-starred software project on GitHub". [Source](https://news.ycombinator.com/item?id=47217812)
- HN thread "OpenClaw (ClawdBot) joins OpenAI" (dated "7 months ago" on the page, so roughly Feb/Mar 2026), linking a Sam Altman post; commenters say the MIT license stays and the project moves to a foundation that, at the time, had no board or governance documents. [Source](https://news.ycombinator.com/item?id=47027907). The current LICENSE reads "Copyright (c) 2026 OpenClaw Foundation". [Source](https://raw.githubusercontent.com/openclaw/openclaw/main/LICENSE)
- OpenClaw grew from roughly 9,000 stars to over 382,000 by mid-2026 (secondary roundup). [Source](https://www.aimagicx.com/blog/best-open-source-ai-agent-frameworks-2026)
- LangGraph is credited with 34.5M monthly downloads and reached 1.0 in October 2025 (secondary roundup). [Source](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks)
- CrewAI README: "over 100,000 developers certified through our community courses at learn.crewai.com". [Source](https://raw.githubusercontent.com/crewAIInc/crewAI/main/README.md)
- Microsoft Agent Framework: secondary sources place the 1.0 GA on April 3, 2026 (one says March 2026), merging AutoGen and Semantic Kernel, with new feature work going only to Agent Framework and v1.x of the old projects getting security fixes. [Source](https://www.digitalapplied.com/blog/microsoft-agent-framework-1-0-dotnet-python-guide); [Source](https://atlan.com/know/ai-agent/microsoft/agent-framework/); [Source](https://www.theagentecosystem.com/blog/agent-framework-consolidation-2026)
- Goose is "part of the Agentic AI Foundation (AAIF) at the Linux Foundation" (README). [Source](https://raw.githubusercontent.com/aaif-goose/goose/main/README.md)
- Flowise was acquired by Workday in August 2025 (secondary). [Source](https://futureagi.com/blog/dify-vs-flowise-vs-langflow-2026/)
- DataStax Langflow on Astra was retired in April 2026; Langflow now sits inside IBM's orbit after IBM's acquisition of DataStax (secondary). [Source](https://futureagi.com/blog/dify-vs-flowise-vs-langflow-2026/)

What users praise (primary HN threads):
- "n8n but you create workflows by talking to it" and "it made it easy to attach it to whatever 'channel' you're comfortable with" are the recurring explanations of OpenClaw's appeal; non-programmers feel "empowered to automate things that they could not otherwise automate". [Source](https://news.ycombinator.com/item?id=47219250)
- "Ask HN: Who is using OpenClaw?" reports use through WhatsApp/Telegram/Discord for daily tasks, an Obsidian second brain, calorie/workout logging, bill and birthday reminders, morning calendar briefings, support-email triage, Jira tickets, PR review, and family story archiving through a group chat. Praised: natural-language input, memory "stored in version control that I can read and edit", proactive behavior (chasing overdue tasks, flagging declined meetings), phone access with minimal setup. Complaints: about $100 a month in tokens for one user; "the morning debriefer worked maybe once or twice a week and broke every other morning"; broad access and API keys are risky; "the whole thing seems designed around getting people to burn more tokens". [Source](https://news.ycombinator.com/item?id=47783940)
- HN also carries sustained skepticism ("just a toy", spam agents posting to public forums, lack of restriction by default). [Source](https://news.ycombinator.com/item?id=47219250)
- Goose: multiple users praise the recipes system as "the feature that separates Goose from everything else"; MCP-first extension design; 15+ providers configurable per session; tool errors are returned to the model instead of aborting (secondary review summarizing Reddit/GitHub/HN). [Source](https://aitoolanalysis.com/goose-ai-review/)
- Agno: a developer choosing a framework praised "the clarity and modularity of Agno's Python components"; complaints are a smaller ecosystem and Python-only. [Source](https://huggingface.co/blog/aovabo/choosing-an-ai-agent-framework)
- Letta: praise centers on self-editing memory and the Agent Development Environment that lets you inspect memory tiers and tool calls live; "steeper learning curve". [Source](https://www.promptquorum.com/power-local-llm/letta-review)
- Mastra: almost no direct developer praise found; one developer called its workflow engine "great for serverless apps in TypeScript". [Source](https://huggingface.co/blog/aovabo/choosing-an-ai-agent-framework)

### Inferences
- The star gap (OpenClaw + Hermes at 640k combined vs under 60k for any code-first framework) says the market rewards a finished personal assistant that lives in chat apps, not a library. three.ws's agent is closer to this category than to LangGraph, so OpenClaw and Hermes are the real benchmarks.
- The praised features map almost one to one onto gaps in three.ws: more channels than Telegram/Discord, user-readable memory in git, proactive cron output pushed into chat, and a self-growing skill library.
- Roundup star figures are weeks to months stale (several quote 346k for OpenClaw, 14k for Agent Framework); the API numbers above should be used instead.

### Gaps
- No primary-source download or active-user figures for any project; only secondary "34.5M downloads" for LangGraph.
- The Microsoft Agent Framework GA date is sourced only from blogs (April 3 vs March 2026); no Microsoft release note was fetched.
- Developer sentiment for Mastra, smolagents, pydantic-ai and ADK was not found in primary threads.

## Key question 2: Which features do these repos have that three.ws lacks or does weakly, with a verdict per repo?

### Takeaway
The gaps are concentrated in six areas: messaging breadth (Slack, WhatsApp, Signal, iMessage, Teams, Google Chat), a self-improving skill loop plus cross-session conversation search, graph workflows with suspend/resume and time travel, first-class guardrails/handoffs/tracing, an OpenTelemetry-grade run tracer with evals, and a node-graph builder for agent logic. The best license-and-language fit for vendoring is Mastra (Apache-2.0, TypeScript, built on the same Vercel AI SDK three.ws already uses); OpenClaw's MIT channel adapters are the fastest route to channel breadth; Dify, n8n and the AutoGPT platform are design-only.

### Cited Findings

**OpenClaw** (https://github.com/openclaw/openclaw, 391,499 stars on 2026-10-09, MIT)
- Runs on your own computer and "meets you in the channels you already use: Discord, iMessage, Slack, Teams, Telegram, WhatsApp, and 20+ more, plus native apps for macOS, iOS, Android, Windows, and Linux"; one Gateway runs as a personal assistant or a shared team deployment, "configuration is the only difference". [Source](https://raw.githubusercontent.com/openclaw/openclaw/main/README.md)
- Architecture: the Gateway is "the local control plane for sessions, tools, events, and channel connections"; Control UI, CLI and TUI connect to it; Channels cover "WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, and other messaging services"; companion apps and nodes "add voice, Canvas, camera, screen, and device-local actions". Models and agent harnesses (Claude, Codex, local models) are swappable plugins; by default it phones home only for a daily version check. [Source](https://raw.githubusercontent.com/openclaw/openclaw/main/README.md)
- ClawHub is the official skill store, described as "700+ skills" by the awesome list; the agent can search ClawHub and pull in skills as needed. [Source](https://github.com/SamurAIGPT/awesome-openclaw). Koi Security reviewed "all 2,857 skills on ClawHub" and found 341 malicious ones (late January 2026, mostly macOS Atomic Stealer); ClawHub then integrated VirusTotal and ClawScan. [Source](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html); [Source](https://thehackernews.com/2026/02/openclaw-integrates-virustotal-scanning.html)
- Security record: CVE-2026-25253 (CVSS 8.8) one-click RCE in versions before 2026.1.29; the gateway bound to 0.0.0.0:18789 by default and Censys counted over 30,000 internet-exposed instances on 2026-02-08; Unit 42 calls the setup a "lethal trifecta" where persistent memory "acts as an accelerant". [Source](https://aviatrix.ai/threat-research-center/openclaw-2026-clawhub-malicious-skills/); [Source](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)
- three.ws lacks: Slack / WhatsApp / Signal / iMessage / Teams / Google Chat channels (has Telegram + Discord, `repo:workers/agent-gateway/README.md`); team (shared) deployment mode of one gateway; device nodes exposing camera/screen/Canvas to the agent from the companion apps; skill auto-discovery and install by the agent itself from a registry.
- Verdict: **adopt code** (MIT). Vendor or depend on the channel adapters for Slack, WhatsApp, Signal, iMessage, Teams and Google Chat and plug them into the existing `gateway_inbox` worker; adopt the design of the security hardening (skill scanning, bind-to-localhost) rather than the defaults that produced CVE-2026-25253.

**Hermes Agent** (https://github.com/NousResearch/hermes-agent, 252,089 stars on 2026-10-09, MIT, (c) 2025 Nous Research)
- README: "the only agent with a built-in learning loop: it creates skills from experience, improves them during use, nudges itself to persist knowledge, searches its own past conversations, and builds a deepening model of who you are across sessions"; runs "on a $5 VPS, a GPU cluster, or serverless"; any model via Nous Portal, OpenRouter, OpenAI or your own endpoint; Nous Portal offers 300+ models and a Tool Gateway (web search, FAL image generation, OpenAI TTS, Browser Use cloud browser). [Source](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md)
- It ships a migration path from OpenClaw that imports SOUL.md (persona), MEMORY.md and USER.md, user skills, the command allowlist, messaging settings and API keys. [Source](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md)
- Secondary sources: memory uses SQLite FTS5 full-text search with LLM summarization for cross-session recall rather than a vector DB; roughly 160 bundled skills compatible with the agentskills.io standard; gateway to Telegram, Discord, Slack, WhatsApp, Signal, Teams (one source says 20+ platforms); built-in cron that delivers output to any connected platform; isolated subagents; Python scripts that call tools over RPC to collapse multi-step pipelines; seven terminal backends (local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox). [Source](https://dev.to/wonderlab/one-open-source-project-a-day-no40-hermes-agent-nous-researchs-self-improving-ai-agent-4ale); [Source](https://hermes-agent.nousresearch.com/); [Source](https://www.width.ai/post/what-is-hermes-ai-agent); [Source](https://lucaberton.com/blog/what-is-hermes-agent-nous-research/)
- three.ws lacks: an agent that authors and refines its own skills from repeated tasks; full-text search over the agent's own past conversations; pluggable sandboxed execution backends; subagent spawning; a cron whose output is delivered into the chat channel (three.ws has `schedule_cron` on runs but delivery to a channel is a separate notification lane).
- Verdict: **adopt design, rebuild** for the learning loop and FTS conversation memory (Python codebase; three.ws is JS); **adopt code** is possible for the skill format since both already follow agentskills.io (`repo:docs/agent-skills.md`).

**LangGraph** (https://github.com/langchain-ai/langgraph, 42,925 stars on 2026-10-09, MIT)
- Official overview: "durable execution, streaming, human-in-the-loop, and more"; agents "persist through failures and can run for extended periods"; humans can review and change agent state at any point during a run; short-term working memory and long-term memory across sessions; LangSmith for tracing and a deployment platform "for long running, stateful workflows". [Source](https://docs.langchain.com/oss/python/langgraph/overview)
- three.ws lacks: a graph API over its DB-backed runs; editing a paused run's state; replay / time travel. It already has persistence of steps and cron scheduling (`repo:api/_lib/agents-v1/runs.js`).
- Verdict: **adopt design, rebuild** on the existing runs engine (adding interrupt / resume / state edit semantics); the JS port could be depended on under MIT, but the existing step-row engine already covers persistence, so vendoring a second runtime adds little.

**CrewAI** (https://github.com/crewAIInc/crewAI, 59,478 stars on 2026-10-09, MIT)
- "Crews" (role-based autonomous agent collaboration) and "Flows" (event-driven automations combining precise workflow control, single LLM calls, and native Crews); the commercial AMP Suite adds a Crew Control Plane with tracing, metrics, logs and traces. [Source](https://raw.githubusercontent.com/crewAIInc/crewAI/main/README.md)
- three.ws lacks: server-side role-based crews and event-driven flows (multi-agent is a frontend stage, `repo:docs/multi-agent.md`).
- Verdict: **adopt design, rebuild** (Python).

**AutoGen / Microsoft Agent Framework** (https://github.com/microsoft/autogen 61,313 stars, code MIT, maintenance since 2026-04-15; https://github.com/microsoft/agent-framework 14,023 stars, MIT)
- Agent Framework README: production-grade agents in .NET and Python (Go in a separate repo); "graph-based workflows supporting sequential, concurrent, handoff, and group collaboration patterns; includes checkpointing, streaming, human-in-the-loop, and time-travel"; a middleware pipeline for request/response processing. [Source](https://raw.githubusercontent.com/microsoft/agent-framework/main/README.md)
- three.ws lacks: handoff and group-collaboration orchestration, checkpoint time travel, a middleware pipeline around agent calls.
- Verdict: **adopt design, rebuild** (Python/.NET).

**OpenAI Agents SDK** (https://github.com/openai/openai-agents-python 29,924 stars, MIT; https://github.com/openai/openai-agents-js 3,902 stars, MIT)
- Core concepts: Agents; Sandbox agents "preconfigured to work with a container to perform work over long time horizons"; Realtime agents (voice with gpt-realtime-2.1); Voice pipelines (STT, agent, TTS); Agents as tools / Handoffs; Tools (functions, MCP, hosted); Guardrails for input and output validation; Human in the loop; Sessions; Tracing. Provider-agnostic across 100+ LLMs. [Source](https://raw.githubusercontent.com/openai/openai-agents-python/main/README.md)
- three.ws lacks: first-class guardrails as validators on input/output, handoffs between agents, built-in run tracing, sandbox agents.
- Verdict: **adopt code** (MIT, the JS SDK `@openai/agents` is TypeScript) for guardrails / handoffs / tracing if a second agent runtime is acceptable; otherwise adopt the design onto the AI SDK loop already in `repo:api/_lib/agent-loop.js`.

**Dify** (https://github.com/langgenius/dify, 157,953 stars on 2026-10-09, modified Apache-2.0)
- "Build Agentic workflows, RAG pipelines, with rich AI model and tool support on one collaborative workspace" (repo description). [Source](https://github.com/langgenius/dify)
- three.ws lacks: a collaborative visual builder for agent workflows and RAG pipelines.
- Verdict: **adopt design, rebuild**. The license forbids operating a multi-tenant environment without written authorization and three.ws is multi-tenant by construction (see KQ3).

**n8n** (https://github.com/n8n-io/n8n, 206,752 stars on 2026-10-09, Sustainable Use License)
- "Fair-code workflow automation platform with native AI capabilities. Combine visual building with custom code" (repo description). [Source](https://github.com/n8n-io/n8n)
- HN commenters describe OpenClaw's value as "n8n but you talk to it", which positions n8n's visual integration graph as the benchmark for business glue. [Source](https://news.ycombinator.com/item?id=47027907)
- three.ws lacks: a visual integration/automation graph with triggers.
- Verdict: **adopt design, rebuild** (embedding requires a separate n8n agreement, see KQ3).

**Flowise** (https://github.com/FlowiseAI/Flowise, 55,495 stars on 2026-10-09, Apache-2.0 outside the enterprise dir)
- "Build AI Agents, Visually" (repo description); last push 2026-08-13. [Source](https://github.com/FlowiseAI/Flowise)
- Verdict: **adopt code** (Apache-2.0 portions, TypeScript) for the visual node canvas and agent-flow node types; exclude `packages/server/src/enterprise` and `IdentityManager.ts` (see KQ3). Slower cadence after the Workday acquisition is a maintenance risk.

**Langflow** (https://github.com/langflow-ai/langflow, 155,408 stars on 2026-10-09, MIT)
- "a powerful tool for building and deploying AI-powered agents and workflows" (repo description), drag-and-drop builder. [Source](https://github.com/langflow-ai/langflow)
- Verdict: **adopt code** (MIT) for the React flow canvas if a visual agent builder is pursued; the runtime is Python.

**AutoGPT** (https://github.com/Significant-Gravitas/AutoGPT, 187,488 stars on 2026-10-09, PolyForm Shield for `autogpt_platform`, MIT elsewhere)
- README: "Describe an outcome in plain English or shape every step in the visual builder, then run the agent on demand, on a schedule, or from a trigger"; four surfaces including AutoPilot ("Describe the job in plain English and turn the conversation into a working agent") and an Agents dashboard "showing statuses, runs, and costs". [Source](https://raw.githubusercontent.com/Significant-Gravitas/AutoGPT/master/README.md)
- three.ws lacks: conversation-to-agent authoring (AutoPilot), trigger-based runs, a per-agent run/cost dashboard for end users (three.ws has an ops Agent Monitor and an Earned page, not a per-run cost ledger per the surfaces list).
- Verdict: **adopt design, rebuild** (PolyForm Shield forbids competing use, see KQ3).

**OpenHands** (https://github.com/OpenHands/OpenHands, 90,319 stars on 2026-10-09, MIT)
- "AI-Driven Development" coding agent (repo description). [Source](https://github.com/OpenHands/OpenHands)
- Verdict: **already covered / adopt code** only if a sandboxed coding-agent runtime is wanted; three.ws already has "Take the wheel" and the agent screen caster (surfaces list). Feature detail not researched beyond the description.

**Letta** (https://github.com/letta-ai/letta, 25,082 stars on 2026-10-09, Apache-2.0; active code in letta-ai/letta-code)
- README: install `@letta-ai/letta-code` from npm; terminal UI, App Server for self-hosting, desktop app, chat.letta.com, "Slack, Telegram, Discord, and custom channels", a TypeScript Letta Agent SDK, Letta Cloud for memory across computers; the `archive` branch holds the retired V1 server. [Source](https://raw.githubusercontent.com/letta-ai/letta/main/README.md)
- "Our next phase": memory moves "from specialized memory tools that edit memory in a database to generalized computer use tools like bash that operate over memory projected into git-backed files (context repositories)"; `core_memory_replace` and other legacy server memory tools removed; server-side sleep-time agents replaced by a client-side subagent system; server-side MCP replaced by client-side skills; tool rules deprecated; templates replaced by the Letta Code SDK. [Source](https://www.letta.com/blog/our-next-phase)
- three.ws lacks: git-backed "context repositories" the agent edits with ordinary file tools; a visual memory debugger (ADE, secondary). Its Markdown-file memory layer (`repo:docs/memory.md`) is already close.
- Verdict: **adopt design** (the memory layer is near-covered); the Apache-2.0 TypeScript SDK could be depended on, but the license of letta-ai/letta-code was not verified in this session.

**Mastra** (https://github.com/mastra-ai/mastra, 28,654 stars on 2026-10-09, Apache-2.0 core)
- README: TypeScript; model routing to 40+ providers; agents; graph-based workflow engine with `.then()`, `.branch()`, `.parallel()`; human-in-the-loop via suspend and resume ("pause indefinitely and resume where you left off" using storage); conversation history, RAG, "Observational Memory"; author MCP servers; built-in evals and observability; integrates with Vercel AI SDK UI and CopilotKit. [Source](https://raw.githubusercontent.com/mastra-ai/mastra/main/README.md)
- three.ws lacks: a typed workflow DSL with suspend/resume, built-in evals, an observability layer; it already uses the AI SDK (`repo:package.json`).
- Verdict: **adopt code** (Apache-2.0, same language and same AI SDK base). Candidate modules: `@mastra/core` workflows + suspend/resume, `@mastra/core` evals, Observational Memory. Avoid every `ee/` directory (`@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee`, `@mastra/editor/ee`).

**Agno** (https://github.com/agno-agi/agno, 42,627 stars on 2026-10-09, Apache-2.0)
- README: AgentOS runtime + UI; "50+ endpoints with SSE and websockets"; sessions, memory, knowledge and traces stored in your own DB; 100+ toolkits; Context Providers (Slack, Drive, wikis, MCP); "Human approval: Pause runs for user confirmation. Block tools that require admin approval."; OpenTelemetry tracing, run history, audit logs; JWT-based RBAC; "turn your agent platform into a learning loop with simulations and usage data"; a coding-agent prompt bootstraps the platform from `agentos-railway` / `agentos-gcp` templates. [Source](https://raw.githubusercontent.com/agno-agi/agno/main/README.md)
- three.ws lacks: OTel traces per run with an audit log UI; admin-approval gating for arbitrary (non-financial) tools; simulations.
- Verdict: **adopt design, rebuild** (Python).

**smolagents** (https://github.com/huggingface/smolagents, 29,743 stars on 2026-10-09, Apache-2.0)
- "a barebones library for agents that think in code" (repo description). [Source](https://github.com/huggingface/smolagents)
- Verdict: **adopt design** (the code-agent pattern, where the model writes code that calls tools, which Hermes also uses to collapse turns). Not researched further.

**Goose** (https://github.com/aaif-goose/goose, 55,093 stars on 2026-10-09, Apache-2.0)
- README: general-purpose agent, native desktop app for macOS/Linux/Windows, CLI, and an API to embed anywhere; built in Rust; 15+ providers; "Use API keys or your existing Claude, ChatGPT, or Gemini subscriptions via ACP"; 70+ MCP extensions; "Custom Distributions: build your own goose distro with preconfigured providers, extensions, and branding"; governance under the Agentic AI Foundation at the Linux Foundation. [Source](https://raw.githubusercontent.com/aaif-goose/goose/main/README.md)
- Users praise recipes (shareable, parameterized agent task definitions). [Source](https://aitoolanalysis.com/goose-ai-review/)
- three.ws lacks: shareable recipes as a first-class object; white-label custom distributions of its agent; ACP subscription auth.
- Verdict: **adopt design** for recipes and custom distros (Rust codebase); **adopt code** is license-clean (Apache-2.0) if a Rust component is ever wanted.

**ElizaOS** (https://github.com/elizaOS/eliza, 19,565 stars on 2026-10-09, MIT) CRYPTO FLAG
- README: TypeScript framework plus product stack; the Eliza app covers "chat, voice, memory, knowledge, and document workflows; messaging and workspace connectors; calendar, reminders, inbox, goals, health; browser and desktop automation; camera, phone, messages, contacts, location, and other native device bridges; non-custodial EVM and Solana wallet operations with approval boundaries; scheduled workflows, coding-agent orchestration, and installable app views". Plugins register "actions, providers, evaluators, services, model handlers, routes, events, tests, and app views". Eliza-1 local inference ships Gemma 4 based 2B/4B/9B/27B tiers plus embeddings, speech, vision and image generation for offline use. The project "no longer accept[s] third-party plugins or registry items". [Source](https://raw.githubusercontent.com/elizaOS/eliza/develop/README.md); [Source](https://github.com/elizaos/eliza)
- Founder Shaw Walters declared the ELIZAOS token "dead" on 2026-08-04 and wound down the foundation after settling a Burwick Law class action; he said Eliza Labs keeps building the software. [Source](https://www.theblock.co/post/410774/eliza-labs-native-token-dead); [Source](https://decrypt.co/374958/eliza-ai-token-dead-shuts-down-foundation-lawsuit)
- three.ws lacks: native device bridges (contacts, location, phone) exposed to the agent; offline local-inference tier; installable app views inside the agent app.
- Verdict: **adopt design, rebuild**. MIT would permit code, but any committed reference to ElizaOS trips the commit gate; also three.ws is custodial, ElizaOS is non-custodial.

**Virtuals GAME** (https://github.com/game-by-virtuals/game-node, 93 stars on 2026-10-09, MIT) CRYPTO FLAG
- Agents are created by staking 100 VIRTUAL and launched on a bonding curve, graduating to a Uniswap pool at 42,000 VIRTUAL (secondary). [Source](https://www.koinx.com/blog/virtuals-protocol-explained)
- Verdict: **already covered** (three.ws ships a native bonding-curve launchpad and agent token plans per the surfaces list). Do not name in commits.

**Google A2A protocol / ADK** (https://github.com/a2aproject/A2A 26,078 stars; https://github.com/google/adk-python 21,753 stars; both Apache-2.0)
- A2A is "an open protocol enabling communication and interoperability between opaque agentic applications" (repo description). [Source](https://github.com/a2aproject/A2A)
- three.ws lacks: an A2A agent card / task endpoint, so external A2A agents cannot discover or hire three.ws agents; its a2a payments are a native mandate scheme (`repo:docs/a2a-payments.md`).
- Verdict: **adopt code** (Apache-2.0 spec and SDKs): publish an A2A agent card per three.ws agent and front the existing hire/x402 path with the A2A task API.

**Supporting infrastructure worth noting**
- mem0 (Apache-2.0, 66,860 stars) is a drop-in memory layer; Langfuse core is MIT (35,546 stars) for traces and evals; Inngest (5,927 stars) is SSPL now with an Apache-2.0 future license; browser-use (MIT, 117,335 stars) for browser automation. Verdicts: mem0 and Langfuse are **adopt code** candidates for observability and memory retrieval; Inngest is **adopt design** until its SSPL term converts (see KQ3). Sources in the star table above.

### Inferences
- The single highest-leverage gap is channel breadth: the two most-starred projects on GitHub both win on "the agent in the chat app you already use", and three.ws's gateway worker is already structured for additional adapters.
- Mastra is the only top-tier framework that matches three.ws on language, license and base library, so it is the natural vendoring target for workflows, suspend/resume and evals.
- Three.ws's financial HITL guard is stronger than any framework's generic approval; the gap is generalizing it to non-financial tool approval and to pausing a whole run.
- The ClawHub malware wave (341 of 2,857 skills) is a cautionary design input for the three.ws skill marketplace: scanning before listing is now table stakes.

### Gaps
- Feature lists for OpenHands, smolagents, pydantic-ai, ADK, CAMEL/OWL and MetaGPT were not read beyond repo descriptions.
- Dify and n8n feature depth (number of integrations, node types) is from descriptions and secondary roundups only; the primary README bodies were not fetched past the banner.
- Hermes feature counts (platforms, backends, skills) come from secondary blogs; the README section with the feature bullets was not captured.
- Letta's exact deprecation dates and the letta-code license were not verified.
- Mastra's `ee/LICENSE` text was not read (only the LICENSE.md pointer).

## Key question 3: What does each license allow and forbid for commercial reuse by an Apache-2.0 project?

### Takeaway
Permissive (MIT / Apache-2.0) covers OpenClaw, Hermes, LangGraph, CrewAI, AutoGen code, Agent Framework, OpenAI Agents, Langflow, OpenHands, Letta, Mastra core, Agno, smolagents, Goose, ElizaOS, ADK, A2A, mem0, Langfuse core, browser-use, Flowise outside its enterprise dir and AutoGPT outside `autogpt_platform`. Three repos are off-limits for code: Dify (multi-tenant needs written authorization; frontend logo must stay), n8n (internal business use only, embedding needs a separate agreement), AutoGPT's platform (PolyForm Shield, no competing use). Inngest is SSPL today.

### Cited Findings
- **Dify**: "licensed under a modified version of the Apache License 2.0, with the following additional conditions": (a) "Unless explicitly authorized by Dify in writing, you may not use the Dify source code to operate a multi-tenant environment" where "one tenant corresponds to one workspace"; (b) "you may not remove or modify the LOGO or copyright information in the Dify console or applications", inapplicable to uses that do not involve the `web/` frontend; contributors agree the producer "can adjust the open-source agreement to be more strict or relaxed" and that contributions may be used commercially "including but not limited to its cloud business operations"; "The interactive design of this product is protected by appearance patent." Everything else follows Apache-2.0. [Source](https://raw.githubusercontent.com/langgenius/dify/main/LICENSE). An October 2025 OSI license-discuss thread argued the terms conflict with the Open Source Definition. [Source](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2025-October/022425.html). For an Apache-2.0 commercial platform: backend-only reuse avoids the logo clause, but any multi-tenant deployment (every three.ws user is a workspace) needs written authorization from Dify; the appearance patent also argues against copying the UI.
- **n8n**: files with `.ee.` in the name or `.ee` in the dirname are under the n8n Enterprise License ("may only be used in production, if you ... hold a valid n8n Enterprise license"); everything else is under the Sustainable Use License 1.0: "You may use or modify the software only for your own internal business purposes or for non-commercial or personal use. You may distribute the software or provide it to others only if you do so free of charge for non-commercial purposes. You may not alter, remove, or obscure any licensing, copyright, or other notices." [Source](https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md); [Source](https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE_EE.md). n8n's own docs say embedding n8n in a product requires signing a separate agreement (license@n8n.io), and the license is source-available, not OSI open source. [Source](https://docs.n8n.io/faircode-license). For three.ws: no vendoring of n8n code into an Apache-2.0 product; design only.
- **AutoGPT**: "Everything inside the autogpt_platform folder is under the Polyform Shield License. Everything outside the autogpt_platform folder is under the MIT License" (the classic agent, Forge, AG Benchmark, classic GUI). [Source](https://raw.githubusercontent.com/Significant-Gravitas/AutoGPT/master/LICENSE). PolyForm Shield 1.0.0 is the noncompete variant (the license text is reproduced in the file, with the canonical text at polyformproject.org/licenses/shield/1.0.0); a third-party review notes it "restricts competing commercial use". [Source](https://www.promptquorum.com/power-local-llm/autogpt-local-review-2026). For three.ws, which competes as an agent platform: platform code is off-limits; the MIT classic code is stale.
- **Flowise**: content under `packages/server/src/enterprise` and files with explicit notices such as `IdentityManager.ts` are under a Commercial License; "Content outside of the above mentioned directories or restrictions above is available under the Apache 2.0 license". [Source](https://raw.githubusercontent.com/FlowiseAI/Flowise/main/LICENSE.md). Apache-2.0 portions can be vendored into an Apache-2.0 project with attribution and NOTICE retention.
- **Mastra**: `LICENSE.md` places every `ee/` directory (`@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee`, `@mastra/editor/ee`) under `ee/LICENSE`; `packages/core/package.json` declares `"license": "Apache-2.0"`. [Source](https://raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md); [Source](https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/package.json). Apache-2.0 core is fully compatible; exclude `ee/`.
- **Langfuse**: "ee/", "web/src/ee/" and "worker/src/ee/" are under `ee/LICENSE` (an Enterprise License: "Langfuse is an open core project. Langfuse's core is permissively licensed (MIT license)"); everything else is MIT Expat. Copyright is now "ClickHouse, Inc." [Source](https://raw.githubusercontent.com/langfuse/langfuse/main/LICENSE); [Source](https://raw.githubusercontent.com/langfuse/langfuse/main/ee/LICENSE)
- **Inngest**: `LICENSE.md` is the "Server Side Public License, Version 1.0" with an "Apache 2.0 Future License" clause; the file states the Apache-2.0 grant becomes "effective on the third" anniversary (the clause was only partially read, line 564 of the file). [Source](https://raw.githubusercontent.com/inngest/inngest/main/LICENSE.md). SSPL requires offering the service source if the software is offered as a service, so vendoring into an Apache-2.0 product is not clean until the conversion date for a given version.
- **AutoGen**: root LICENSE is Creative Commons Attribution 4.0 (docs/content), `LICENSE-CODE` is MIT. [Source](https://raw.githubusercontent.com/microsoft/autogen/main/LICENSE); [Source](https://raw.githubusercontent.com/microsoft/autogen/main/LICENSE-CODE). Code is reusable under MIT; documentation needs CC-BY attribution.
- **OWL (camel-ai)**: no LICENSE file in the repo root; README states "The source code is licensed under Apache 2.0." [Source](https://raw.githubusercontent.com/camel-ai/owl/main/README.md). Treat as Apache-2.0 by declaration only; a missing LICENSE file weakens the grant's clarity.
- **OpenClaw, Hermes, ElizaOS**: plain MIT, copyright holders "OpenClaw Foundation" (2026), "Nous Research" (2025), "Shaw Walters and elizaOS Contributors" (2026). [Source](https://raw.githubusercontent.com/openclaw/openclaw/main/LICENSE); [Source](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/LICENSE); [Source](https://raw.githubusercontent.com/elizaOS/eliza/develop/LICENSE)
- **Apache-2.0 repos** (Letta, Agno, smolagents, Goose, ADK, A2A, mem0, CAMEL): identical license to three.ws, so vendoring needs only the Apache NOTICE and attribution requirements. **MIT repos** (LangGraph, CrewAI, Agent Framework, OpenAI Agents, Langflow, OpenHands, browser-use, pydantic-ai, claude-agent-sdk, MetaGPT, AutoAgent, game-node): MIT text must accompany copied code. Star-table sources above.
- Model weights vs code: ElizaOS's Eliza-1 local models are "based on Gemma 4" and are downloaded at runtime; the repo's MIT license covers the code, not the Gemma weights, whose terms were not checked. [Source](https://raw.githubusercontent.com/elizaOS/eliza/develop/README.md). No other repo in this list ships weights; OpenClaw, Hermes and Goose are BYO-model.

### Inferences
- For a multi-tenant SaaS like three.ws, Dify is effectively proprietary and n8n is design-only; both are safe to study and to describe in internal docs.
- Open-core splits (Mastra, Langfuse, Flowise) are safe as long as vendoring excludes the named `ee/` or `enterprise/` directories; an import-path lint rule would enforce this mechanically.
- The Apache-2.0 TypeScript stack (Mastra core, A2A JS SDK, mem0 TS client, Langfuse core) composes cleanly with three.ws without any license notice beyond NOTICE files.

### Gaps
- PolyForm Shield's exact competing-use clause was not quoted from the file (only the file's license split and a secondary characterization).
- Inngest's conversion clause was read only in fragments; the exact mechanics (per-version date vs per-release) should be confirmed before relying on it.
- The Gemma 4 weights license referenced by ElizaOS was not retrieved.
- Mastra `ee/LICENSE` and letta-code's license file were not read.

## Key question 4: Which repos are crypto-related (commit-gate relevance)?

### Takeaway
Two repos in scope are crypto projects and must not be named in committed three.ws files without owner approval: ElizaOS (a token that the founder declared dead in August 2026, with the software continuing) and Virtuals Protocol's GAME framework (agents launched on a VIRTUAL bonding curve). Every other repo on the list is non-crypto.

### Cited Findings
- ElizaOS began as ai16z; its token reached a roughly $2.5 billion market cap in January 2025, was rebranded after Andreessen Horowitz objected to the name, and on 2026-08-04 founder Shaw Walters declared the ELIZAOS token "dead", handed the remaining treasury to token holders represented by Burwick Law under a class-action settlement, and wound down the foundation while saying Eliza Labs keeps building the software. [Source](https://www.theblock.co/post/410774/eliza-labs-native-token-dead); [Source](https://thedefiant.io/news/tokens/eliza-labs-shaw-walters-says-ai16z-token-is-dead-after-settling-burwick-law-class-action)
- The ElizaOS app includes "non-custodial EVM and Solana wallet operations with approval boundaries", and `@elizaos/plugin-solana` is published on npm. [Source](https://raw.githubusercontent.com/elizaOS/eliza/develop/README.md); [Source](https://www.npmjs.com/package/@elizaos/plugin-solana)
- Virtuals Protocol: agents are "created by staking 100 VIRTUAL tokens and launched on a bonding curve; once 42,000 VIRTUAL accumulates, the agent graduates to a Uniswap liquidity pool"; the maintained SDK is `game-by-virtuals/game-python` (the older `agentdao/virtuals-python` README points there); one aggregator claims 18,000+ agents and $75M+ cumulative revenue as of early 2026, unverified. [Source](https://www.koinx.com/blog/virtuals-protocol-explained); [Source](https://github.com/agentdao/virtuals-python); [Source](https://www.startuphub.ai/startups/virtuals-game.md)
- Non-crypto by their own descriptions: OpenClaw, Hermes Agent, LangGraph, CrewAI, AutoGen / Agent Framework, OpenAI Agents, Dify, n8n, Flowise, Langflow, AutoGPT, OpenHands, Letta, Mastra, Agno, smolagents, Goose, ADK, A2A, mem0, Langfuse, browser-use, Inngest, CAMEL/OWL, MetaGPT, AutoAgent (repo descriptions in the star table). Note that HN commenters flag OpenClaw agents being used to promote things on public forums and suspect "token sales or influencer marketing" behind some hype, but the project itself has no token. [Source](https://news.ycombinator.com/item?id=47783940)

### Inferences
- ElizaOS is the only direct feature competitor that is both an "agentic operating system" and Solana-native with wallet operations; it is the one whose design should be studied most carefully and whose name must never land in a commit.
- Virtuals' bonding-curve launch is already matched by three.ws's own launchpad, so there is nothing to adopt beyond awareness.

### Gaps
- Court documents for the Eliza settlement were not retrieved; only press reports.
- The `game-by-virtuals/game-python` repo (the maintained SDK) was not queried for stars or license; only the 93-star `game-node` repo was.
