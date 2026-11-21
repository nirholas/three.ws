# Grok roadmap: what the xAI docs make possible next

Gap analysis of the xAI developer docs against what three.ws already ships on Grok, ranked by value per unit of work. Written 2026-11-21, after joining Grok for Startups. Read it with [grok.md](grok.md) (current integration), [ops/llm-lanes.md](ops/llm-lanes.md) (model menus) and [ops/xai-credits.md](ops/xai-credits.md) (credit ledger).

The local reference copy of the docs lives in `docs/vendor/xai-docs/`. It is gitignored because the text is xAI's copyright. Refresh it with `npm run sync:xai-docs`. Agents can also query the docs live through the `xai-docs` MCP server in `.mcp.json`. Routes below are docs.x.ai paths, and each one is also a file under that folder.

## Blocker before any of this matters

The production `GROK_API_KEY` from the Grok for Startups team is not installed. Until it is, every Grok lane falls back to another provider and the credits sit unused while their six-month clock runs. The owner creates the key at console.x.ai on the three.ws team, then runs `npm run setup:xai-key`. Everything below assumes that key.

## Already in place

| Capability | Where |
|---|---|
| Chat, tool calling and model menus on grok-4.7 and family | `api/_lib/chat-models.js`, `api/chat.js`, `api/_lib/llm.js` |
| Prompt-cache routing with `x-grok-conv-id`, hit rate in `npm run grok:usage` | `api/_lib/xai-conv-id.js`, [ops/xai-credits.md](ops/xai-credits.md#prompt-caching) |
| Model drift and end-of-life check against `/developers/models` and release notes | `npm run check:xai-models` |
| `x_search` over the Responses API | `api/_lib/x-search.js` |
| Remote MCP from the Responses API, proven end to end | `npm run e2e:xai-mcp` |
| Image and video generation | `api/_lib/xai-image.js`, `api/_lib/xai-video.js` |
| Speech-to-speech voice avatars | `/voice/grok`, `api/_lib/grok-voice.js` |
| Credit ledger with runway and expiry warnings | `xai_usage`, `/api/healthz` |

## Ranked opportunities

### 1. Grok agents that use three.ws tools server-side (remote MCP in production)

Docs: `/developers/tools/remote-mcp`. A Responses API request can carry a `{"type":"mcp","server_url":...,"server_label":...,"allowed_tools":[...]}` tool. xAI then discovers and calls the tools itself, so one request does work that takes our own tool loop several round trips. The e2e script already proves Grok can drive our MCP servers. The product step is a chat route for Grok agents that sends the agent's enabled skills as an MCP tool, scoped by `allowed_tools` and authorized per agent through the `authorization` field. Speech to speech accepts the same tool (`/developers/model-capabilities/audio/speech-to-speech`), so a voice avatar could make a 3D model while it talks.

Wiring: `api/chat.js` route selection plus `api/_lib/mcp-connections/` for per-agent tokens. Security: issue a short-lived token per request, never the owner key.

### 2. Agent knowledge from Collections (managed RAG)

Docs: `/developers/files/collections`, `/developers/tools/collections-search`. Upload an agent's documents into an xAI collection and add the collections search tool to its requests. This gives every agent a grounded knowledge base without us running a vector store. Map one collection to one agent, create it on first upload, and record the collection id on the agent row. Retrieval cost goes through the existing ledger lane `chat`.

### 3. Batch API for bulk jobs: 20% off and outside rate limits

Docs: `/developers/advanced-api-usage/batch-api`, `/developers/pricing#batch-api-pricing`. grok-4.7, 4.6, 4.5 and 4.3 are 20% off on every token type, and batch requests do not count against per-minute limits. Every i18n translation backend was failing as of 2026-11-13, and translation is exactly this shape of work: large, not interactive, and done within 24 hours. A batch backend for `npm run i18n:translate` on grok-4.7 replaces them. The same path fits nightly agent-profile summaries and the changelog digest. Record each batch result through `recordXaiUsage` with the discounted price.

### 4. A voice of its own for each agent (custom voices)

Docs: `/developers/model-capabilities/audio/custom-voices`. Clone a voice from a short reference clip and pass its `voice_id` to `/v1/tts` or `/v1/realtime`. An agent owner records a clip in the agent editor, and the avatar speaks in that voice on `/voice/grok` and in every embed. Constraints from the docs: available in the United States except Illinois, and voices are scoped to our team. The product therefore needs a consent step (the speaker is the uploader) and a region gate. `api/_lib/grok-voice.js` already lists voices by `voice_id`, so the session side is small.

### 5. Edit, not regenerate (image editing with up to five references)

Docs: `/developers/model-capabilities/images/editing`, `/developers/model-capabilities/images/multi-image-editing`. Restyle an avatar's reference image, or merge several references into one concept sheet before it goes to the 3D forge. This feeds the forge directly: a better reference image produces a better mesh. Wiring: add an edit mode to `api/_lib/xai-image.js`, then expose it on the forge reference step.

### 6. Safety controls per agent and per embed

Docs: `/developers/advanced-api-usage/custom-moderation-controls`. A `guidelines` array declines `nsfw`, `violence` or `profanity` per request. Expose these as switches in the agent editor and on `<agent-3d>` embeds (brand-safe mode for partner pages), and send them from `api/chat.js` and `api/widgets/[id]/[action].js` on xAI routes. Also send `safety_identifier` set to a hash of the account id, so xAI's abuse signals reach the end user rather than the platform key.

### 7. Exact answers for market and wallet questions (code execution)

Docs: `/developers/tools/code-execution` (`code_interpreter` in the Responses API). Pump.fun and portfolio questions involve arithmetic that models get wrong when they estimate. Turn the tool on for trading-skill turns only, where a wrong number costs money.

### 8. Cheaper long conversations with `previous_response_id`

Docs: `/developers/rest-api-reference/inference/responses`. The Responses API keeps conversation state server-side, so a turn sends only the new message. Combined with conv-id routing, this cuts uploaded tokens on long agent chats. It requires moving the chat route from chat completions to Responses, which item 1 does anyway, so do both together.

### Watch list

- Multi-agent model (`grok-4.20-multi-agent-0309`, also 20% off in batch): candidate for the art director agent's critique pass once the eval harness can compare it.
- Grok Bot inference hooks and routines (`/grok-bot/inference-hooks`, `/grok-bot/skills-routines-and-automations`): the plugin already lists in Grok Build. Hooks would let a routine refresh an agent's 3D scene on a schedule.
- Video edits and extensions (`/developers/rest-api-reference/inference/videos`): extend hero clips instead of regenerating them.
- Speech to text (`/developers/model-capabilities/audio/speech-to-text`): a single-provider replacement for the browser STT fallback on the standard voice chain.

## How to start one

1. Read the route in `docs/vendor/xai-docs/` (or ask the `xai-docs` MCP server) for the exact request shape.
2. Add the call through the existing helpers so it is priced and recorded: `recordXaiUsage` with a lane, `withGrokConvId` on the headers.
3. Prove it against the real API with a script in `scripts/` in the style of `xai-mcp-e2e.mjs` (it has a `--dry-run` mode that needs no key).
4. Run `npm run check:xai-models` so a model the feature depends on cannot retire without warning.
