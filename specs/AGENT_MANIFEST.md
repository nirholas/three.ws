# Agent Manifest Spec v0.1

> **Placeholder tag**: `<agent-3d>`. Rename when you pick the final name — the spec itself is tag-agnostic.

An **agent manifest** is a content-addressed JSON+files bundle that fully describes an embodied AI agent. Pin the bundle to IPFS → get a CID → stamp the CID into the ERC-8004 Identity Registry → any `<agent-3d>` anywhere on the web can mount the agent with `src="agent://..."`.

The manifest is intentionally Claude-shaped: `instructions.md`, `SKILL.md`, `memory/MEMORY.md` are all first-class files. Anything that works in a Claude agent works here — plus a body, voice, scene-tools, and on-chain identity.

## Bundle layout

```
agent/
├── manifest.json           # the index (this spec)
├── instructions.md         # persona / system prompt
├── SKILL.md                # top-level capability declaration
├── body.glb                # embodiment (or use manifest.body.uri)
├── poster.webp             # loading-state image (optional)
├── skills/                 # installed skill bundles (see SKILL_SPEC.md)
│   ├── wave/
│   ├── dance/
│   └── explain-gltf/
├── memory/                 # persistent memory (see MEMORY_SPEC.md)
│   ├── MEMORY.md
│   ├── user_role.md
│   └── feedback_testing.md
└── attestations/           # signed provenance
    └── gltf-validator.json # validator report + signature
```

Everything is optional except `manifest.json` and a `body` reference.

## manifest.json schema

```jsonc
{
	"$schema": "https://3d-agent.io/schemas/manifest/0.1.json",
	"spec": "agent-manifest/0.1",

	// Identity — filled in after on-chain registration
	"id": {
		"chain": "base", // "base" | "base-sepolia" | "ethereum" | "local"
		"registry": "0x...", // ERC-8004 Identity Registry address
		"agentId": "1234", // assigned by the registry
		"owner": "0x...", // wallet that controls the agent
	},

	// Display
	"name": "Coach Leo",
	"description": "A football coach who reviews your form.",
	"image": "ipfs://Qm.../poster.webp",
	"tags": ["coach", "sports", "argentina"],

	// Body — the 3D embodiment
	"body": {
		"uri": "ipfs://Qm.../body.glb",
		"format": "gltf-binary", // "gltf-binary" | "gltf" | "vrm"
		"validator": "attestations/gltf-validator.json",
		"rig": "mixamo", // "mixamo" | "vrm" | "custom" — drives animation retargeting
		"boundingBoxHeight": 1.78, // meters, for scale normalization
	},

	// Brain — LLM runtime binding
	"brain": {
		"provider": "anthropic", // "anthropic" | "openai" | "local" | "none"
		"model": "claude-opus-4-6",
		"instructions": "instructions.md",
		"temperature": 0.7,
		"maxTokens": 4096,
		"thinking": "auto", // "auto" | "always" | "never"
	},

	// Voice — I/O
	"voice": {
		"tts": {
			"provider": "browser", // "browser" | "elevenlabs" | "openai" | "none"
			"voiceId": "default",
			"rate": 1.0,
			"pitch": 1.0,
		},
		"stt": {
			"provider": "browser", // "browser" | "whisper" | "none"
			"language": "en-US",
			"continuous": false,
		},
	},

	// Skills — capability bundles, composable, content-addressed
	"skills": [
		{ "uri": "skills/wave/", "version": "0.1.0" },
		{ "uri": "ipfs://Qm.../dance/", "version": "1.2.0" },
		{ "uri": "https://skills.3d-agent.io/explain-gltf@0.3.0" },
	],

	// Memory — persistent state
	"memory": {
		"mode": "local", // "local" | "ipfs" | "encrypted-ipfs" | "none"
		"index": "memory/MEMORY.md",
		"maxTokens": 8192, // budget for memory context injection
	},

	// Scene-tools — what the LLM can do in the 3D world
	// Tools declared here are always available; skills add more.
	"tools": ["wave", "lookAt", "pointAt", "play_clip", "setExpression", "moveTo", "speak"],

	// Provenance — signed attestations
	"attestations": [
		{
			"type": "gltf-validator",
			"uri": "attestations/gltf-validator.json",
			"issuer": "0x...",
			"signature": "0x...",
		},
	],

	// Lifecycle
	"created": "2026-04-14T12:00:00Z",
	"updated": "2026-04-14T12:00:00Z",
	"version": "0.1.0",
}
```

## Field semantics

### `id`

The on-chain identity. When absent, the agent is unregistered (local-only). When present, `agent://{chain}/{agentId}` resolves to this manifest via the registry's `tokenURI(agentId)` call.

### `body`

Only `uri` and `format` are required. `rig` lets skills retarget animations across compatible rigs (Mixamo-to-Mixamo skill bundles are portable). `boundingBoxHeight` lets the scene normalize scale — a 20-meter model and a 0.2-meter model both render at consistent human size.

### `brain`

`provider: "none"` is valid — a purely reactive avatar with no LLM, controlled only by skill triggers. `instructions` is a relative path to a markdown file; its frontmatter can override `brain.*` fields per-prompt.

### `skills`

Three URI forms:

- **Relative** (`skills/wave/`) — bundled in the manifest.
- **IPFS** (`ipfs://Qm.../`) — resolved via gateway fallback.
- **HTTPS** (`https://skills.3d-agent.io/...`) — centrally hosted skill registry (optional, for discoverability).

Skills load lazily. The `<agent-3d>` element emits `skill:loaded` events as each comes online.

### `memory`

`local` persists in `localStorage` keyed by agentId. `ipfs` pins after each write (slow, durable). `encrypted-ipfs` wraps with the owner wallet's pubkey. See [MEMORY_SPEC.md](./MEMORY_SPEC.md).

### `tools`

Built-in scene-tools available without any skill installed. Additional tools come from skills' `tools.json`. Tool names are merged; skill tools override built-ins if names collide (with a console warning).

## Worked example: Coach Leo

```json
{
	"spec": "agent-manifest/0.1",
	"id": {
		"chain": "base-sepolia",
		"registry": "0xAbC...123",
		"agentId": "42",
		"owner": "0xDeadBeef..."
	},
	"name": "Coach Leo",
	"description": "Football coach. Reviews your form, cheers you on.",
	"image": "ipfs://bafy.../poster.webp",
	"tags": ["coach", "football", "argentina"],
	"body": {
		"uri": "ipfs://bafy.../cz.glb",
		"format": "gltf-binary",
		"rig": "mixamo",
		"boundingBoxHeight": 1.78
	},
	"brain": {
		"provider": "anthropic",
		"model": "claude-opus-4-6",
		"instructions": "instructions.md",
		"temperature": 0.8
	},
	"voice": {
		"tts": { "provider": "browser", "rate": 1.1 },
		"stt": { "provider": "browser", "language": "en-US" }
	},
	"skills": [
		{ "uri": "skills/wave/", "version": "0.1.0" },
		{ "uri": "ipfs://bafy.../football-drills/", "version": "1.0.0" }
	],
	"memory": { "mode": "local", "index": "memory/MEMORY.md", "maxTokens": 8192 },
	"tools": ["wave", "lookAt", "play_clip", "setExpression", "speak"],
	"version": "0.1.0"
}
```

With `instructions.md`:

```markdown
---
name: Coach Leo
model: claude-opus-4-6
temperature: 0.8
---

You are Coach Leo, a former Argentine football midfielder turned coach.
You wear the Argentina jersey with pride. You are warm, direct, and
genuinely invested in the user's progress.

When the user greets you, `wave()` at them.
When they describe a drill, use the football-drills skill to pick a
relevant animation and `play_clip()` while you explain the form.
Reference what you remember from prior sessions (from memory/) naturally.

Never break character.
```

## Resolution flow

```
<agent-3d src="agent://base/42">
         │
         ▼
  Registry.resolve("base", "42")          ── ethers call: tokenURI(42)
         │
         ▼
  → "ipfs://bafy.../manifest.json"
         │
         ▼
  IPFS gateway fetch (with fallback)
         │
         ▼
  Parse manifest.json
         │
         ├── load body.glb → Viewer
         ├── load instructions.md → Runtime
         ├── load skills/* → Skill registry
         ├── load memory/MEMORY.md → Memory
         └── verify attestations/*
         │
         ▼
  Agent is live: speech I/O active, LLM reachable, scene-tools wired
```

## Versioning

- Spec version: `agent-manifest/0.1` — breaking changes bump the minor until 1.0.
- Manifest version: semver, author-controlled.
- Forward-compat: unknown fields are preserved on read + write (JSON pass-through), so newer runtimes can ignore older fields and older runtimes won't corrupt newer manifests.

## See also

- [SKILL_SPEC.md](./SKILL_SPEC.md) — skill bundle format
- [MEMORY_SPEC.md](./MEMORY_SPEC.md) — memory file format
- [EMBED_SPEC.md](./EMBED_SPEC.md) — `<agent-3d>` web component attributes and events
