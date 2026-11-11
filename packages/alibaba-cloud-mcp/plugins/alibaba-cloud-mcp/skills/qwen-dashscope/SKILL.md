---
name: qwen-dashscope
description: Run Qwen chat completions and text embeddings on Alibaba Cloud DashScope with the user's own API key, and list the models on the account, through the alibaba-cloud-mcp tools. Use when asked to use a Qwen model or to embed text with Alibaba Cloud models.
---

# Qwen on Alibaba Cloud DashScope

The plugin starts `@three-ws/alibaba-cloud-mcp` over stdio (`npx -y @three-ws/alibaba-cloud-mcp`). It calls DashScope with the user's own account, so usage is billed to that account.

## Environment

- `DASHSCOPE_API_KEY` (required): create one in the Alibaba Cloud Model Studio console under API Keys. The server exits at startup with a configuration error when it is missing. Never print the key.
- `DASHSCOPE_MODEL_ID`: default chat model, default `qwen-plus`.
- `DASHSCOPE_EMBED_MODEL_ID`: default embedding model, default `text-embedding-v3`.
- `DASHSCOPE_REGION`: set to `cn` to use the China endpoint. The default is the international endpoint.
- `DASHSCOPE_BASE_URL`: custom endpoint override.
- `DASHSCOPE_TIMEOUT_MS`: request timeout, default `60000`.

## Tools

| Tool | Arguments |
| --- | --- |
| `qwen_chat` | `messages` (required, `{ role: "system" or "user" or "assistant", content }`), `model`, `max_tokens` (1-32768), `temperature` (0-2), `top_p` (0-1) |
| `qwen_embed` | `inputs` (a string or an array of strings, required), `model`, `dimensions` (64-2048) |
| `qwen_list_models` | none |

Chat model options named in the tool: `qwen-max` (highest quality), `qwen-plus` (default), `qwen-turbo` (fastest and cheapest), `qwen-long` (very large contexts) and `qwen-max-latest`. Embedding options: `text-embedding-v3` (default, 1024 dimensions), `text-embedding-v2` and `text-embedding-async-v3`.

`qwen_chat` returns the reply text and token usage. `qwen_embed` returns one float vector per input, with the model and dimension count. `qwen_list_models` returns model ids, owners and creation times.

## How to use them

1. If a model id is in doubt, call `qwen_list_models` first and use an id it returns.
2. For written answers use `qwen_chat`. For search, clustering or retrieval over text, use `qwen_embed` and compare vectors yourself.
3. Keep `dimensions` identical across every text you intend to compare.

## Worked example

Request: "Embed these three product descriptions so I can cluster them."

Call `qwen_embed` with `{ "inputs": ["desc one", "desc two", "desc three"], "dimensions": 1024 }`. You get three 1024-dimension vectors in input order.

## Notes

- A DashScope error comes back as `DashScope error: <message>` with the result flagged as an error. Report the message, since it usually names a quota, key or model problem.
- Text you send leaves the machine for Alibaba Cloud. Do not send secrets or private data without the user's agreement.
