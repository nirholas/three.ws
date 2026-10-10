# The Grok bot ecosystem has stars for clones and a hole where the tooling should be

**Grok-only repos cap at roughly 4k stars today, and every repo past 10k in this orbit is a multi-harness tool that happens to support Grok rather than a Grok project.** The trending leaders as of 2026-10-10 are account and key switchers (cc-switch at 141k, CLIProxyAPI at 54k, sub2api at 43k), reconstructed or reverse-engineered bot clients (invisible_dots at 32k, OpenDots forks at 4k to 6k), and xAI's own Grok Build at 27k. The lanes that are saturated (clones, awesome lists, registration bots) are also the ones most likely to be archived or to violate xAI's terms. The three open lanes with a credible 10k+ ceiling are persistent memory that spans Grok Build, Codex and OpenClaw, a GROK.md harness pack with a bilingual README, and a guard proxy for always-on bots. Each one rides the same pattern the current leaders used: multi-harness scope, a security or workflow pain that users complain about loudly, and a repo that is useful on day one without an xAI account. This document records the survey so a standalone repo can be scoped from it without repeating the research. None of it is three.ws work.

## The leaderboard, read for what actually earns the stars

| Stars | Repository | What it is | Why it climbed |
| --- | --- | --- | --- |
| 141k | farion1231/cc-switch | Account and provider switcher for coding harnesses | Works across Claude Code, Codex, Gemini CLI and Grok Build; solves daily friction |
| 54k | router-for-me/CLIProxyAPI | Local proxy that turns subscription CLIs into an API | Multi-vendor, one config, immediate payoff |
| 43k | Wei-Shaw/sub2api | Subscription-to-API gateway with quota pooling | Same lane as the proxy, with team pooling |
| 32k | feder-cr/invisible_dots | Reconstructed personal-bot client | Runs an always-on assistant locally; strong README |
| 27k | xai-org/grok-build | xAI's coding harness (Jul 2026), 5.1k forks | First-party, releases every few days |
| 24k | slopus/happy | Mobile and web remote for coding harnesses | Multi-harness remote control |
| 5.6k | Anil-matcha/open-dots | Open reimplementation of a personal bot | Clone lane, early mover |
| 4.5k | CopilotKit/OpenDots | Another open personal-bot reimplementation (Sep 29) | Backed by a known org |
| 4.2k | milind-soni/OpenMausBot | Open Grok bot runtime (Aug 11) | Grok-specific, hit the ceiling fast |
| 3.5k | elie222/rakazo | Email and inbox agent with Grok support | Workflow value, multi-model |
| 3.5k | b-nnett/grok-bot-0.18-reconstructed | Source reconstruction, archived | Novelty spike, then dead |
| 3.5k | superagent-ai/grok-cli | Grok CLI | Grok-only, capped |

Weekly risers in the same orbit tell the same story: rea gained 23k in a week, ponytail gained 8k on top of 158k, moli gained 7.9k, Agent-Reach gained 6.7k on top of 94k, and claude-mem gained 3.5k on top of 98k. Every one of them is harness-agnostic infrastructure (memory, routing, reach, remote control). Not one is a Grok-only project.

## Four findings that set the ceiling

1. **Grok-only caps near 4k.** OpenMausBot, grok-cli and the reconstructed bot all stalled between 3.5k and 4.2k. The Grok user base alone does not carry a repo to 10k; the multi-harness repos do because every Claude Code, Codex and OpenClaw user is also a potential star.
2. **The clone lane is saturated.** Three open reimplementations of the same personal bot landed within two months. The newest one (CopilotKit's, Sep 29) already reached 4.5k on brand alone, which means a fourth entrant would compete on marketing, not on substance.
3. **Awesome lists are dead on arrival.** The three Grok awesome lists sit at 393, 347 and 59 stars. Curation without a tool attached no longer trends.
4. **The Grok Build ecosystem is empty.** Around Grok Build's 27k stars, the satellite repos are tiny: grok-app at 1.4k and grok-keysmith at 484. Compare the Claude Code orbit, where ponytail holds 158k, ECC 275k, claude-mem 98k and cc-switch 141k. The tooling layer that exists for Claude Code does not yet exist for Grok Build, and Grok Build is shipping releases every few days, so the surface is growing under it.

The loudest complaint across issues and threads is security, not features: prompt injection against always-on bots, a thin audit trail (one reconstructed bot keeps roughly 50 routines and 20 run records), and no bring-your-own-model option. The only repo addressing this, cc-safety-net at 1.6k, covers coding sessions only, not always-on bots.

## Three repos worth building, ranked

### 1. Persistent memory for Grok Build, Codex and OpenClaw, with a claude-mem importer

A plugin plus MCP server that gives Grok Build the memory layer claude-mem gives Claude Code: session capture, compaction into durable facts, recall by relevance, and a one-command importer that moves an existing claude-mem store across. The importer is the growth lever: every claude-mem user who tries Grok Build is a user on day one. Scope it multi-harness from the first commit (Grok Build, Codex, OpenClaw), because Grok-only would cap at 4k. Ship a web viewer for the memory graph and a clear privacy story (local by default, no telemetry). Ceiling: claude-mem proves the lane at 98k.

### 2. GROK.md harness pack with a bilingual README

The equivalent of the ECC and ponytail packs for Grok Build: a curated GROK.md operating file, hooks, slash commands, skills and agent definitions, installable in one command, with an English and Chinese README from the start. The cc-switch and sub2api leaders show how much of the harness audience reads Chinese first. The pack needs a linter that checks every script and path it names exists (the same discipline three.ws applies to its own agent rules), so it never rots into stale instructions. Ceiling: ECC at 275k and ponytail at 158k prove the lane; Grok Build's empty orbit means no incumbent.

### 3. A guard and egress proxy for always-on bots

A local proxy that sits between a personal bot (any of the reconstructed clients, or Grok Build in daemon mode) and the network: a prompt-injection scanner on inbound content, an append-only audit log of every tool call and egress request, a kill switch, and a scoped-credential vault so the bot never holds raw keys. This answers the loudest complaint directly and is harness-agnostic by construction. Ceiling is less proven (cc-safety-net sits at 1.6k on a narrower scope), but the audience is every always-on bot user, which is the fastest-growing segment.

## What to avoid

- **Another personal-bot clone.** Three exist, one with a well-known org behind it. Fourth place is not a star magnet.
- **Awesome lists.** Three already exist and none passed 400 stars.
- **Registration or account-farming bots.** They violate xAI's terms and get taken down; the stars evaporate with the repo.
- **Source reconstructions.** The one that trended was archived within weeks. Novelty, not durability.

## Timing

Grok 4.7 landed on 2026-09-26 and Grok Build releases every few days, so the harness surface is changing weekly. The memory plugin and the harness pack both benefit from landing while the ecosystem is still empty; the guard proxy is less time-sensitive because the complaint it addresses is structural.

## Sources

- https://github.com/topics/grok-bot
- https://github.com/milind-soni/OpenMausBot
- https://github.com/feder-cr/invisible_dots
- https://github.com/superagent-ai/grok-cli
- https://github.com/xai-org/grok-1
- https://github.com/popcafa/ai-repo-tracker
- https://x.ai/changelog/build
- https://releasebot.io/updates/xai
- https://docs.x.ai/developers/models
- https://www.unite.ai/
- https://buildfastwithai.com/
- https://www.datacamp.com/
- https://onewave-ai.com/
- https://explainx.ai/
- https://bytebytego.com/
- https://www.firecrawl.dev/
- https://github.com/ZeroPointRepo/awesome-grok-bot
- https://github.com/milisp/awesome-grok

Star counts and dates were read on 2026-10-10 and will drift; treat them as a snapshot, not a ledger.
