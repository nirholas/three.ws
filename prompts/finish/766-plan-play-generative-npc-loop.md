# Give /play NPCs an observation, reflection and planning loop with real wallets

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/766-plan-play-generative-npc-loop.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 34 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The /play town has walking NPCs (`src/walk-npcs.js`) and an AgenC devnet life loop (`workers/agora-citizens`) but no memory: they do not observe, reflect or plan. A generative-agent loop (observation stream, importance-scored retrieval, reflection, daily plan, fast reflex vs slow deliberation) makes the town a first-of-kind public world of agents.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/walk-npcs.js`, `workers/agora-citizens` exist. No observation, reflection or planning loop.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls workers/agora-citizens; sed -n 1,60p src/walk-npcs.js
grep -rn "reflect\|importance" workers/agora-citizens src/walk-npcs.js | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first in the worker suite: importance scoring is monotonic, retrieval returns recency-weighted relevant memories, reflection triggers on the summed importance threshold, plans are bounded in length.
2. Implement `memory-stream.js`, `reflect.js`, `plan.js` in `workers/agora-citizens` using the platform model proxy and the existing memory store (devnet-only wallets).
3. Fast path (movement reflex) separate from slow path (deliberation) so the world loop never blocks on a model call.
4. Surface a citizen's current plan and last reflection in the /play inspector. States: skeleton, empty, error, hover/focus/active.
5. Docs and changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Worker tests pass.
- [ ] A 10-minute local run produces reflections stored per citizen and visible in the inspector.
- [ ] No mainnet funds used.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| swiftshader stalls the 3D world | Verify with the light-page harness in memory note `play-browser-verify-without-world`. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/766-plan-play-generative-npc-loop.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `766-plan-play-generative-npc-loop.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/research/oss-landscape-2026-10.md` (section "Fifteen gaps ranked by leverage")

~~~~markdown
## Fifteen gaps ranked by leverage

The ranking weighs three things: user-visible impact for the Solana-first, embodied-agent positioning, effort, and whether permissive code exists. Effort sizes are S (days), M (weeks) and L (a quarter). Everything marked ADOPT uses permissively licensed code; REBUILD means the reference is a design source only, or is permissive but foreign to the TypeScript runtime.

| # | Gap and action | Effort | Impact | Inspiring repo | Mode |
|---|---|---|---|---|---|
| 1 | Geo-gate or replace the Hunyuan lanes, including gallery and marketplace display of their outputs | S | Removes a licensing exposure in the EU, UK and South Korea | [Tencent license](https://huggingface.co/tencent/Hunyuan3D-2.1/raw/main/LICENSE) | REBUILD (swap to TRELLIS.2 and Step1X-3D) |
| 2 | Channel breadth: Slack, WhatsApp, Signal, iMessage, Teams, Google Chat adapters, plus unknown-sender pairing, into the existing agent gateway | M | Largest reach gain per week of work | [OpenClaw](https://github.com/openclaw/openclaw) | ADOPT |
| 3 | New image-to-3D lanes: TRELLIS.2 (PBR, MIT) and SAM 3D Objects (real photo to mesh and layout), bake-off against Pixal3D | S to M | Forge quality and licensing safety at once | [TRELLIS.2](https://github.com/microsoft/TRELLIS.2), [SAM 3D](https://github.com/facebookresearch/sam-3d-objects) | ADOPT |
| 4 | Hook/event bus on the agent runtime, plus `three-ws run -p ... --output-format json` reporting spend in USDC and $THREE | M | Lets developers extend and automate agents; three.ws already meters x402 spend per call | [OpenCode](https://opencode.ai/docs/plugins/), [OpenHands headless](https://docs.openhands.dev/openhands/usage/run-openhands/headless-mode) | ADOPT |
| 5 | Emit and consume AG-UI events from the runtime and the embodiment layer | S to M | Interop with CopilotKit, assistant-ui and LangChain front ends; the Embodiment and Spatial MCP could become an AG-UI extension | [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | ADOPT |
| 6 | Solana Agent Registry (register, feedback) alongside the existing Metaplex and memo reputation path | M | Native discoverability; three.ws's own docs name the missing Solana ERC-8004 equivalent | [8004-solana](https://github.com/QuantuLabs/8004-solana) | ADOPT |
| 7 | x402 v2 extensions (SIWx, sessions, hooks, dynamic payTo) and MPP charge, session and refund methods with the Solana SPL rail | M | Session deposits and in-protocol refunds are the missing commerce primitives | [x402](https://github.com/x402-foundation/x402), [MPP](https://github.com/tempoxyz/mpp-specs) | ADOPT |
| 8 | Discovery and identity: A2A signed Agent Card per agent, Web Bot Auth signed requests, publish hosted MCP servers to the official registry under a DNS-verified namespace and to Anthropic's directory, `npx skills add` listing | S | Distribution task, not engineering; three.ws already meets the remote Streamable HTTP plus OAuth DCR requirements | [A2A](https://github.com/a2aproject/A2A), [Web Bot Auth](https://github.com/cloudflare/web-bot-auth), [registry](https://github.com/modelcontextprotocol/registry), [directory docs](https://claude.com/docs/directory/publish) | ADOPT |
| 9 | Evaluator escrow with expiry refund as a Solana Anchor program, extending AgenC task escrow | L | Trust layer for paid agent jobs; no licensed reference exists | ERC-8183 spec (CC0); the Virtuals SDKs carry no license file | REBUILD |
| 10 | Temporal fact validity, provenance and contradiction handling in `@three-ws/agent-memory`, plus a published LoCoMo and LongMemEval score | M | The credibility gap versus every competing memory layer | [Graphiti](https://github.com/getzep/graphiti), [Supermemory](https://github.com/supermemoryai/supermemory) | REBUILD (Apache, but Python and Neo4j) |
| 11 | Workflow suspend/resume and general tool-approval human-in-the-loop on the durable runs engine, beyond the financial guard | M | Long-running agents and approval UX | [Mastra](https://raw.githubusercontent.com/mastra-ai/mastra/main/README.md), [assistant-ui](https://github.com/assistant-ui/assistant-ui) | ADOPT |
| 12 | Autonomous browser agent on the caster pool's Chromium, with the owner's lease as interrupt | M | Delivers the "agent drives" half that `docs/agent-screen-control.md` promises | [Browser Use](https://github.com/browser-use/browser-use), [Steel Browser](https://github.com/steel-dev/steel-browser) | ADOPT |
| 13 | Non-humanoid and any-mesh rigging with SkinTokens, plus part-level generation with PartCrafter | M | Closes the rigging gap against Meshy and Tripo | [SkinTokens](https://github.com/VAST-AI-Research/SkinTokens), [PartCrafter](https://github.com/wgsxm/PartCrafter) | ADOPT |
| 14 | Generative-agent NPC loop for `/play` (observation stream, importance-scored retrieval, reflection, daily plan) with PIANO-style fast reflex and slow deliberation split; upgrade to Colyseus 0.18 prediction and rewind | M | First-of-kind public 3D town of wallet-holding agents; no open 3D rival has traction | [AI Town](https://github.com/a16z-infra/ai-town), [Generative Agents](https://github.com/joonspk-research/generative_agents), [Project Sid paper](https://arxiv.org/html/2411.00114v1) | REBUILD (design), ADOPT (Colyseus) |
| 15 | Skill supply-chain scanner and a self-improving skill loop with full-text conversation search | M | ClawHub's 341 malicious skills show the exposure; a loop is the Hermes differentiator | [ClawHub incident](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html), [Hermes](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md) | REBUILD |

The next tier is worth naming so it is not lost. Upgrade `three` to r186 and move Scene Studio, `/play` and the walkaround to `WebGPURenderer`, after confirming Spark 2.3.x on that path ([Spark](https://github.com/sparkjsdev/spark)). Port streamed splat LOD budgets, SOG compression and collision generation from the MIT PlayCanvas stack ([PlayCanvas engine](https://github.com/playcanvas/engine)). Point Spatial MCP at Scene Studio, mirroring PlayCanvas's editor MCP. Export OTel spans through OpenLLMetry and add multi-turn scoring from DeepEval to the session-to-test recorder ([DeepEval](https://github.com/confident-ai/deepeval)). Ship a MentraOS MiniApp for the nearest-agent cue on glasses ([MentraOS](https://github.com/Mentra-Community/MentraOS)). Add Character Card V2 import to the persona hub ([spec](https://github.com/malfoyslastname/character-card-spec-v2)). Add a voice turn-taking and full-duplex lane via Pipecat (BSD-2) or LiveKit Agents (Apache). Deepen the Home Assistant tool surface toward the broader ha-mcp category set through HA's own APIs ([ha-mcp](https://github.com/homeassistant-ai/ha-mcp)).
~~~~

