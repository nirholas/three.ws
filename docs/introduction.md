# Introduction

## Welcome to three.ws

three.ws lets you put a talking, animated AI character on any web page — no server required, no game engine, no complex setup.

Drop two lines of HTML and you have a 3D avatar that loads from a GLB file, responds to chat, plays animations, and can speak with a voice. Add a manifest and it gets a persona, memory, and installed skills. Register it on-chain and it gets a permanent identity anyone can resolve.

That's the full stack — from "hello world" to production agent — and you control how deep you go.

---

## The fastest way to start

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d body="https://example.com/avatar.glb"></agent-3d>
```

This renders your GLB in a WebGL viewer with orbit controls. No API key, no build step, no backend.

To add an AI brain:

```html
<agent-3d
  body="https://example.com/avatar.glb"
  brain="claude-sonnet-4-6"
  key-proxy="/api/llm"
  instructions="You are Aria, a helpful product guide."
  voice
></agent-3d>
```

`key-proxy` points to a small serverless function that injects your API key — it never touches the client. `voice` enables microphone input and text-to-speech output.

For a full walkthrough, see the [Quick Start guide](./quick-start.md).

---

## What you can build

**Talking product demo** — Give your docs site a 3D character loaded with your product documentation as its system prompt. Users ask questions; the character answers and plays animations. No backend needed for the agent itself.

**Embeddable widget** — Use Widget Studio to configure a Turntable, Animation Gallery, or Talking Agent and get a single iframe embed that works in WordPress, Webflow, Notion, Framer, or Shopify.

**Personal AI companion** — Build an agent with long-term IPFS memory that persists across sessions. Give it a custom voice, a distinctive avatar, and a detailed persona. Users can speak to it and it remembers past conversations.

**On-chain AI agent** — Register an agent to your wallet address. Anyone can resolve it via `agent://base/<id>`, and its manifest — including skills and memory config — lives on IPFS. The agent can perform scoped on-chain actions via ERC-7710 delegations.

**3D asset validator** — Drop a GLB onto the viewer and the agent runs the glTF validator, summarizes issues by severity, and tells you what to fix.

**Multi-agent scene** — Host multiple agents in a shared scene and script them to interact via the JavaScript API.

---

## How it works

three.ws is built in four layers, each of which you can use independently.

**Viewer** — A WebGL 2.0 renderer powered by three.js. Loads any glTF 2.0 / GLB file with Draco, KTX2, and Meshopt decompression out of the box. Orbit controls, HDR lighting, and an animation mixer are included.

**Agent runtime** — Connects an LLM (Anthropic, OpenAI, or any compatible provider) to the 3D scene. When the model responds, it can trigger animations, speak through TTS, write to memory, or invoke skill tools. The connection between what an agent _says_ and what it _does_ in 3D space is a first-class concern.

**Skills** — Modular capability bundles installed into an agent. Built-in examples include `wave`, `lookAt`, and `validate-model`. You can write your own and load them from IPFS or HTTPS at runtime.

**Identity** — Optional on-chain registration via ERC-8004. Once registered, an agent has a canonical address (`agent://base/42`) that resolves to an IPFS-hosted manifest containing the avatar, skills, memory config, and persona. Skip this entirely if you don't need it.

---

## Key concepts

**Agent** — An AI entity with a 3D avatar, a persona (defined in `instructions.md`), a memory store, and installed skills.

**Avatar** — The glTF 2.0 / GLB file that represents the agent visually. Any compatible model works; a `rig` field enables animation retargeting for Mixamo or Humanoid clips.

**Skill** — A modular capability. Each skill exposes tools to the LLM and optional scene hooks. Skills are loaded lazily and can be installed or removed at runtime.

**Manifest** — A JSON file that fully describes an agent. Minimal example:

```json
{
  "specVersion": "0.1",
  "name": "Aria",
  "body": { "uri": "./body.glb", "format": "glb" },
  "brain": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "instructions": "./instructions.md"
  }
}
```

**Widget** — A pre-built embeddable view. Five types ship: Turntable, Animation Gallery, Talking Agent, ERC-8004 Passport, and Hotspot Tour.

**ERC-8004** — The on-chain standard for three.ws identity. Optional, but enables sharing, oEmbed previews, and delegated permissions.

---

## vs. the alternatives

**vs. `<model-viewer>`** — Google's `<model-viewer>` is the right choice for simple 3D display with AR support. three.ws adds the full AI agent stack: LLM runtime, skill system, memory, voice I/O, emotion system, and on-chain identity. If you want a _talking_ character rather than a static viewer, three.ws is the right tool.

**vs. general LLM chatbots** — Chat interfaces are text-first with no awareness of 3D space. three.ws's agent runtime is purpose-built to bridge LLM outputs to three.js: the model can trigger animations, move the camera, highlight hotspots, and express emotions through the avatar.

**vs. Unity / Unreal WebGL** — Game engine exports ship 10–50 MB runtimes and require their own asset pipeline. three.ws is browser-native: no game engine, no plugin, compact CDN bundle, standard WebGL 2.0 available in every modern browser.

---

## License and hosting

- **License:** MIT — use it, fork it, self-host it
- **Hosted platform:** [https://three.ws/](https://three.ws/)
- **CDN:** `https://cdn.three.ws/agent-3d.js`
- **No server required** for basic use — the viewer, agent runtime, and skill system all run in the browser

---

## What's next

- **[Quick Start](./quick-start.md)** — step-by-step from zero to a talking agent
- **[Embedding Guide](./embedding.md)** — all attributes, modes, events, and the JS API
- **[Widget Types](./widgets.md)** — Turntable, Animation Gallery, Talking Agent, Passport, Hotspot Tour
- **[Agent System Overview](./agent-system.md)** — runtime, skill registry, memory, emotion system
- **[API Reference](./api-reference.md)** — complete JS API for `Agent3DElement`
