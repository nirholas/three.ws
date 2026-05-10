---
name: agent-manifest
description: Author complete three.ws agent manifest bundles — manifest.json schema, instructions.md persona authoring, body/brain/voice/skills/memory configuration, and bundle layout.
allowed-tools: Read, Edit, Write
---

# agent-manifest

A three.ws agent bundle is a folder (or IPFS directory) containing a `manifest.json` index plus a set of supporting files. This skill covers every field, the bundle layout, and how to write the `instructions.md` that shapes the agent's persona.

## Bundle layout

```
agent/
├── manifest.json          # required — the index
├── instructions.md        # required for LLM agents — persona + system prompt
├── body.glb               # 3D embodiment (or reference via manifest.body.uri)
├── poster.webp            # loading thumbnail (optional)
├── skills/                # installed skill bundles
│   ├── wave/
│   └── explain-gltf/
├── memory/
│   └── MEMORY.md          # persistent agent memory
└── attestations/
    └── gltf-validator.json
```

## manifest.json — complete schema

```jsonc
{
  "$schema": "https://3d-agent.io/schemas/manifest/0.2.json",
  "spec": "agent-manifest/0.2",

  // ── Identity (filled after on-chain registration) ──────────────────────
  "id": {
    "chain": "base",                     // "base" | "base-sepolia" | "ethereum" | "local"
    "registry": "0x...",                 // ERC-8004 Identity Registry address
    "agentId": "1234",                   // token ID assigned by registry
    "owner": "0x..."                     // controlling address
  },

  // ── Display ────────────────────────────────────────────────────────────
  "name": "Coach Leo",
  "description": "A football coach who reviews your form.",
  "image": "ipfs://Qm.../poster.webp",  // thumbnail shown before load
  "tags": ["coach", "sports"],

  // ── Body (3D embodiment) ───────────────────────────────────────────────
  "body": {
    "uri": "ipfs://Qm.../body.glb",     // REQUIRED — GLB or VRM
    "format": "gltf-binary",             // "gltf-binary" | "gltf" | "vrm"
    "rig": "mixamo",                     // "mixamo" | "vrm" | "custom" — animation retargeting
    "boundingBoxHeight": 1.78            // meters — normalises scale across models
  },

  // ── Brain (LLM runtime) ────────────────────────────────────────────────
  "brain": {
    "provider": "anthropic",            // "anthropic" | "openai" | "local" | "none"
    "model": "claude-opus-4-6",
    "instructions": "instructions.md",  // relative path to persona file
    "temperature": 0.7,
    "maxTokens": 4096,
    "thinking": "auto"                  // "auto" | "always" | "never"
  },

  // ── Voice ──────────────────────────────────────────────────────────────
  "voice": {
    "tts": {
      "provider": "browser",            // "browser" | "elevenlabs" | "openai" | "none"
      "voiceId": "default",
      "rate": 1.0,
      "pitch": 1.0
    },
    "stt": {
      "provider": "browser",            // "browser" | "whisper" | "none"
      "language": "en-US",
      "continuous": false
    }
  },

  // ── Skills ─────────────────────────────────────────────────────────────
  "skills": [
    { "uri": "skills/wave/",            "version": "0.1.0" },   // relative
    { "uri": "ipfs://Qm.../dance/",     "version": "1.2.0" },   // IPFS
    { "uri": "https://skills.three.ws/explain-gltf@0.3.0" }     // HTTPS
  ],

  // ── Memory ─────────────────────────────────────────────────────────────
  "memory": {
    "mode": "local",                    // "local" | "ipfs" | "encrypted-ipfs" | "none"
    "index": "memory/MEMORY.md",
    "maxTokens": 8192
  },

  // ── Built-in scene tools (no skill install needed) ─────────────────────
  "tools": ["wave", "lookAt", "pointAt", "play_clip", "setExpression", "moveTo", "speak"],

  // ── Lifecycle ──────────────────────────────────────────────────────────
  "version": "0.1.0",
  "created": "2026-05-10T12:00:00Z",
  "updated": "2026-05-10T12:00:00Z"
}
```

## Field reference

### `body`

| Field               | Required | Notes                                                    |
| ------------------- | -------- | -------------------------------------------------------- |
| `uri`               | yes      | IPFS, HTTPS, or relative path to `.glb` / `.vrm`        |
| `format`            | yes      | `gltf-binary` for `.glb`, `gltf` for `.gltf`, `vrm` for VRM |
| `rig`               | no       | Chooses animation retargeting mode. Default: `custom`    |
| `boundingBoxHeight` | no       | Normalises scale — set to character's height in metres   |

### `brain`

| Field          | Required | Notes                                                        |
| -------------- | -------- | ------------------------------------------------------------ |
| `provider`     | yes      | `none` is valid for purely reactive/skill-driven avatars     |
| `model`        | no       | Required when `provider` is `anthropic` or `openai`         |
| `instructions` | no       | Relative path to `.md` persona file. Inline strings accepted |
| `temperature`  | no       | 0.0–1.0. Default: 0.7                                       |
| `maxTokens`    | no       | Max tokens per LLM call. Default: 4096                      |
| `thinking`     | no       | `auto` lets the runtime decide when to use extended thinking |

### `voice`

`tts.provider`:
- `browser` — free, uses Web Speech API, quality varies by OS
- `elevenlabs` — high quality, requires ElevenLabs API key via `key-proxy`
- `openai` — high quality, requires OpenAI API key via `key-proxy`
- `none` — TTS disabled

`stt.provider`:
- `browser` — free, uses Web Speech API
- `whisper` — higher accuracy, requires `key-proxy`
- `none` — microphone input disabled

### `memory.mode`

| Mode             | Persistence       | Notes                                       |
| ---------------- | ----------------- | ------------------------------------------- |
| `local`          | localStorage      | Fast, single-device, cleared on browser wipe |
| `ipfs`           | IPFS pin          | Survives device changes, slow write          |
| `encrypted-ipfs` | IPFS + encryption | Owner-readable only, requires owner pubkey   |
| `none`           | None              | Stateless agent                              |

### Built-in `tools`

These are available without installing any skill:

| Tool name      | What it does                                   |
| -------------- | ---------------------------------------------- |
| `wave`         | Play wave animation                            |
| `lookAt`       | Direct head/eyes toward a target               |
| `pointAt`      | Point arm at a target                          |
| `play_clip`    | Play any named animation clip by name          |
| `setExpression`| Apply a morph-target expression preset         |
| `moveTo`       | Walk/slide character to a world position       |
| `speak`        | Speak text aloud via TTS                       |

## instructions.md authoring

The persona file is injected verbatim into the LLM's system prompt. It accepts optional YAML frontmatter that can override manifest fields:

```markdown
---
name: Coach Leo
voice: cheerful
thinking: always
---

You are Coach Leo, a passionate football coach from Argentina.
You review uploaded training clips, give direct technical feedback, and
celebrate improvements enthusiastically.

## Personality
- Direct and energetic. Short sentences. Never waffle.
- Use football metaphors naturally.
- Reference player names when you know them.

## Capabilities
- Analyse movement from uploaded video or images.
- Answer questions about drills, tactics, and conditioning.
- Suggest specific exercises based on what you observe.

## Limits
- Do not give medical advice. Refer injuries to a physio.
- Do not discuss other sports beyond brief comparisons.
```

### Tips for strong instructions.md

- Open with an identity statement: "You are [name], [one-line role]."
- Define personality in 3–5 bullet points — tone, style, word choice.
- List explicit capabilities so the LLM knows what to offer.
- Add a "Limits" section for hard boundaries.
- Keep it under 1 000 tokens for fast context injection.
- For multi-language agents, specify the default language and switching rules.

## Common patterns

### Reactive avatar (no LLM)

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Market Bot",
  "body": { "uri": "./bot.glb", "format": "gltf-binary", "rig": "mixamo" },
  "brain": { "provider": "none" },
  "skills": [{ "uri": "ipfs://bafy.../pump-fun-reactive/" }]
}
```

### Minimal chat agent

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
