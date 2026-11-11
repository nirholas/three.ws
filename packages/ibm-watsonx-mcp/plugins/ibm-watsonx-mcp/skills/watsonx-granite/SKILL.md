---
name: watsonx-granite
description: Call IBM watsonx.ai Granite models from an agent through the ibm-watsonx-mcp server: chat, raw text generation, embeddings, token counting, time-series forecasting and model discovery with your own IBM Cloud credentials.
---

# IBM watsonx.ai Granite via MCP

The plugin starts `@three-ws/ibm-watsonx-mcp` over stdio (`npx -y @three-ws/ibm-watsonx-mcp`). Tools appear as `mcp__ibm-watsonx-mcp__<tool>`. Calls go straight to IBM using your credentials. The server exits at startup with a clear message when a required variable is missing.

## Environment

- `WATSONX_API_KEY` (required): IBM Cloud API key from https://cloud.ibm.com/iam/apikeys.
- `WATSONX_PROJECT_ID` or `WATSONX_SPACE_ID` (one is required): watsonx.ai project or deployment space id.
- `WATSONX_URL`: regional host, default `https://us-south.ml.cloud.ibm.com`.
- `WATSONX_MODEL_ID`: default chat and generation model, default `ibm/granite-3-8b-instruct`.
- `WATSONX_EMBED_MODEL_ID`: default `ibm/granite-embedding-278m-multilingual`.
- `WATSONX_FORECAST_MODEL`: default `ibm/granite-ttm-512-96-r2`.
- `WATSONX_API_VERSION` (default `2024-05-31`), `WATSONX_TS_API_VERSION` (default `2025-02-11`), `WATSONX_TIMEOUT_MS` (default 60000).

## Tools

- `watsonx_list_models` (`filter`, `limit` 1-200): models your account and region can run. Filter examples: `function_text_generation`, `function_embedding`. Call it first when you want a non-default model.
- `watsonx_chat` (`messages` of `{role: system|user|assistant, content}`, `model`, `max_tokens` up to 4096, `temperature` 0-2, `top_p`): multi-turn chat, returns the reply and token usage.
- `watsonx_generate` (`input`, `model`, `max_new_tokens`, `decoding_method` greedy|sample, `stop_sequences`, plus sampling options): raw completion with decoding control.
- `watsonx_embed` (`inputs` array of strings, `model`): one vector per input and the dimensionality.
- `watsonx_tokenize` (`input`, `model`, `return_tokens`): token count, optionally the tokens, to budget context.
- `watsonx_forecast` (`timestamps`, `values`, `freq`, `model`, `target_column`, `prediction_length` up to 96): zero-shot time-series forecast. Timestamps are ISO-8601 at a uniform cadence, oldest first. The series must be at least as long as the model context (512 for the default). `freq` is a pandas-style string such as `1h`, `15min`, `1D`.

## Example

Semantic search index: call `watsonx_embed` with `inputs: ["refund policy", "shipping times"]`, store the vectors, embed the query the same way, and rank by cosine similarity.

Forecast: call `watsonx_forecast` with 512 or more hourly `values`, matching `timestamps`, `freq: "1h"`, `prediction_length: 24`, then explain the result with `watsonx_chat`.
