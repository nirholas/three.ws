# Agent Task: Write "Architecture Overview" Documentation

## Output file
`public/docs/architecture.md`

## Target audience
Developers who want to understand how the system works at a deeper level — to extend it, self-host it, or integrate it with their own stack. Assumes familiarity with JavaScript, WebGL concepts at a high level, and basic blockchain concepts.

## Word count
2000–3000 words

## What this document must cover

### 1. System overview
Describe the four-layer architecture:

**Layer 1 — Viewer (Rendering)**
- three.js WebGLRenderer
- GLTFLoader with Draco/KTX2 decoders
- OrbitControls for interaction
- AnimationMixer for clip playback
- Material/texture inspection (dat.gui)
- Morph target control
- Stats panel (FPS, memory)
- Screenshot capture
- Grid, axes, wireframe, skeleton helpers

**Layer 2 — Agent Runtime**
- `agent-protocol.js` — central event bus (CustomEvent)
- `agent-avatar.js` — emotion blending, morph target control, gaze, gestures
- `runtime/index.js` — LLM tool-loop engine (Claude/Anthropic)
- `runtime/scene.js` — SceneController bridging agent commands to viewer
- `runtime/tools.js` — built-in tools (wave, lookAt, play_clip, setExpression, speak, remember)
- `runtime/speech.js` — TTS (Web Speech API / ElevenLabs) and STT (SpeechRecognition)
- `agent-skills.js` — skill registry, execution, trust management
- `agent-memory.js` — 4-type in-memory store

**Layer 3 — Identity & Persistence**
- `agent-identity.js` — passport + diary, wallet linking, signed history
- `memory/` — file-based memory (local, IPFS, encrypted-IPFS, none)
- `erc8004/` — on-chain agent registration (IdentityRegistry, ReputationRegistry, ValidationRegistry)
- `auth/` — SIWE wallet auth, Privy OAuth, session management

**Layer 4 — Embed & Distribution**
- `element.js` — `<agent-3d>` custom web component
- `widget-types.js` — 5 widget variants
- `lib.js` — CDN-distributable single-file library
- `app.js` — main SPA with hash + query routing
- `vercel.json` — edge routing config

### 2. Event bus (agent-protocol.js)
Explain the CustomEvent-based pub/sub at the center of the system:
- All agent actions are events (speak, think, gesture, emote, look-at, perform-skill, skill-done, remember, validate, load-start, load-end)
- No direct module coupling — viewer, avatar, LLM, and UI all communicate through events
- Why this matters: hot-swap modules, testability, embed isolation

### 3. LLM tool-loop
Step-by-step explanation of how the agent "thinks":
1. User message arrives (text or transcribed speech)
2. Runtime sends to LLM provider (AnthropicProvider or NullProvider)
3. LLM returns tool calls or text
4. Tools are executed against the SceneController context
5. Results fed back to LLM
6. Loop repeats up to MAX_TOOL_ITERATIONS (8)
7. Final text is spoken + displayed

### 4. Agent manifest
Describe the JSON manifest structure:
- `name`, `description`, `creator`
- `avatar.url` — GLB URL
- `skills[]` — array of skill manifests
- `memory.mode` — local | ipfs | encrypted-ipfs | none
- `identity.chainId`, `identity.registryAddress` — on-chain identity
- `personality` — system prompt, tone, domain
- Resolution chain: `agent://`, `ipfs://`, `ar://`, `https://` URIs all supported

### 5. Web component lifecycle
Describe `<agent-3d>` boot sequence:
1. Element connected to DOM
2. IntersectionObserver fires when visible
3. Manifest loaded (from `agent-id` attribute or inline config)
4. Viewer initialized (canvas, renderer, controls)
5. GLB loaded and displayed
6. Agent runtime started (if `brain` attribute set or agent manifest has LLM config)
7. PostMessage bridge activated (for host communication)

### 6. Multi-product build targets
Three Vite build configurations:
- **App** — full SPA (multi-page, PWA, all routes)
- **Library** (`TARGET=lib`) — single-file web component for CDN
- **Artifact** — zero-dependency bundle for Claude artifact embeds

### 7. Data flow for a conversation
Walk through a complete round trip:
1. User speaks → STT transcribes
2. Transcript arrives at runtime
3. Runtime sends to LLM with tool definitions
4. LLM calls `speak` tool with text
5. Runtime dispatches `speak` event on protocol bus
6. Avatar module hears event → triggers emotion blend (celebration for positive, concern for errors)
7. TTS speaks the text aloud
8. Memory module logs the interaction
9. Identity diary records the signed action

### 8. Blockchain integration (ERC-8004)
High-level flow:
- User connects wallet (MetaMask, WalletConnect, Privy)
- Agent manifest pinned to IPFS
- `IdentityRegistry.registerAgent(cid, metadata)` called on target chain
- Agent assigned an on-chain ID
- Anyone can resolve `3dagent.eth` or a chain:registry:id to the agent manifest
- Reputation submitted to `ReputationRegistry`
- Validation attestations stored in `ValidationRegistry`

### 9. Security model
- Client-side processing: GLB files never leave the browser
- Skill sandbox: ERC-7710 delegation limits what skills can do
- CSP compatibility: no inline scripts in embed mode
- Embed policy: origin/referrer allowlist enforced server-side
- SIWE: wallet-signed messages prove identity without passwords

### 10. Self-hosting
What's needed:
- Vercel (or any Node.js host) for API routes
- Neon DB (PostgreSQL) for agent/widget storage
- Upstash Redis for rate limiting/caching
- AWS S3 (or compatible) for GLB/asset storage
- Anthropic API key for LLM
- Optional: ElevenLabs for TTS, Pinata/Filebase for IPFS, Privy for wallet auth

## Tone
Technical and precise. Use numbered lists for sequences, bullet lists for options. Diagrams would help — describe them in prose since this is markdown. Don't oversimplify but also don't assume the reader has read the source.

## Files to read for accuracy
- `/docs/ARCHITECTURE.md`
- `/src/agent-protocol.js`
- `/src/runtime/index.js`
- `/src/runtime/scene.js`
- `/src/runtime/tools.js`
- `/src/agent-avatar.js`
- `/src/agent-identity.js`
- `/src/element.js`
- `/src/manifest.js`
- `/vite.config.js`
- `/vercel.json`
- `/specs/AGENT_MANIFEST.md`
- `/specs/EMBED_SPEC.md`
- `/specs/SKILL_SPEC.md`
