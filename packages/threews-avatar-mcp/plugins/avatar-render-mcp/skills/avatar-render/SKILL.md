---
name: avatar-render
description: Render a three.ws 3D avatar inline, get a paste-ready iframe embed, or fetch avatar metadata with the avatar-mcp tools. Use when asked to show, embed or look up a three.ws avatar by id, @handle or GLB URL.
---

# three.ws avatars from chat

The plugin starts `@three-ws/avatar-mcp` over stdio (`npx -y @three-ws/avatar-mcp`, bin `avatar-mcp`). It is free, read only and needs no API key.

## Environment (both optional)

- `THREEWS_BASE_URL`: API origin, default `https://three.ws`.
- `THREEWS_TIMEOUT_MS`: request timeout in milliseconds, default 30000.

## Selecting an avatar

Every tool takes one of: `id` (avatar UUID), `handle` (username, with or without `@`), or `model` (a direct https GLB or GLTF URL, used as is). `get_avatar` accepts only `id` or `handle`. Private avatars return an error saying they have no public model.

## Tools

| Tool | Extra arguments | Returns |
| --- | --- | --- |
| `render_avatar` | `background` (`transparent`, `dark`, `light`), `scene` (`portrait`, `headshot`, `upper-body`, `full-body`), `auto_rotate`, `height` (160-1080) | An interactive rotatable 3D view in hosts that support MCP Apps, a PNG preview when the avatar has an id, the viewer URL, embed URL and iframe. |
| `avatar_embed_code` | `background`, `width`, `height`, `idle`, `overlay` | The embed URL and a ready iframe snippet for a website. |
| `get_avatar` | none | Name, slug, GLB `model_url`, thumbnail, visibility and owner. |

The server also offers a `showcase-avatar` prompt that takes an avatar id or handle.

## Worked example

Request: "Show me @nirholas's avatar and give me the embed code."

1. Call `get_avatar` with `{ "handle": "nirholas" }` to confirm it exists and is public.
2. Call `render_avatar` with `{ "handle": "nirholas", "scene": "headshot" }` to display it.
3. Call `avatar_embed_code` with `{ "handle": "nirholas", "height": 480 }` and give the user the `iframe` value.

## Notes

- Only https model URLs are accepted (http only for localhost).
- A handle or id that does not resolve returns the upstream error. Report it rather than guessing another one.
