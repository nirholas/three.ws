---
name: avatar-and-glb-tools
description: Spawn and dress a 3D avatar, make it speak, render stills, and inspect, validate, optimize or thumbnail any GLB with the avatar-agent MCP tools. Use when an agent needs a presentable 3D avatar or has to check or shrink a glTF/GLB file.
---

# Avatar sessions and GLB tools

The plugin starts `@three-ws/avatar-agent` over stdio (`npx -y -p @three-ws/avatar-agent three-avatar-agent-mcp`).

## Environment

- `NVIDIA_API_KEY` (optional): lets `speak` use the free NVIDIA Magpie TTS lane.
- `OPENAI_API_KEY` (optional): lets `speak` fall back to OpenAI TTS when the free lane is unavailable.
- Without either key `speak` cannot synthesize audio. The GLB tools and avatar sessions need no key.

## GLB tools (no session, no key)

| Tool | Arguments | Result |
| --- | --- | --- |
| `inspect_glb` | `url` (public URL or `data:` URL) | Meshes, materials, textures, animations, skins, vertex and triangle counts, bounding box, file size. |
| `validate_glb` | `url` | Khronos gltf-validator report: errors, warnings, infos and hints with codes and JSON pointers. |
| `optimize_glb` | `url`, `dedup`, `prune`, `weld`, `draco` (default false) | Optimized GLB plus `beforeBytes`, `afterBytes` and `reductionPct`. |
| `thumbnail_glb` | `glbUrl`, `width`, `height` (64-2048), `background` | A rendered still of the model. |

Inspect first to see how heavy a model is, validate when it fails to load or renders wrong, then optimize.

## Avatar tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `list_avatars` | none | Default avatars, accessories (hats, glasses, earrings) and pose names with public GLB URLs. |
| `list_animations` | none | The three.ws pose preset catalog; use the ids as `posePresetId`. |
| `spawn_avatar` | `preset` (`default`) or `glbUrl`, `name`, `voice`, `persona` | A `sessionId`, the GLB URL and a `viewerUrl`. Call this first. |
| `dress_avatar` | `sessionId`, `accessoryIds`, `pose` | Updated session and viewer URL. |
| `viewer_url` | `sessionId` or `glbUrl`, `pose`, `accessoryIds`, `background` | Shareable three.ws viewer URL and an iframe snippet. |
| `render_avatar` | `sessionId` or `glbUrl`, `posePresetId`, `cameraOrbit`, `width`, `height`, `background` | A rendered image. |
| `speak` | `text` (1-4096 chars), `sessionId`, `voice`, `format`, `language`, `speed` | A base64 `data:` audio URL the client can play. |

Sessions live in the server process only. A `sessionId` is invalid after the server restarts, and tools answer `unknown_session`. Call `spawn_avatar` again.

## Worked example

1. `list_avatars`, then `spawn_avatar` with `{"preset": "default", "name": "Guide"}`. Keep the returned `sessionId`.
2. `dress_avatar` with `{"sessionId": "<id>", "accessoryIds": ["glasses-round"], "pose": "wave"}`.
3. `speak` with `{"sessionId": "<id>", "text": "Welcome to the tour."}` and play the returned audio.
4. Share `viewerUrl` from step 1 or 2.

To check a model: `inspect_glb` with `{"url": "https://example.com/model.glb"}`, then `validate_glb`, then `optimize_glb` with `{"url": "...", "draco": true}` if it is too heavy.

## Not covered here

The same server also registers wallet tools that can sign and send real transactions. Do not call them unless the user explicitly asks. Every spending tool refuses until it is called with `confirm: true`, and its preview tool must be shown to the user first. Never ask the user to paste a secret key into the chat.
