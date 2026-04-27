# Agent Task: Write "Introduction & Overview" Documentation

## Output file
`public/docs/introduction.md` (or equivalent in the docs site)

## Target audience
Developers and product builders discovering three.ws for the first time. They may have seen the landing page or a widget embed and want to understand what the platform is, what problems it solves, and whether it's the right tool for them.

## Word count
1500–2500 words

## What this document must cover

### 1. What is three.ws?
Describe three.ws as a browser-native platform for creating, hosting, and embedding interactive 3D AI agents. Emphasize:
- Open-source (MIT licensed), hosted at https://three.ws
- Combines a WebGL 3D viewer (three.js, glTF 2.0 / GLB) with an integrated AI agent runtime
- Agents have personality, memory, skills, and blockchain identity
- Can be embedded anywhere as a web component (`<agent-3d>`) or iframe
- No server required for basic use — runs entirely in the browser

### 2. Core value propositions
Cover each of these clearly:
- **Embodied AI** — an agent that lives inside a 3D avatar, not just a chat box
- **Embeddable** — drop a `<script>` tag + `<agent-3d>` element into any page
- **Extensible** — custom skills, memory backends, voice I/O, blockchain identity
- **Decentralized** — agent identity can be registered on-chain (ERC-8004), memories stored on IPFS
- **Open** — MIT license, self-hostable, CDN-publishable library

### 3. Key concepts (brief definitions, ~1 paragraph each)
Define these terms as a glossary-style section:
- **Agent** — an AI entity with a 3D avatar, personality, memory, and skills
- **Avatar** — the 3D model (glTF/GLB) that visually represents the agent
- **Skill** — a modular capability installed into an agent (wave, validate-model, sign-action, etc.)
- **Widget** — a pre-built embeddable view (Turntable, Talking Agent, Animation Gallery, Passport, Hotspot Tour)
- **Manifest** — a JSON file that describes an agent (avatar URL, skills, personality, memory config)
- **ERC-8004** — the on-chain standard for registering three.ws identity

### 4. Architecture at a glance
High-level diagram described in prose + a conceptual breakdown:
- **Viewer layer** — three.js WebGLRenderer, OrbitControls, GLTFLoader, animation mixer
- **Agent layer** — protocol event bus, avatar emotion system, LLM runtime, skill registry
- **Identity layer** — ERC-8004 registry, IPFS memory, wallet auth (SIWE)
- **Embed layer** — `<agent-3d>` web component, postMessage bridge, widget types

### 5. What you can build
Concrete use cases:
- A talking product demo with a 3D character that knows your docs
- An on-chain AI agent registered to your ENS name
- A kiosk widget on a marketing page (auto-rotating 3D model)
- A personal AI companion with long-term memory
- An embeddable validator/inspector for 3D assets
- A multi-agent scene with characters interacting

### 6. How it compares
Brief, honest comparison to adjacent tools:
- vs. plain `<model-viewer>` (Google) — three.ws adds AI runtime, skills, memory, identity
- vs. general LLM chatbots — three.ws adds embodiment (avatar), 3D scene control, glTF understanding
- vs. Unity/Unreal WebGL exports — three.ws is lightweight (no game engine runtime), browser-native, open

### 7. Quick start preview
Show the absolute minimum to get something on screen — a 2-3 line code snippet using the CDN:
```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-3d model="https://example.com/avatar.glb"></agent-3d>
```
Then link to the full Quick Start guide.

### 8. What's next
Link to:
- Quick Start
- Embedding Guide
- Widget Types
- Agent System Overview
- API Reference

## Tone
Confident and clear. Not hype-driven. Treat the reader as a competent developer who wants facts, not marketing copy. Use concrete examples over vague promises.

## Files to read for accuracy
- `/README.md` — project description
- `/CLAUDE.md` — developer guidelines
- `/src/element.js` — web component attributes and API
- `/src/lib.js` — CDN export surface
- `/docs/ARCHITECTURE.md` — system overview
- `/docs/how-it-works.md` — feature explanation
- `/specs/AGENT_MANIFEST.md` — manifest schema
- `/specs/EMBED_SPEC.md` — embed protocol
