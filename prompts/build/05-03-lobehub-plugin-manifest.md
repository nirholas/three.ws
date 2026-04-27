# 05-03 — Lobehub plugin manifest + install URL

**Pillar 5 — Host embed.**

## Why it matters

User has a Lobehub fork and it's the _primary_ integration target per the priority stack. Lobehub plugins are installed via a plugin manifest (JSON) that registers tools + UI surfaces. Our avatar needs to show up in Lobehub as an installable plugin so any Lobehub user can add their three.ws to their chat.

## What to build

A public endpoint `GET /api/agents/:id/lobe-plugin.json` that returns a **Lobehub plugin manifest** pointing at our agent's runtime. The user (or a Lobehub admin) pastes the URL into Lobehub's plugin installer — it pulls the manifest, registers the plugin, and mounts our agent UI inside Lobehub chat.

## Read these first

| File                                                                                                             | Why                                                                          |
| :--------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| [api/agents.js](../../api/agents.js)                                                                             | Public fields of an agent.                                                   |
| `api/agents/[id]/artifact.js` (from 05-01)                                                                       | Artifact URL — the Lobehub plugin uses this (or a Lobehub-specific variant). |
| Lobehub plugin docs (for your reference; user has the fork — don't assume an API that doesn't exist in the fork) | Manifest schema.                                                             |

## Build this

### 1. Manifest generator

`GET /api/agents/:id/lobe-plugin.json`:

- Look up agent (public fields only).
- Return JSON:

```json
{
	"$schema": "https://chat-plugins.lobehub.com/schema/plugin.json",
	"identifier": "3d-agent-<agentId>",
	"api": [
		{
			"url": "https://three.ws/api/agents/<agentId>/lobe/tool/<name>",
			"name": "emote",
			"description": "Have the agent express an emotion: celebrate, concern, curiosity, empathy, patience, neutral.",
			"parameters": {
				"type": "object",
				"properties": { "emotion": { "type": "string" }, "weight": { "type": "number" } },
				"required": ["emotion"]
			}
		},
		{
			"url": "https://three.ws/api/agents/<agentId>/lobe/tool/gesture",
			"name": "gesture",
			"description": "Trigger a one-shot gesture.",
			"parameters": {
				"type": "object",
				"properties": { "name": { "type": "string" } },
				"required": ["name"]
			}
		}
	],
	"ui": {
		"url": "https://three.ws/api/agents/<agentId>/lobe-ui.html",
		"height": 420
	},
	"meta": {
		"avatar": "<agent.avatar_thumbnail_url or favicon>",
		"title": "<agent.name>",
		"description": "<agent.description>",
		"tags": ["3d", "avatar", "embodied"]
	}
}
```

(Adjust field names to match the actual Lobehub schema the user has forked. If the fork diverges, follow what the fork expects — grep the Lobehub fork locally; do not invent.)

### 2. UI iframe endpoint

`GET /api/agents/:id/lobe-ui.html` — a Lobehub-optimized variant of the artifact. It's the artifact HTML from 05-01 with:

- Lobehub-friendly CSS (full width, 420px height default).
- postMessage origin allowlist includes Lobehub-fork hostnames.
- Chat log hook: listens for `{ type: 'lobe:message', payload: { role, content } }` and when `role === 'assistant'`, emits `speak` + derived emotion.

### 3. Tool endpoints

Each tool in the manifest maps to `POST /api/agents/:id/lobe/tool/:name`:

| Tool      | Effect                                                                         |
| :-------- | :----------------------------------------------------------------------------- |
| `emote`   | Emits an emote event to the agent's runtime bus (via the UI iframe's channel). |
| `gesture` | Same.                                                                          |
| `speak`   | Feeds an override line to the agent's TTS (if enabled).                        |

These endpoints do NOT call our server mutating APIs — they post to a broadcast channel the UI iframe listens to. Effectively a thin proxy to `postMessage` since Lobehub's plugin runtime is disconnected from our iframe.

Simplest implementation: the tool endpoint returns `{ ok: true, forward: { __agent, type, payload } }`. The Lobehub plugin runtime receives this and posts into the UI iframe.

### 4. Install button on agent page

Share panel (`04-06`) `lobehub-plugin` target outputs the manifest URL:

```
https://three.ws/api/agents/<id>/lobe-plugin.json
```

Plus the install instructions ("Paste this URL in Lobehub → Settings → Plugins → Add custom plugin").

## Out of scope

- Do not fork Lobehub (user already has the fork).
- Do not package this as an npm module.
- Do not add Lobehub-specific auth (the plugin manifest is public).
- Do not build a listing page for "available agents in Lobehub" — that's a future concern.

## Deliverables

**New:**

- `api/agents/[id]/lobe-plugin.js` — manifest endpoint.
- `api/agents/[id]/lobe-ui.js` — UI iframe variant.
- `api/agents/[id]/lobe/tool/[name].js` — tool proxy endpoints.

**Modified:**

- `src/components/snippet-picker.jsx` (from 04-06) — `lobehub-plugin` target returns the manifest URL + install instructions.
- `vercel.json` — routes.

## Acceptance

- [ ] `curl https://three.ws/api/agents/<id>/lobe-plugin.json` returns valid JSON.
- [ ] Pasting that URL in Lobehub's plugin installer (user's fork) registers the plugin.
- [ ] After a message in Lobehub chat, the UI iframe updates — agent reacts to the assistant's reply.
- [ ] Tool invocation from Lobehub chat (`/emote celebrate`) reaches the agent and animates.
- [ ] Private avatars return 404 on the plugin manifest endpoint.
- [ ] `npm run build` passes.

## Test plan

1. Run the Lobehub fork locally.
2. Fetch the plugin manifest URL in a browser → valid JSON shape.
3. In Lobehub plugins settings, paste the URL → plugin appears in installed list.
4. Enable plugin for a chat → UI panel appears showing the agent.
5. Type a message → assistant responds → agent in panel reacts to the reply's tone.
6. Invoke `emote` tool from the chat → avatar emits.
