---
name: create-agent
description: Create, configure, and publish a three.ws AI agent — name, persona, brain model, voice, skills, and marketplace listing. No signing required.
allowed-tools: Read, Edit, Write, Bash(npm:*)
---

# create-agent

Full workflow for creating a three.ws agent from scratch — from naming and persona to brain configuration, voice, skills, and publishing to the marketplace. Covers both the API and the `manifest.json` bundle approach. No on-chain signing or credentials required for the data-authoring steps.

## Agent data model

```typescript
{
  id: string,              // UUID, auto-generated on creation
  name: string,            // display name (required)
  description: string,     // one-line summary (optional)
  avatarId: string | null, // R2 UUID of uploaded GLB (optional)
  homeUrl: string | null,  // public URL, defaults to /agent/:id
  skills: string[],        // enabled skill names
  meta: object,            // extensible metadata
  createdAt: number,       // Unix timestamp
  isRegistered: boolean,   // false until on-chain registration
}
```

## Step 1 — Create the agent record

```js
// POST /api/agents
const res = await fetch('https://three.ws/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({ name: 'Coach Leo' }),
});
const { id } = await res.json();
```

Returns `{ id: "a_abc123" }`. The `id` is used for all subsequent API calls.

## Step 2 — Write the persona (instructions.md)

Create `instructions.md` in your agent folder. This becomes the LLM system prompt:

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
- Suggest drills and exercises tailored to what you observe.

## Style
- Use first names when you know them.
- Celebrate progress. Be honest about mistakes.
- Football metaphors come naturally to you.

## Limits
- Do not give medical advice. Refer injuries to a physiotherapist.
- Do not discuss other sports beyond brief comparisons.
```

## Step 3 — Configure the manifest

Create `manifest.json` in the same folder:

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Coach Leo",
  "description": "Football coach — reviews your form.",
  "body": {
    "uri": "ipfs://Qm.../leo.glb",
    "format": "gltf-binary",
    "rig": "mixamo",
    "boundingBoxHeight": 1.82
  },
  "brain": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "instructions": "instructions.md",
    "temperature": 0.75,
    "thinking": "auto"
  },
  "voice": {
    "tts": { "provider": "browser" },
    "stt": { "provider": "browser", "language": "en-US" }
  },
  "skills": [
    { "uri": "skills/wave/" }
  ],
  "memory": { "mode": "local" },
  "tools": ["wave", "lookAt", "speak"]
}
```

## Step 4 — Update persona fields

```js
// PUT /api/agents/:id
await fetch(`https://three.ws/api/agents/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    name: 'Coach Leo',
    description: 'Football coach — reviews your form.',
    skills: ['greet', 'present-model', 'validate-model', 'remember'],
    meta: { category: 'sports', tags: ['coach', 'football'] },
  }),
});
```

## Step 5 — Publish to marketplace

```js
// POST /api/marketplace/agents/:id/publish
await fetch(`https://three.ws/api/marketplace/agents/${id}/publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    category: 'sports',
    tags: ['coach', 'football', 'training'],      // max 12
    system_prompt: 'You are Coach Leo...',         // full instructions
    greeting: "Hey! Upload a clip and I'll break down your form.",
    changelog: 'Initial release.',
  }),
});
```

## Brain configuration

### Choosing a model

| Model                       | Speed     | Cost  | Best for                            |
| --------------------------- | --------- | ----- | ----------------------------------- |
| `claude-haiku-4-5-20251001` | Very fast | Low   | Quick Q&A, high-volume agents       |
| `claude-sonnet-4-6`         | Fast      | Mid   | Balanced agents, most use cases     |
| `claude-opus-4-6`           | Moderate  | High  | Complex reasoning, analysis agents  |

### Extended thinking

Set `thinking: "always"` for agents that need to reason step-by-step before responding (analysis, coaching, tutoring). Set `thinking: "never"` for agents that should respond instantly (customer support, simple assistants). `"auto"` lets the runtime decide.

### Reactive-only (no LLM)

```jsonc
"brain": { "provider": "none" }
```

Drives the avatar entirely through skills — no LLM tokens consumed. Useful for kiosks, demos, and skill-only deployments.

## Voice configuration

### TTS providers

| Provider     | Quality | Setup              |
| ------------ | ------- | ------------------ |
| `browser`    | Medium  | None — free        |
| `elevenlabs` | High    | ElevenLabs API key |
| `openai`     | High    | OpenAI API key     |
| `none`       | —       | TTS disabled       |

For `elevenlabs` and `openai`, pass your key via the `key-proxy` attribute on the `<agent-3d>` embed — never hardcoded in the manifest.

### STT providers

| Provider  | Quality | Setup                  |
| --------- | ------- | ---------------------- |
| `browser` | Medium  | None — free            |
| `whisper` | High    | OpenAI key via proxy   |
| `none`    | —       | Mic input disabled     |

## Default skills

When a new agent is created, these skills are enabled by default:

| Skill name      | What it does                                          |
| --------------- | ----------------------------------------------------- |
| `greet`         | Waves and says hello when a user opens the agent      |
| `present-model` | Rotates and introduces an uploaded 3D model           |
| `validate-model`| Runs the glTF validator and reports issues            |
| `remember`      | Stores a fact to the agent's persistent memory        |
| `think`         | Enters extended-thinking mode for a reasoning task    |

Add more skills by URI:

```js
await fetch(`https://three.ws/api/agents/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    skills: ['greet', 'present-model', 'validate-model', 'remember', 'think', 'pump-fun-reactive'],
  }),
});
```

## Embedding the finished agent

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>

<!-- By agent ID -->
<agent-3d agent-id="a_abc123"></agent-3d>

<!-- Or by on-chain token after registration -->
<agent-3d src="agent://base/42"></agent-3d>
```

## Common patterns

### Minimal local agent (for development)

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Dev Agent",
  "body": { "uri": "./dev.glb", "format": "gltf-binary" },
  "brain": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "instructions": "instructions.md"
  },
  "memory": { "mode": "local" }
}
```

Load it in the viewer by pointing `body` at a local GLB and opening the embed with `brain.provider` set to your provider of choice.

### High-quality voice agent

```jsonc
{
  "brain": { "provider": "anthropic", "model": "claude-opus-4-6" },
  "voice": {
    "tts": { "provider": "elevenlabs", "voiceId": "your-voice-id", "rate": 1.0 },
    "stt": { "provider": "whisper" }
  }
}
```

### Silent kiosk avatar

```jsonc
{
  "brain": { "provider": "none" },
  "voice": { "tts": { "provider": "none" }, "stt": { "provider": "none" } },
  "skills": [{ "uri": "skills/idle-loop/" }]
}
```
