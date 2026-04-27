---
mode: agent
description: "Lobehub plugin manifest + renderer so agents embody in the user's LobeHub fork"
---

# Stack Layer 5: LobeHub Plugin Integration

## Problem

User maintains a LobeHub fork. Per priority stack, an agent from three.ws must appear as an embodied 3D presence inside LobeHub chats — not a JSON blob. LobeHub plugins are the right extension point.

## Implementation

### Plugin manifest

Host at `https://three.ws/.well-known/lobehub-plugin.json`:

```json
{
	"identifier": "3d-agent",
	"version": "1.0.0",
	"meta": {
		"title": "three.ws",
		"description": "Embodied three.wss — identity, memory, skills, emotional presence",
		"avatar": "https://three.ws/icon.png",
		"tags": ["3d", "agent", "avatar"]
	},
	"api": [
		{
			"name": "renderAgent",
			"description": "Render an embodied agent by slug or agent card URL",
			"url": "https://three.ws/api/lobehub/render-agent",
			"parameters": {
				"type": "object",
				"properties": { "slug": { "type": "string" } },
				"required": ["slug"]
			}
		},
		{
			"name": "summonAgent",
			"description": "Ask the three.ws to perform a skill and return the result + rendering",
			"url": "https://three.ws/api/lobehub/summon-agent",
			"parameters": {
				"type": "object",
				"properties": {
					"slug": { "type": "string" },
					"skill": { "type": "string" },
					"input": { "type": "string" }
				},
				"required": ["slug", "skill"]
			}
		}
	],
	"ui": [
		{
			"name": "agent-embed",
			"url": "https://three.ws/lobehub/embed.html"
		}
	]
}
```

### Plugin endpoints

`POST /api/lobehub/render-agent` — returns a payload the plugin chrome renders:

```json
{
	"type": "embed",
	"url": "https://three.ws/agent/satoshi?kiosk=1&theme=auto",
	"width": 480,
	"height": 480,
	"fallbackText": "three.ws: Satoshi — open in browser to interact"
}
```

`POST /api/lobehub/summon-agent` — triggers a skill server-side (or via headless agent) and returns both text + an embed URL that shows the animated response.

### UI plugin

`/lobehub/embed.html` — near-identical to `?kiosk=1` but:

- Reads the LobeHub plugin context (agent spec, theme from host).
- Posts lifecycle events via `postMessage` to the LobeHub parent.
- Respects LobeHub's theme tokens (read from `postMessage` at mount).

### Install flow

Document in repo: how the user installs the plugin in their fork. Either:

- Official LobeHub plugin marketplace submission (later), OR
- Direct manifest URL install (immediate).

### Auth

Plugin does NOT require auth to render public avatars. If the LobeHub user wants their _own_ agents listed, they pass a three.ws API key (see [api/keys/](api/keys/)) in a settings field.

## Validation

- User installs the plugin in their LobeHub fork via manifest URL.
- Types "summon satoshi" or calls the tool → agent renders embedded in the chat.
- Emotion/animation responds to the conversation context (basic v1: just renders).
- Mobile LobeHub: embed resizes and touch works.
- `npm run build` passes.

## Do not do this

- Do NOT fork LobeHub code — integrate only via the plugin API.
- Do NOT require a three.ws login to view public agents.
