# Grok ecosystem opportunities: what the open-source world builds that we can bring to Grok

Research sweep of GitHub, npm and the xAI docs, done 2026-11-26 after three.ws joined Grok for Startups. It answers one question: what are the strongest things people build with any model (Claude, GPT, Gemini, open models) in 3D, AI agents, voice, media and crypto, and which of them become better, cheaper or only possible on Grok inside three.ws?

Read it with [grok-roadmap.md](grok-roadmap.md). The roadmap is a gap analysis of the xAI docs against our code. This file looks outward: what the ecosystem does, which projects are worth borrowing from, and where Grok's own features (live X data, SIP phone calls, multi-agent model, vision, Vertex hosting) give us an edge. Items the roadmap already ranks (remote MCP in production, Collections, Batch, custom voices, image editing, moderation controls, code execution, `previous_response_id`) are not repeated as new ideas. Where the research changes how one of them should be built, that is noted under [What the research adds to the existing roadmap](#what-the-research-adds-to-the-existing-roadmap).

A second pass with showcase demos, tools for other ecosystems and daily features is in [grok-showcase-and-tools.md](grok-showcase-and-tools.md).

Every repository, star count, licence and push date below was read from `gh api` on 2026-11-26. npm numbers are last-week downloads from `api.npmjs.org`. xAI facts come from docs.x.ai via the `xai-docs` MCP server. Anything not verified is marked as such.

## The short version

Seven moves stand out. Each one is either uniquely Grok or is something the ecosystem has proven and nobody has built on Grok yet.

1. **Serve Grok through Vertex AI Model Garden.** xAI documents Grok on Vertex (`xai/grok-4.7`, OpenAI-compatible, Responses API and Chat Completions). Our open-model roster already routes through Model Garden with keyless Vertex auth. One roster route gives a Grok lane billed to GCP, which keeps the Grok for Startups credits untouched. Verify credit eligibility first (see item 1).
2. **Give every agent a phone number.** xAI answers SIP calls directly and bridges them into a normal Grok Voice session. Nothing in the repo handles telephony today. A 3D agent you can call is new, and it is flat $0.08 per minute.
3. **A render, look, fix loop around the forge, with Grok as the critic.** The strongest new 3D agent projects (Procedura, ShaderAgent, NVIDIA SAGE, text-to-cad) all use the same loop: build, render, have a vision model judge, repair. Our quality gate is a one-shot pass or fail. Grok vision plus the multi-agent model turns it into a loop, and CAD Forge's writer ladder does not include Grok yet.
4. **X-native crypto intelligence that cites its sources.** `x_search` can filter to up to 10 handles with date windows and returns citations. That gives a "credible voices" read per token, social rug flags, and a narrative tag on every pump.fun launch, all with links. No other provider has a first-party X index.
5. **A bull and bear research council on the multi-agent model.** TradingAgents (123,839 stars) is the reference multi-role trading research design. Its supported providers do not include xAI. Its sentiment and news seats are exactly what `x_search` does best.
6. **Claim the empty niche in the official Grok Build plugin marketplace.** `xai-org/plugin-marketplace` lists 36 plugins. None cover 3D, avatars, creative assets or agent identity. Our Grok Build plugin already exists.
7. **Avatars that emote, gesture and stop talking the instant you interrupt.** Port the behaviour layer from AIRI (51,823 stars, which already lists Grok as a provider) and TalkingHead (MIT): Grok structured output emits text plus emotion plus gesture per turn, and a local VAD gives barge-in in milliseconds while cutting idle audio we pay for.

## Ranked opportunities

Effort: S is a day or two, M is about a week, L is multi-week. "Gated" means a spend, trade, launch or external post that needs the owner's yes every time, per CLAUDE.md.

### 1. Grok on Vertex AI Model Garden (GCP-billed Grok lane)

- **Source:** docs.x.ai `/developers/community/google-cloud-vertex-ai`. Model id `xai/grok-4.7`, enabled per model in Model Garden, Responses API and Chat Completions over the OpenAI-compatible endpoint, function calling, structured outputs, streaming, reasoning modes.
- **Why it matters:** we hold two grants. The GCP grant is pre-approved for spend. A Vertex route lets Grok answer real traffic while the xAI key stays held, and later gives "dual-credit routing": direct xAI while its credits are healthy, Vertex when they run low, driven by the existing `xai_usage` runway logic.
- **Integration:** one route row in `api/_lib/model-roster.js` (it already has the Vertex transport and a health probe in `llm-health.js`), a price entry in `api/_lib/llm-pricing.js`, a menu row in `api/_lib/chat-models.js`.
- **Two things to settle before building:**
  - Credit eligibility. Google startup credits often exclude third-party and Marketplace products, and partner models can bill that way. Check the Grok model card in Model Garden and the credit terms in [ops/gcp-credits-plan.md](ops/gcp-credits-plan.md) before counting on it.
  - The roster comment dated 2026-09-22 records every Vertex route returning 403 for a project billing hold. Confirm Vertex serves today. Live check (not run this session; the gcloud token read was not permitted):

    ```bash
    T=$(gcloud auth print-access-token --account nich@sperax.io)
    curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
      "https://aiplatform.googleapis.com/v1/projects/aerial-vehicle-466722-p5/locations/global/endpoints/openapi/chat/completions" \
      -d '{"model":"xai/grok-4.7","messages":[{"role":"user","content":"ok?"}],"max_tokens":5}'
    ```
- **Effort:** S to M. Reimplement on existing code.

### 2. Phone numbers for 3D agents (Grok Voice over SIP)

- **Source:** docs.x.ai `/developers/model-capabilities/audio/speech-to-speech/sip`. Register a bring-your-own-trunk number (`origin: "byo_trunk"`), point the carrier at `sip:{number}@sip.voice.x.ai;transport=tls`, receive a signed `realtime.call.incoming` webhook (Standard Webhooks headers), then open `wss://api.x.ai/v1/realtime?call_id=...`. Call control: `refer` (transfer to a human, synchronous result), `hangup`, inbound DTMF buffered to the model, a built-in `send_dtmf` tool, and session resumption so a caller can continue within 30 minutes. Carrier guides for Twilio, Telnyx, Bandwidth and Plivo. xAI does not provision numbers.
- **Ecosystem reference:** livekit/agents (15,355 stars, Apache-2.0) is the common phone-agent stack; we already ship `integrations/livekit`. The xAI path needs no extra framework.
- **Integration:** `api/voice/sip-incoming.js` verifies the webhook, maps the dialled number to an agent, and opens the session with that agent's persona, voice and tools through `api/_lib/grok-voice.js`. "Give this agent a phone number" on the agent settings page. The agent's live page shows the call transcript. `refer` hands the call to the owner.
- **Bigger play:** paid phone skills. A creator publishes a tutor, coach or support line and charges per minute through the existing skill marketplace. Billing the caller is gated.
- **Constraints:** call-recording consent varies by state and country; outbound calling falls under TCPA, so start inbound only. Number rental from a carrier is a new paid service and needs owner approval.
- **Effort:** M. Reimplement.

### 3. Render, look, fix: Grok as the forge's art director

- **Ecosystem pattern** (all build, render, judge with vision, repair):
  - SpatiaOS/Procedura, 494 stars, MIT, pushed 2026-10-20. Text or image to an editable parametric program, built part by part, critiqued and repaired, exported with articulated parts. Runs over MCP inside coding agents.
  - earthtojake/text-to-cad, 27,542 stars, MIT, pushed 2026-11-26. Plugin for coding agents with a build, view, iterate loop.
  - VAST-AI-Research/ShaderAgent, 46 stars, licence unclear. Photo to editable procedural material: designer LLM, renderer, VLM critic.
  - NVlabs/sage, 449 stars, Apache-2.0. Agentic scene generation with a planner, placer and visual verifier.
  - Pan-Chera/Multi-Agent-CAD, 1,089 stars, MIT. Specification, generation and verification as separate agents.
- **What we have:** `api/_lib/forge-quality-gate.js` is a single render-and-judge on Vertex Gemini then an NVIDIA VLM, pass or fail with one retry. `api/_lib/cad/writer.js` writes build123d programs with Kimi K3, then Nemotron, then Groq gpt-oss. Grok is on neither.
- **Build:**
  1. Add a Grok rung to the CAD writer ladder and score it on the existing CAD eval prompts.
  2. Turn the quality gate into a loop: six-view render, a structured JSON critique from Grok vision (or `grok-4.20-multi-agent` for planner and critic roles), then a targeted fix through `refine_model`, `restyle_material` or a CAD rewrite. Stop on pass or after N rounds.
  3. "Match this photo" in the TSL node editor (`src/scene-studio/tsl-editor.js`): the ShaderAgent idea rebuilt on three.js, with Grok as designer and critic. No Blender in the loop.
- **Why Grok:** honestly, any strong vision model can critique. The case for Grok is cost and fit: image input with no fixed image count limit, structured outputs, the multi-agent model at $1.25 / $2.50 per million tokens, and Batch at 20% off for bulk re-scoring.
- **Effort:** S for the CAD rung, M for the loop and the photo-to-material feature. Reimplement; borrow only from the MIT and Apache projects.

### 4. Cited X intelligence for Solana tokens

- **Grok capability:** `x_search` with `allowed_x_handles` or `excluded_x_handles` (up to 10, mutually exclusive), `from_date` and `to_date`, image and video understanding, citations in the answer. Re-verify field names against docs.x.ai before building.
- **Ecosystem reference:** NousResearch/hermes-agent (266,360 stars, MIT) ships an X search feature on Grok; `@langchain/xai` (189,644 a week) types an `XAIResponsesXSearchTool`. No one ties it to on-chain data.
- **Build, all read-only, all extending `api/_lib/x-search.js`:**
  - **Credible voices.** Shard a curated handle list (from leaderboard traders who linked X, plus a reviewed list) in batches of 10 per token. A "Voices" strip on token due diligence and Oracle pages with cited posts and each handle's past hit rate.
  - **Social red flags.** Add an X sweep for the deployer, team and ticker plus "rug", "scam", "honeypot" over 72 hours to the existing `api/_lib/rugcheck.js` result, with citations. Static analysers stay the source of truth for contract facts; Grok adds the social layer that often moves first.
  - **Narrative tags on launches.** Structured output tags every new pump.fun launch with a narrative and "is this riding a live X trend, with what traction", shown as chips on `/launches`. Live path for new mints, Batch for backfill.
- **Guardrails:** treat an answer with zero citations as unsourced and say "no X evidence found" rather than presenting training-data text as X-sourced. Post text and token metadata are attacker-controlled data and never drive an action.
- **Effort:** S to M each.

### 5. Research council on the multi-agent model

- **Reference:** TauricResearch/TradingAgents, 123,839 stars, Apache-2.0, pushed 2026-11-25. Analyst seats (fundamentals, sentiment, news, technicals), a bull and bear debate, a trader and a risk manager. Its listed providers are OpenAI, Anthropic, Google, DeepSeek and OpenRouter; xAI is not among them. virattt/ai-hedge-fund (64,864 stars, MIT) is a second reference.
- **Grok fit:** `grok-4.20-multi-agent` runs the seats; the sentiment and news seats are grounded by `x_search` and `web_search` with citations; code execution does the arithmetic. The architecture itself works on any model; the edge is cited live X evidence.
- **Integration:** a "Council" mode in the trading copilot ([trading-copilot.md](trading-copilot.md)) and the Oracle deep dive. The user sees bull and bear memos with sources, a risk verdict and a stance. Advisory only; executing the trader's decision is gated.
- **Measure it:** log each council and sentiment read with a timestamp and score forward returns with `strategy-backtest.js` and `backtest-integrity.js`, then publish the hit rate. A measured track record is what separates this from black-box signal accounts.
- **Effort:** M to L. Reimplement in JS; borrow the role structure under Apache-2.0.

### 6. The empty 3D niche in the Grok Build plugin marketplace

- **Fact:** `xai-org/plugin-marketplace` (pushed 2026-11-26) lists 36 plugins: development 21, database 4, deployment 3, productivity 3, observability 2, and one each for monitoring, security and media. None cover 3D, avatars, creative assets, games beyond one Unity entry, or agent identity and payments. xai-org/grok-build has 27,863 stars.
- **State:** our plugin lives in `integrations/grok/three-ws`, and the submission is already prepared in [partners/grok-bot-listings.md](partners/grok-bot-listings.md). The research confirms we would be the only entry in the niche. Submitting is an owner step (a PR to an external repo).
- **Follow-on:** a plugin agent that turns a repository's README into a 3D architecture scene with the free forge lane, as a showcase only a 3D platform can make.

### 7. Avatars with a behaviour layer: emotion, gesture, instant barge-in

- **References:**
  - moeru-ai/airi, 51,823 stars, MIT. Self-hosted companion stack with VRM and Live2D; its README lists xAI as a provider.
  - semperai/amica, 1,627 stars, MIT. VRM chat avatars with emotion mapping.
  - met4citizen/TalkingHead, 1,711 stars, MIT; `@met4citizen/talkinghead` 16,423 a week. Mood, gestures and Oculus viseme timelines for GLB avatars.
  - `@ricky0123/vad-web`, 625,714 a week (the README says MIT; the GitHub licence field is empty, so confirm). snakers4/silero-vad, 10,773 stars, MIT.
- **Build:**
  - Grok structured output returns `{text, emotion, gesture}` per turn, mapped to VRM expressions and clips in `src/agent-avatar.js` and `src/element.js`. We already ship `wawa-lipsync`, `@pixiv/three-vrm` and Kalidokit, so this adds the layer they lack.
  - Local VAD on `/voice/grok` and in `<agent-3d>`: on speech start, stop playback and lip sync at once and send `response.cancel`. At $0.08 per minute, not streaming silence upstream also saves money.
  - Optionally a `lipsync="talkinghead"` engine for non-VRM GLBs.
- **Effort:** S for VAD, M for the behaviour layer. Reimplement the mappings; MIT allows lifting snippets with attribution.

### 8. "@bot, make this 3D" on X

- **Fact:** docs.x.ai `/grok-bot/tag-on-x`. Tagging `@bot` in a post or reply hands that post, the post it replies to, and quoted posts with still photos to the tagger's own Grok Bot as a task. A user with our connector installed can reply to any photo on X with "@bot turn this into a rigged 3D avatar" and get the GLB in their Bot. Limits: not available in the UK, EU, EEA or Australia; posts that also tag @grok, or that contain video or GIFs, are ignored.
- **Build:** a section in [grok.md](grok.md) and on `/grok` with the exact phrasing, plus a draft launch post in `data/x-content/queue.json` (posting is an owner step). No code: the connector already does the work.
- **Effort:** S.

### 9. Topic to finished short, with Grok Imagine footage and Grok captions

- **References:** harry0703/MoneyPrinterTurbo, 145,859 stars, MIT (topic, script, stock footage, voice, subtitles, short). Anil-matcha/AI-Youtube-Shorts-Generator, 6,583 stars, MIT.
- **Grok version:** replace stock footage with `grok-imagine-video-1.5-lite` at $0.02 per second (about $0.60 for 30 seconds), voice with Grok TTS, captions from Grok STT word timestamps ($0.10 an hour REST). The agent's avatar hosts picture-in-picture. Reference-to-video (up to 14 references) built from the avatar's turnaround renders keeps the same character recognisable across a whole series, which stock-footage tools cannot do.
- **Integration:** extend `api/_lib/clip-director.js` and `api/_lib/hero-clip.js`; a "Make a short about..." action in the X content queue. Burn captions with ffmpeg ASS subtitles. Avoid Remotion as a dependency: its licence requires a paid company licence above a small team size.
- **Effort:** M. Reimplement the orchestration (the references are Python apps).

### 10. WebSocket mode for tool-heavy agent loops

- **Fact:** docs.x.ai `/developers/advanced-api-usage/websocket-mode`. One long-lived socket to `/v1/responses`; each turn sends only new input plus `previous_response_id`; xAI measured "up to ~20% lower end-to-end latency" on agentic workloads with many tool calls. Warmup turns with `generate: false`. Works with `store=false` and ZDR. Connections last up to 59 minutes and process turns serially.
- **Where it fits:** the chat route for agents that call several three.ws tools per turn, and the voice avatar that makes a model while it talks. It is the transport for the roadmap's move to the Responses API, so build the two together.
- **Effort:** M, as part of roadmap item 1.

### 11. Distribution inside the agent frameworks developers already use

- **Numbers that set priority:** `@ai-sdk/xai` 4.45M a week; `@modelcontextprotocol/sdk` 91.3M; `@ai-sdk/mcp` 10.1M; `@mastra/core` 3.55M; `@openai/agents` 2.3M; `@langchain/xai` 190k; PyPI `xai-sdk` about 826k; the official TS SDK `@xai-official/sdk` only 5,653 (early). elizaOS/eliza has 19,925 stars, but `@elizaos/plugin-xai` gets 56 downloads a week, so Grok inside Eliza is under-served.
- **Build:**
  - Copy-paste examples in `examples/` for `@ai-sdk/xai` (stream a typed scene object that `<agent-3d>` renders live), Mastra, and the OpenAI Agents SDK pointed at `api.x.ai` with our hosted MCP.
  - An Eliza plugin that makes three.ws the 3D body and agent layer for any Eliza agent, defaulting to Grok.
  - Listings for `/api/mcp-grok` and `/api/mcp-studio` on punkpeye/awesome-mcp-servers (98,532 stars) and the official MCP registry. Listing is an owner step.
- **Effort:** S per example; M for the Eliza plugin.

### 12. Evals and red-team with promptfoo

- **Reference:** promptfoo/promptfoo, 27,716 stars, MIT, 1.17M a week, with a documented xAI provider. Community issues on the xAI SDKs ask for exactly this (regression tests for prompts across model versions).
- **Build:** a `promptfooconfig.yaml` that reuses `data/evals/llm-*.jsonl` and compares Grok with the production lane, plus a red-team run against `/api/mcp-grok` (prompt injection through token metadata is the case to test). Keeps `scripts/grok-eval-llm.mjs` as the source of truth; promptfoo adds red-teaming and a shareable config.
- **Effort:** S to M. devDependency.

### 13. Two avatars, one podcast; and dubbing

- **References:** souzatharsis/podcastfy, 6,861 stars, Apache-2.0 (URL or PDF to a two-host dialogue). jianchang512/pyvideotrans, 19,850 stars, GPL-3.0 (reference only, do not link).
- **Build:** paste an article, two of the user's agents debate it as `<agent-3d>` hosts, with an MP3 download and an Imagine cover clip. Script on `grok-4.3` ($1.25 / $2.50 per million tokens), voices on Grok TTS ($15 per million characters, about $0.90 an hour of speech). "Dub this clip" for hero clips into the locales we already ship.
- **Constraints:** label machine-dubbed output; custom-voice dubbing needs the speaker's consent (see roadmap item 4).
- **Effort:** M each.

### 14. Spatial and XR

- **References:** google/xrblocks, 527 stars, Apache-2.0, `xrblocks` 10,001 a week (three.js WebXR plus AI, Gemini-centred samples). NVlabs/SpatialClaw and manycore-research/SpatialLM (licences unclear, ideas only). Tencent-Hunyuan/Hunyuan3D-WorldClaw (no licence declared, ideas only).
- **Build:** a Grok "look at this" mode in `src/xr.js` and `src/ar-studio.js` where an `<agent-3d>` avatar answers about the camera view; code-checked spatial answers on splats ("how wide is this doorway") with Grok code execution; a prompt-to-furnished-scene button in Scene Studio built on the SAGE planner, placer and critic pattern.
- **Effort:** M to L. Lower priority than items 1 to 9.

## Wild but credible

- **Verify the call.** Reply to any crypto call on X; the bot pulls the caller's earlier calls with `x_search`, prices them with code execution, and replies with a cited hit rate. Reuses the mention bot, `x_search` and the backtest code. Replies are drafts for approval until the owner turns posting on.
- **Council as a service.** Sell the research council as a paid agent skill on Solana, with the citation bundle as the receipt. Agent hiring, x402 and provenance receipts already exist. Payments gated.
- **A digital twin of your machine.** Photo of a real device, plus its manual in Collections, plus code execution for the physics, becomes an anatomy cutaway of that exact machine with an avatar explaining the fault.
- **Video to world.** Imagine reference-to-video generates an orbit of a forged object, and the existing splat pipeline (`src/splat-generate.js`) turns it into a talkable splat. Unproven on quality; test against the current photo-to-splat path first.

## What the research adds to the existing roadmap

- **Batch (roadmap 3):** open issues on the official SDKs report that batch and deferred results return tool-call output instead of the final answer when server-side tools are on, and that Batch rejects grok-4.5. Keep batch jobs tool-free, pin the model, and call `/v1/batches` with plain `fetch` if the TS SDK (`@xai-official/sdk` 0.2.x) gets in the way.
- **Custom voices (roadmap 4):** besides the US-except-Illinois gate, store a consent artefact, cap clones per user, and refuse public figures. The same rules apply to any open TTS fallback that clones (resemble-ai/chatterbox, 28,130 stars, MIT, watermarks its output).
- **Free TTS floor:** chatterbox and hexgrad/kokoro (10,397 stars, Apache-2.0) on a GCP GPU worker are the one place Grok loses on cost. Keep Grok as the premium voice and open weights for the free tier. We already run Kokoro in the browser (`src/runtime/neural-tts.js`).
- **Responses API (roadmap 1 and 8):** do it over WebSocket mode (item 10) so long tool loops get the latency win too.

## Considered and not recommended

- Mesh-as-tokens LLMs (nv-tlabs/LLaMA-Mesh, lucidrains/meshgpt-pytorch): unmaintained since 2024 and 2025; the forge already beats them. At most a structured-output blockout lane.
- OpenSCAD MCP servers: CSG only; CAD Forge's build123d path already covers the use case.
- Photoreal talking heads with unclear licences: LivePortrait (non-commercial face weights), SadTalker and Wav2Lip (stale or no licence). If photo avatars are wanted, TMElyralab/MuseTalk (7,051 stars, MIT) on a GPU worker, with consent attestation, no public figures, and watermarked output.
- LiteLLM, Portkey, RouteLLM, GPTCache, NeMo Guardrails: duplicate the provider chain, ledger, prompt-cache routing and xAI's own moderation controls we already have or have planned. Publishing a LiteLLM config snippet for outside developers is fine.
- Langfuse and OpenLLMetry: only worth adding once there is a real consumer for span-level traces; `xai_usage` already records cost.
- solana-agent-kit (last push 2026-05-14) and Coinbase AgentKit (EVM-first): borrow action taxonomies only. hummingbot: reference only; anything automated is a trade.

## Limits of this sweep

- GitHub's search API rate-limited every researcher partway through, so long-tail discovery (small Grok MCP servers, KOL trackers, awesome-grok lists) is thin. Direct repository lookups were not affected. A search for awesome-grok lists found only empty repositories.
- Competitor voice prices (OpenAI Realtime, ElevenLabs) were not verified and are left out on purpose. Check their pricing pages before any public comparison.
- Grok on Vertex and the Grok Bot meetings surface were not exercised live.
- No xAI API call was made; the key is held by the owner on purpose.
