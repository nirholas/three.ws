# agent-manifest

Author complete [three.ws](https://three.ws) agent bundles from scratch. Full reference for `manifest.json` — every field, every option — plus `instructions.md` persona authoring, bundle layout, and ready-to-copy minimal and full-featured templates.

| Property      | Value                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| name          | agent-manifest                                                                                  |
| description   | Complete three.ws agent manifest reference — schema, bundle layout, instructions.md authoring   |
| allowed-tools | Read, Edit, Write                                                                               |

## Install

```
openclaw skills install agent-manifest
```

Or via direct URL:

```
Install the skill https://raw.githubusercontent.com/nirholas/3D-Agent/main/clawhub-skills/agent-manifest/SKILL.md
```

## What this skill covers

- Full `manifest.json` schema (spec `agent-manifest/0.2`) with every field annotated
- `instructions.md` persona authoring — structure, frontmatter overrides, best practices
- Bundle directory layout (GLB, skills, memory, attestations)
- Configuration for body, brain, voice, skills, and memory
- Minimal, reactive-only, and full-featured manifest templates

## Bundle layout

```
agent/
├── manifest.json          ← index; references everything else
├── instructions.md        ← LLM persona / system prompt
├── body.glb               ← 3D character model
├── poster.webp            ← loading thumbnail (optional)
├── skills/                ← installed skill bundles
│   └── wave/
├── memory/
│   └── MEMORY.md
└── attestations/
    └── gltf-validator.json
```

## Manifest quick-reference

### Identity

```jsonc
"id": {
  "chain": "base",            // "base" | "base-sepolia" | "ethereum" | "local"
  "registry": "0x...",        // ERC-8004 Identity Registry
  "agentId": "1234",          // token ID from registry
  "owner": "0x..."
}
```

The `id` block is populated after on-chain registration. Omit it when authoring a new manifest.

### Body

```jsonc
"body": {
  "uri": "ipfs://Qm.../body.glb",   // REQUIRED
  "format": "gltf-binary",           // "gltf-binary" | "gltf" | "vrm"
  "rig": "mixamo",                   // animation retargeting: "mixamo" | "vrm" | "custom"
  "boundingBoxHeight": 1.78          // metres, normalises scale
}
```

### Brain

```jsonc
"brain": {
  "provider": "anthropic",           // "anthropic" | "openai" | "local" | "none"
  "model": "claude-opus-4-6",
  "instructions": "instructions.md", // relative path to persona file
  "temperature": 0.7,
  "maxTokens": 4096,
  "thinking": "auto"                 // "auto" | "always" | "never"
}
```

Set `provider: "none"` for purely reactive avatars driven by skills only — no LLM token cost.

### Voice

```jsonc
"voice": {
  "tts": { "provider": "browser" | "elevenlabs" | "openai" | "none", "voiceId": "...", "rate": 1.0 },
  "stt": { "provider": "browser" | "whisper" | "none", "language": "en-US", "continuous": false }
}
```

### Skills

```jsonc
"skills": [
  { "uri": "skills/wave/",                          "version": "0.1.0" },  // relative
  { "uri": "ipfs://Qm.../dance/",                   "version": "1.2.0" },  // IPFS
  { "uri": "https://skills.three.ws/explain-gltf@0.3.0" }                  // HTTPS
]
```

### Memory

```jsonc
"memory": {
  "mode": "local",                // "local" | "ipfs" | "encrypted-ipfs" | "none"
  "index": "memory/MEMORY.md",
  "maxTokens": 8192
}
```

### Built-in tools (no skill install needed)

`wave` · `lookAt` · `pointAt` · `play_clip` · `setExpression` · `moveTo` · `speak`

## instructions.md

The persona file is injected into the LLM's system prompt. Use optional YAML frontmatter to override manifest fields per-agent:

```markdown
---
name: Coach Leo
thinking: always
---

You are Coach Leo, a passionate football coach from Argentina.
Direct and energetic. Short sentences. Never waffle.

## Capabilities
- Analyse movement from uploaded video or images.
- Answer questions about drills, tactics, and conditioning.

## Limits
- Do not give medical advice. Refer injuries to a physiotherapist.
```

**Writing tips:**
- Open with an identity sentence: "You are [name], [role]."
- 3–5 bullet points for tone and style.
- Explicit `## Capabilities` so the LLM knows what to offer.
- Hard `## Limits` for anything the agent must never do.
- Keep under 1 000 tokens.

## Templates

### Minimal — reactive avatar (no LLM)

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Market Bot",
  "body": { "uri": "./bot.glb", "format": "gltf-binary", "rig": "mixamo" },
  "brain": { "provider": "none" },
  "skills": [{ "uri": "skills/pump-fun-reactive/" }]
}
```

### Minimal — chat agent

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Helper",
  "body": { "uri": "./helper.glb", "format": "gltf-binary" },
  "brain": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "instructions": "instructions.md"
  },
  "voice": {
    "tts": { "provider": "browser" },
    "stt": { "provider": "browser", "language": "en-US" }
  },
  "memory": { "mode": "local" }
}
```

### Full-featured agent

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Coach Leo",
  "description": "Football coach — reviews your form.",
  "image": "ipfs://Qm.../poster.webp",
  "tags": ["coach", "sports"],
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
    "tts": { "provider": "elevenlabs", "voiceId": "leo-voice-id", "rate": 1.05 },
    "stt": { "provider": "browser", "continuous": false }
  },
  "skills": [
    { "uri": "skills/wave/" },
    { "uri": "ipfs://Qm.../analyse-video@0.2.0" }
  ],
  "memory": { "mode": "local", "index": "memory/MEMORY.md", "maxTokens": 8192 },
  "tools": ["wave", "lookAt", "speak", "play_clip"],
  "version": "0.1.0"
}
```

## Source

Full spec: [`specs/AGENT_MANIFEST.md`](https://github.com/nirholas/3D-Agent/blob/main/specs/AGENT_MANIFEST.md)
