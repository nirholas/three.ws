---
name: analyze-images
description: Read, describe and answer questions about images (screenshots, renders, photos) using the vision MCP server backed by the three.ws vision pipeline. Use when the user wants OCR, a caption, alt text or a visual critique of an image URL or base64 image.
---

# Analyze images with the vision MCP server

This plugin's `.mcp.json` starts `npx -y @three-ws/vision-mcp` (server name `vision`). It calls the public three.ws `/api/vision` endpoint, which tries free NVIDIA NIM vision models first and falls back to a paid backstop on the platform's side. The caller pays nothing and needs no provider key.

## Setup

Nothing is required. Optional env vars, exported in the shell before starting Claude Code:

- `THREE_WS_API_KEY`: a three.ws API key sent as a bearer token. It raises the rate limit from per-IP to per-user.
- `THREE_WS_BASE`: deployment to call (default `https://three.ws`).
- `THREE_WS_TIMEOUT_MS`: per-request timeout (default 30000).

Requires Node.js 20 or newer.

## Tools

- `get_vision_status`: no arguments. Reports whether a provider is live, the accepted `image_types` (JPEG, PNG, WebP, GIF) and the size limit (12 MB). Call it first when a vision call fails.
- `analyze_image`: `prompt` (required, up to 2000 characters) plus exactly one of `imageUrl` (public https URL) or `image` (base64 or data URI). Optional `imageType` (needed for raw base64) and `maxTokens` (16 to 2048, default 512). Use for OCR, visual Q&A, classification and critique.
- `describe_image`: exactly one of `imageUrl` or `image`; optional `imageType`, `detail` (`brief`, `standard` or `detailed`, default `standard`) and `focus` (an aspect to emphasize). Use for captions and alt text.

## Rules

- `imageUrl` must be public https. The server fetches it, so private or loopback hosts are rejected. For a local file, base64-encode it and pass `image` with `imageType`.
- Pass only one of `imageUrl` and `image`.
- Answers come from a non-deterministic model. Treat OCR output as a draft and say so when exact text matters.

## Worked example

User: "What does the banner in this screenshot say?"

1. Call `analyze_image` with `{"imageUrl": "https://example.com/shot.png", "prompt": "What does the banner text say?"}`.
2. The result has `ok`, `text`, `provider`, `model` and `image_source`. Quote `text` to the user.

For alt text: call `describe_image` with `{"imageUrl": "...", "detail": "brief"}` and use the `description` field.
