---
name: embed-assistant-widget
description: Generate a paste-ready three.ws 3D avatar chatbot embed (script tag, frame URL, ThreeAssistant.init snippet) with the assistant MCP server. Use when the user wants a floating avatar assistant on a website.
---

# Embed a three.ws assistant widget

The plugin starts the `@three-ws/assistant-mcp` MCP server (Node 20+, started with `npx -y @three-ws/assistant-mcp`, stdio). It is pure and offline: no API key, no network call. Optional env: `THREE_WS_BASE` (origin baked into the generated URLs, default `https://three.ws`).

## Tools

1. `list_assistant_options`: optional `filter` of `avatars`, `backgrounds`, `modes`, `chat_lanes` or `attributes`. Omit it for everything. Call this first to see valid avatars, backgrounds and `data-*` attributes.
2. `build_assistant_widget`: all fields optional.
   - `avatar`: avatar id, `/avatars/*.glb` path or GLB URL (default mannequin)
   - `agent`: a three.ws agent id, as an alternative to `avatar`
   - `background`: `transparent`, `#hex`, a preset (`ember`, `ocean`, `violet`, `forest`, `dusk`, `slate`) or `gradient:#a,#b[,angle]`
   - `mode`: `chat`, `speak` or `both` (default)
   - `name` (60 chars), `greeting` (200), `context` (500, what the assistant should know about the site)
   - `accent` (`#hex`, default `#f97316`), `position` (`right` or `left`), `voice` (boolean), `badge` (boolean)

Invalid values fall back to defaults rather than failing, so check the returned `config` to see what was actually applied.

## Result

`build_assistant_widget` returns `snippet` (a `<script src=".../assistant/v1.js" async data-...>` tag with only non-default settings), `frame_url` (for an `<iframe>`), `js_api` (a `ThreeAssistant.init({...})` call), `builder_url`, the normalized `config`, and `notes`.

## Example

Call `build_assistant_widget` with:

```json
{"avatar": "/avatars/selfie-girl.glb", "background": "ocean", "name": "Aria", "greeting": "Hi! Ask me anything about the site.", "accent": "#00c2ff", "position": "left"}
```

Paste the returned `snippet` before `</body>` of the user's page, or use `frame_url` in an iframe. If the user wants to design it visually, point them to the `builder_url`.

## Running from a clone

`npm install` then `node src/index.js` starts the same stdio server.
