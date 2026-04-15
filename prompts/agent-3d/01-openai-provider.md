# Task 01 — OpenAI brain provider

## Context

The runtime currently ships with an Anthropic provider at [src/runtime/providers.js](../../src/runtime/providers.js) and a no-op `NullProvider`. The `createProvider()` factory throws for any other provider string. We want parity for OpenAI so developers can pick their model provider in a manifest or via the `brain` attribute on `<agent-3d>`.

OpenAI's tool-use shape differs from Anthropic's. The runtime's `_loop()` in [src/runtime/index.js](../../src/runtime/index.js) consumes a normalized result `{ text, toolCalls: [{ id, name, input }], thinking, stopReason }` and hands back `provider.formatAssistantWithToolCalls(...)` and `provider.formatToolResults(...)` — the provider encapsulates both directions of the API shape.

## Goal

Add `OpenAIProvider` to [src/runtime/providers.js](../../src/runtime/providers.js) with full tool-use parity and identical normalized output, so the runtime is provider-agnostic and `manifest.brain.provider: "openai"` just works.

## Deliverable

1. **`OpenAIProvider` class** in [src/runtime/providers.js](../../src/runtime/providers.js):
	 - Constructor accepts `{ model, proxyURL, apiKey, temperature, maxTokens }`. Default model: `gpt-4o-2024-11-20`.
	 - `async complete({ system, messages, tools })` — POST to `${proxyURL}/v1/chat/completions` (or `https://api.openai.com/v1/chat/completions` if `apiKey` passed directly). Respect the `key-proxy` pattern from [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) — never send raw API keys to the browser unless explicitly provided.
	 - Convert Anthropic-shaped `messages` (already flowing through the runtime) into OpenAI's chat format:
		 - `role: "assistant"` messages with `content: [{ type: "tool_use", id, name, input }]` → OpenAI's `tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(input) } }]`.
		 - `role: "user"` messages with `content: [{ type: "tool_result", tool_use_id, content }]` → OpenAI's `role: "tool", tool_call_id, content`.
	 - Convert tool schemas: Anthropic's `{ name, description, input_schema }` → OpenAI's `{ type: "function", function: { name, description, parameters } }`.
	 - Normalize response to `{ text, toolCalls, thinking: "", stopReason }`.
	 - `formatAssistantWithToolCalls(text, toolCalls)` must round-trip through the runtime untouched — meaning the Anthropic-shape message objects the runtime stores are OK; the conversion happens inside `complete()` on the way out.
2. **Register in `createProvider()`** — extend the factory to dispatch `provider === "openai"`.
3. **Update [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md)** — add `openai` to the `brain.provider` enum line and list representative model ids.

## Audit checklist

- [ ] `OpenAIProvider.complete()` returns the same normalized shape as `AnthropicProvider.complete()` — including empty `thinking` string.
- [ ] Tool calls flow end-to-end: a skill declares a tool, runtime calls it, response is consumed by OpenAI, runtime dispatches, result message is built, OpenAI receives it on the next turn.
- [ ] `messages` array format the runtime maintains does NOT diverge between providers — conversion is provider-local.
- [ ] Multiple tool calls in one assistant turn are supported (OpenAI returns them as an array).
- [ ] `system` is passed as a prepended `{ role: "system" }` message since OpenAI doesn't have a dedicated `system` top-level field.
- [ ] Errors surface with provider + status in the message (`OpenAI 429: ...`).
- [ ] No API key leaks to the DOM even when `api-key` attribute is set (stay behind fetch — don't log the request body).
- [ ] Works with `brain="gpt-4o-mini"` on `<agent-3d>` as a shortcut (element already passes `brain` → `manifest.brain.model`).

## Constraints

- No new npm dependencies. Use `fetch`.
- Do not introduce streaming in this task — a follow-up can add SSE.
- Do not touch [src/runtime/index.js](../../src/runtime/index.js) except to add OpenAI to an allowlist comment if one exists. The provider must conform to the existing `Runtime._loop()` contract.
- Do not read any existing OpenAI SDK — we stay vanilla fetch for bundle-size reasons.

## Verification

1. `node --check src/runtime/providers.js`.
2. `npm run build:lib` passes.
3. Write a tiny local harness in `scratch/openai-smoke.js` (gitignored or deleted after): instantiate `OpenAIProvider` with a real key, send a prompt that forces a tool call with a fake tool schema, confirm the normalized response shape. Delete the harness after confirming.
4. In a browser, set `<agent-3d manifest="..." brain="gpt-4o-mini" key-proxy="http://localhost:8787/openai">` with a local proxy that forwards to OpenAI, confirm the agent replies.

## Scope boundaries — do NOT do these

- Do not implement streaming / SSE / partial token handling.
- Do not add OpenAI-specific features (o1 reasoning, assistants API, vision) — those are separate tasks.
- Do not invent a new normalized shape. Match Anthropic's exactly.
- Do not change the manifest schema beyond adding `openai` to the enum line.

## Reporting

- Confirm the tool-use round-trip worked end-to-end (include a copy-paste of the request + response logs from your smoke test, redacted).
- Flag any behavior difference between providers that leaked into the runtime (there should be zero).
- Note token usage differences observed (OpenAI prices differently; operators may want to see this in future telemetry).
