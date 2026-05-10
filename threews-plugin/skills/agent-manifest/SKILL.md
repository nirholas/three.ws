---
name: agent-manifest
description: >
  Build an agent manifest bundle for a three.ws agent. Covers the manifest.json
  schema, bundle layout, body GLB requirements, brain/voice/skills/memory
  configuration, and how to produce a valid IPFS-pinnable package.
metadata:
  author: three.ws
  version: "1.0"
---

# Agent Manifest

An agent manifest is a content-addressed JSON + files bundle that fully describes an embodied AI agent. Pin it to IPFS, stamp the CID into the ERC-8004 registry, and any `<agent-3d>` anywhere on the web can mount the agent.

## Bundle layout

```
my-agent/
├── manifest.json           # required — the index
├── instructions.md         # persona and system prompt
├── body.glb                # 3D embodiment (GLB/glTF/VRM)
├── poster.webp             # loading-state preview image (optional)
├── skills/                 # installed skill bundles
│   ├── wave/
│   │   └── SKILL.md
│   └── explain-gltf/
│       └── SKILL.md
└── memory/                 # persistent memory files
    ├── MEMORY.md
    └── user_role.md
```

Everything is optional except `manifest.json` and a body reference (either inline in the manifest or as `body.glb`).

## manifest.json schema

```jsonc
{
  "$schema": "https://three.ws/schemas/manifest/0.2.json",
  "spec": "agent-manifest/0.2",

  // Identity — filled in after onchain registration
  "id": {
    "chain": "base",
    "agentId": "42",
    "owner": "0xYourWalletAddress"
  },

  // Display
  "name": "Coach Leo",
  "description": "A football coach who reviews your form.",
  "image": "ipfs://Qm.../poster.webp",
  "tags": ["coach", "sports"],

  // Body — the 3D embodiment
  "body": {
    "uri": "ipfs://Qm.../body.glb",
    "format": "gltf-binary",
    "rig": "mixamo",
    "boundingBoxHeight": 1.78
  },

  // Brain — LLM runtime
  "brain": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "instructions": "instructions.md",
    "temperature": 0.7,
    "maxTokens": 4096,
    "thinking": "auto"
  },

  // Voice
  "voice": {
    "tts": {
      "provider": "browser",
      "voiceId": "default",
      "rate": 1.0
    },
    "stt": {
      "provider": "browser",
      "language": "en-US",
      "continuous": false
    }
  },

  // Skills — composable capability bundles
  "skills": [
    { "uri": "skills/wave/", "version": "0.1.0" },
    { "uri": "https://skills.three.ws/explain-gltf@0.3.0" }
  ],

  // Memory
  "memory": {
    "mode": "local",
    "index": "memory/MEMORY.md",
    "maxTokens": 8192
  }
}
```

## Field reference

### `body`

| Field | Type | Notes |
|-------|------|-------|
| `uri` | URI | IPFS, HTTPS, or relative path to GLB/glTF/VRM |
| `format` | string | `gltf-binary` (GLB), `gltf`, or `vrm` |
| `rig` | string | `mixamo` (default), `vrm`, or `custom` — drives animation retargeting |
| `boundingBoxHeight` | number | Agent height in meters; used for scale normalization. Omit to auto-detect. |

GLB requirements:
- Must include at least one skinned mesh with a skeleton
- Mixamo rig: standard Mixamo bone naming convention
- VRM: VRM 0.x or 1.0
- Max recommended file size: 20 MB for web embeds

### `brain`

| Field | Type | Notes |
|-------|------|-------|
| `provider` | string | `anthropic`, `openai`, `local`, `none` |
| `model` | string | `claude-opus-4-6`, `claude-sonnet-4-6`, `gpt-4o`, etc. |
| `instructions` | string | Path to `.md` file relative to bundle root, or inline text |
| `temperature` | number | 0.0–1.0 |
| `maxTokens` | number | Max completion tokens |
| `thinking` | string | `auto`, `always`, `never` |

### `voice`

| Field | Options | Notes |
|-------|---------|-------|
| `tts.provider` | `browser`, `elevenlabs`, `openai`, `none` | Browser TTS is zero-cost |
| `tts.voiceId` | string | Provider-specific voice ID |
| `stt.provider` | `browser`, `whisper`, `none` | — |
| `stt.language` | BCP-47 string | e.g. `en-US`, `es-ES` |
| `stt.continuous` | boolean | Always-on mic vs push-to-talk |

### `memory`

| Field | Options | Notes |
|-------|---------|-------|
| `mode` | `local`, `ipfs`, `encrypted-ipfs`, `none` | `local` stores in browser localStorage |
| `index` | path | Relative path to `MEMORY.md` within the bundle |
| `maxTokens` | number | Token budget for memory context injection |

### `skills`

Each entry is an object with a `uri` pointing to a skill bundle — a directory containing a `SKILL.md`. Versions are semver strings.

```json
{ "uri": "skills/wave/", "version": "0.1.0" }
{ "uri": "ipfs://Qm.../dance/", "version": "1.2.0" }
{ "uri": "https://skills.three.ws/explain-gltf@0.3.0" }
```

## instructions.md

Write the system prompt here — persona, tone, capabilities, constraints. It's loaded verbatim as the LLM system prompt.

```markdown
You are Coach Leo, an enthusiastic football coach. You speak directly and with energy.
You help users improve their technique by reviewing their form from the 3D model on screen.
Always be encouraging. Never mention specific team allegiances.
```

## Complete minimal example

```jsonc
{
  "spec": "agent-manifest/0.2",
  "name": "Coach Leo",
  "description": "Football coach",
  "body": {
    "uri": "./body.glb",
    "format": "gltf-binary",
    "rig": "mixamo"
  },
  "brain": {
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "instructions": "instructions.md"
  }
}
```

## Validating a GLB before bundling

Run the official glTF validator before pinning:

```bash
npm install -g gltf-validator
gltf-validator body.glb
```

Or use the online validator at `validator.khronos.org`. The `<agent-3d>` element also runs validation at load time via the `validate-model` skill.

## Pinning to IPFS

```bash
# Local IPFS node
ipfs add -r ./my-agent/
# → outputs CID, e.g. QmXyz...

# web3.storage
w3 up ./my-agent/

# Pinata
curl -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "Authorization: Bearer <PINATA_JWT>" \
  -F "file=@manifest.json"
```

The `agentURI` to pass to the registry contract is:

```
ipfs://<CID>/manifest.json
```

## After pinning

1. Pass `agentURI` to the ERC-8004 `register()` call (see `onchain-agent` skill)
2. Fill in the `id` block in `manifest.json` with the assigned `agentId` and re-pin
3. Update the registry URI with `setAgentURI(agentId, newCID)` to point to the updated manifest
