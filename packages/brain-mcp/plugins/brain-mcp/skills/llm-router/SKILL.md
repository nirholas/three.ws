---
name: llm-router
description: List the models the three.ws multi-provider LLM router can run and get a chat completion from any of them through the brain-mcp tools. Use when asked to get a second opinion from a different model or to compare model answers.
---

# three.ws LLM router

The plugin starts `@three-ws/brain-mcp` over stdio (`npx -y @three-ws/brain-mcp`). It wraps the router at `/api/brain/chat` on three.ws.

## Environment

- `THREE_WS_API_KEY` (optional): sent as `Authorization: Bearer <key>`. Paid first-party flagships need it. The free open-weight tiers (the default `gpt-oss-120b` and the NVIDIA NIM models) work without it. Never print the key.
- `THREE_WS_BASE`: API origin, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS`: per-request timeout in milliseconds.

## Tools

| Tool | Arguments | Endpoint |
| --- | --- | --- |
| `list_providers` | none | `GET /api/brain/chat` |
| `chat` | `messages` (required, 1-100 items of `{ role: "user" or "assistant", content }`), `provider` (key from `list_providers`, default `gpt-oss-120b`), `system` (up to 8000 characters), `maxTokens` (64-16384, default 4096) | `POST /api/brain/chat` |

`list_providers` returns one entry per model with `key` (the value to pass as `provider`), `label`, `network` (the upstream vendor), `tier`, `maxOutput`, `available` (a working route exists right now) and `requiresAuth` (true when a three.ws API key is needed). It also reports `default_provider`. `chat` returns the full reply as one message, plus the route actually taken, token usage and timing. It does not change platform state.

## How to use them

1. Call `list_providers` first. Do not guess provider keys, since the configured set changes.
2. Pick a model that fits the task and call `chat` with `provider` set to its `key`. Put instructions in `system`, not in a user turn.
3. Prefer entries with `available: true`. When `requiresAuth` is true and no `THREE_WS_API_KEY` is set, tell the user a key is needed, or choose an entry with `requiresAuth: false`.

## Worked example

Request: "Ask a second model to review this answer."

Call `list_providers`, choose a key different from the model you are running on, then call `chat` with `{ "provider": "<key>", "system": "You are a careful reviewer.", "messages": [{ "role": "user", "content": "Review this answer for errors: ..." }] }`. Report the reply and which provider produced it.

## Notes

- Messages sent through `chat` leave the machine for the chosen provider. Do not send secrets or private data unless the user agrees.
