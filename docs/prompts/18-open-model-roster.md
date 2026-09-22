# 18. Open-model roster and free-tier models

Read `docs/prompts/README.md` first.

## The problem

The model roster in `api/brain/chat.js` and `api/_lib/chat-models.js` is Claude, GPT, one open-weights GPT variant, Qwen through a provider package, IBM Granite and NVIDIA NIM. Users expect to choose Llama, DeepSeek, Kimi, Mistral and Qwen for an agent's brain, to have at least one genuinely free model for the free tier, and to switch per message. GCP is pre-approved: Vertex AI Model Garden serves these models, so no new paid vendor is needed.

## Build

- Add the open models through Vertex AI (Model Garden endpoints or partner models on Vertex) in the LLM chain (`api/_lib/llm-tool-chain.js`, `chat-models.js`, `llm-pricing.js`, `llm-health.js`): Llama 4 family, DeepSeek V3 and R1, Kimi K2, Mistral Large and Small, Qwen 3, plus Gemini 2.5 Pro and Flash. Each entry carries input and output price, context window, tool-calling support, and a health probe. Failover chains stay intact; a model without tool calling is refused for runs and allowed for chat.
- Free tier: mark at least two models as free and route the free-tier quota from prompt 05 to them, with the daily allowance in `app_settings` and shown on `/pricing`.
- Per-agent default model and per-message override everywhere a message is sent (web, SDK, gateways, MCP `chat_with_agent`).
- Model picker UI on the agent editor and in chat: grouped by provider, price per million tokens, context, tool support, latency from the health probe, free badge. Every state designed, including "provider degraded" from `llm-health.js`.
- `GET /models` from prompt 05 and the `three://models` resource reflect all of it.

## Acceptance

- Create an agent on a Llama model and on DeepSeek; each answers a tool-using request end to end.
- Exhausting the free-tier allowance on a free model returns the quota error with the reset time.
- `docs/agent-runtime.md` and `docs/api-reference.md` updated; changelog entry tagged `feature`; `npm test` green.
