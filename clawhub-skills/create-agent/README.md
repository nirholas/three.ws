# create-agent

Full workflow for building a [three.ws](https://three.ws) AI agent — from naming and persona authoring to brain model selection, voice configuration, skills, and marketplace publishing. No on-chain signing required for any of the data-authoring steps.

| Property      | Value                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| name          | create-agent                                                                                   |
| description   | Create and configure a three.ws AI agent — persona, brain, voice, skills, publish to marketplace |
| allowed-tools | Read, Edit, Write, Bash(npm:*)                                                                 |

## Install

```
openclaw skills install create-agent
```

Or via direct URL:

```
Install the skill https://raw.githubusercontent.com/nirholas/3D-Agent/main/clawhub-skills/create-agent/SKILL.md
```

## Core workflow

```
1. Create record     →  POST /api/agents  { name }
2. Write persona     →  instructions.md  (system prompt)
3. Configure brain   →  provider, model, temperature, thinking
4. Configure voice   →  tts + stt providers
5. Add skills        →  URIs in manifest.json + skills array
6. Publish           →  POST /api/marketplace/agents/:id/publish
7. Embed             →  <agent-3d agent-id="a_abc123">
```

## Quick start

### 1. Create the agent

```js
const res = await fetch('https://three.ws/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ name: 'Coach Leo' }),
});
const { id } = await res.json();  // "a_abc123"
```

### 2. Write instructions.md

```markdown
---
name: Coach Leo
thinking: auto
---

You are Coach Leo, a passionate football coach from Argentina.
Direct and energetic. Short sentences. Never waffle.

## Capabilities
- Analyse movement from uploaded video or images.
- Answer questions about drills, tactics, and conditioning.

## Limits
- Do not give medical advice. Refer injuries to a physiotherapist.
```

### 3. Configure manifest.json

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Coach Leo",
  "description": "Football coach — reviews your form.",
  "body": { "uri": "ipfs://Qm.../leo.glb", "format": "gltf-binary", "rig": "mixamo" },
  "brain": { "provider": "anthropic", "model": "claude-opus-4-6", "instructions": "instructions.md" },
  "voice": { "tts": { "provider": "browser" }, "stt": { "provider": "browser" } },
  "memory": { "mode": "local" }
}
```

### 4. Publish to marketplace

```js
await fetch(`https://three.ws/api/marketplace/agents/${id}/publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    category: 'sports',
    tags: ['coach', 'football', 'training'],
    system_prompt: 'You are Coach Leo...',
    greeting: "Hey! Upload a clip and I'll break down your form.",
  }),
});
```

### 5. Embed

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d agent-id="a_abc123"></agent-3d>
```

## Brain model selection

| Model                       | Speed     | Cost  | Best for                              |
| --------------------------- | --------- | ----- | ------------------------------------- |
| `claude-haiku-4-5-20251001` | Very fast | Low   | Quick Q&A, high-volume, kiosk agents  |
| `claude-sonnet-4-6`         | Fast      | Mid   | General-purpose, most agents          |
| `claude-opus-4-6`           | Moderate  | High  | Complex analysis, coaching, reasoning |

### Extended thinking

```jsonc
"brain": { "provider": "anthropic", "model": "claude-opus-4-6", "thinking": "always" }
```

- `always` — reasoning before every reply; best for analysis, coaching, tutoring
- `auto` — runtime decides; best for mixed-use agents
- `never` — instant replies; best for customer support, greeter agents

### Reactive avatar (no LLM)

```jsonc
"brain": { "provider": "none" }
```

Runs on skills alone. No tokens consumed, no latency. Good for kiosks, demos, and ambient installations.

## Voice configuration

### TTS providers

| Provider     | Quality | Setup required                         |
| ------------ | ------- | -------------------------------------- |
| `browser`    | Medium  | None — free, uses Web Speech API       |
| `elevenlabs` | High    | ElevenLabs voice ID + `key-proxy` URL  |
| `openai`     | High    | OpenAI `key-proxy` URL                 |
| `none`       | —       | TTS disabled, text-only output         |

API keys go in your backend `key-proxy`, never in the manifest:

```html
<agent-3d agent-id="a_abc123" key-proxy="https://your-api.com/tts-proxy"></agent-3d>
```

### STT providers

| Provider  | Quality | Setup required              |
| --------- | ------- | --------------------------- |
| `browser` | Medium  | None — Web Speech API       |
| `whisper` | High    | OpenAI key via `key-proxy`  |
| `none`    | —       | Mic disabled, text-only input |

### Mic modes

Set via the `<agent-3d>` `mic` attribute:

```html
<agent-3d agent-id="a_abc123" mic="push-to-talk"></agent-3d>   <!-- default -->
<agent-3d agent-id="a_abc123" mic="continuous"></agent-3d>
<agent-3d agent-id="a_abc123" mic="off"></agent-3d>
```

## Default skills

Every new agent starts with:

| Skill           | What it does                                              |
| --------------- | --------------------------------------------------------- |
| `greet`         | Waves and says hello when a user opens the agent          |
| `present-model` | Rotates and introduces an uploaded 3D model               |
| `validate-model`| Runs the glTF validator, reports issues                   |
| `remember`      | Stores a fact to persistent memory                        |
| `think`         | Extended-thinking mode for a complex reasoning task       |

Update skills via API:

```js
await fetch(`https://three.ws/api/agents/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    skills: ['greet', 'present-model', 'validate-model', 'remember', 'think'],
  }),
});
```

## Persona authoring tips

**instructions.md structure that works:**

```markdown
You are [name], [one-line role and distinctive trait].

## Personality
- [Tone and style — 3–5 bullets]

## Capabilities
- [What the agent can actively do — be specific]

## Limits
- [Hard constraints — what the agent must never do]
```

**What to avoid:**
- Vague personality descriptions ("friendly and helpful")
- Missing capabilities section — the LLM won't know what to offer
- Instructions longer than 1 000 tokens — slows every response

## API reference

### `POST /api/agents`
```json
{ "name": "string" }
```
Returns `{ "id": "a_abc123" }`.

### `PUT /api/agents/:id`
```json
{
  "name": "string",
  "description": "string",
  "avatar_id": "string | null",
  "skills": ["string"],
  "meta": {}
}
```

### `POST /api/marketplace/agents/:id/publish`
```json
{
  "category": "string",
  "tags": ["string"],
  "system_prompt": "string",
  "greeting": "string",
  "changelog": "string | null"
}
```

## Templates

### Greeter kiosk (no LLM)
```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Lobby Bot",
  "body": { "uri": "./bot.glb", "format": "gltf-binary", "rig": "mixamo" },
  "brain": { "provider": "none" },
  "voice": { "tts": { "provider": "none" }, "stt": { "provider": "none" } },
  "skills": [{ "uri": "skills/idle-loop/" }, { "uri": "skills/wave/" }]
}
```

### High-quality voice agent
```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Aria",
  "body": { "uri": "ipfs://Qm.../aria.glb", "format": "gltf-binary" },
  "brain": { "provider": "anthropic", "model": "claude-sonnet-4-6", "instructions": "instructions.md" },
  "voice": {
    "tts": { "provider": "elevenlabs", "voiceId": "aria-voice-id" },
    "stt": { "provider": "browser", "continuous": false }
  },
  "memory": { "mode": "local" }
}
```

## Source

Agent identity: [`src/agent-identity.js`](https://github.com/nirholas/3D-Agent/blob/main/src/agent-identity.js)

Edit form: [`src/agent-edit.js`](https://github.com/nirholas/3D-Agent/blob/main/src/agent-edit.js)
