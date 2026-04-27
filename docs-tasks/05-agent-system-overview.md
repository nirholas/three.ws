# Agent Task: Write "Agent System Overview" Documentation

## Output file
`public/docs/agent-system.md`

## Target audience
Developers who want to understand how the AI agent layer works — how agents think, speak, emote, remember, and act. Assumes basic understanding of event-driven programming and LLMs.

## Word count
2000–3000 words

## What this document must cover

### 1. What is an agent?
Contrast with a plain 3D viewer: an agent is a viewer plus a brain. The brain consists of:
- **Identity** — a manifest (name, description, creator) optionally registered on-chain
- **Avatar** — a 3D model with an emotion system layered on top
- **Memory** — a typed store of what the agent knows and has experienced
- **Skills** — modular capabilities (wave, validate, sign, help, etc.)
- **Runtime** — an LLM-driven tool-loop that decides what to say and do

### 2. The agent protocol (event bus)
`agent-protocol.js` is the backbone — a CustomEvent bus that routes all agent actions:

| Event | Payload | Description |
|-------|---------|-------------|
| `speak` | `{ text, valence }` | Agent says something (triggers TTS + emotion) |
| `think` | `{ text }` | Internal monologue (not spoken) |
| `gesture` | `{ name }` | One-shot gesture (wave, nod, shrug) |
| `emote` | `{ emotion, intensity }` | Set emotional state |
| `look-at` | `{ target }` | Change gaze direction |
| `perform-skill` | `{ skill, args }` | Execute a skill |
| `skill-done` | `{ skill, result }` | Skill completed |
| `remember` | `{ key, value }` | Store to memory |
| `validate` | `{ report }` | Validation result available |
| `load-start` | — | GLB loading began |
| `load-end` | `{ success }` | GLB load complete |

Explain why events: decouples all modules, enables testing in isolation, allows multiple listeners (UI + avatar + memory all react to `speak`).

### 3. The LLM runtime (tool-loop)
Step-by-step:
1. Input arrives: user text OR transcribed speech
2. Runtime prepares system prompt (agent personality, current scene state)
3. Built-in tools are available: `wave`, `lookAt`, `play_clip`, `setExpression`, `speak`, `remember`
4. LLM (AnthropicProvider → Claude) returns tool calls or content
5. Tools are executed via SceneController
6. Results appended to conversation
7. Loop repeats up to `MAX_TOOL_ITERATIONS = 8`
8. Final text dispatched as `speak` event

Mention NullProvider as the fallback (used when no API key configured — agent still works but doesn't generate responses).

### 4. Built-in tools
Document each tool the LLM can call:

**wave** — triggers wave gesture on avatar. No args.

**lookAt** `{ target: "model"|"user"|"camera" }` — changes gaze direction.

**play_clip** `{ name: string, loop?: boolean }` — plays an animation clip by name.

**setExpression** `{ emotion: string, intensity: number }` — sets emotional blend state.

**speak** `{ text: string }` — dispatches speak event, triggers TTS.

**remember** `{ key: string, value: string }` — stores a key-value to agent memory.

### 5. The avatar emotion system
The avatar module (`agent-avatar.js`) makes the 3D model come alive:

**Continuous emotion blending:**
All emotions co-exist as weighted floats that decay over time:
- `concern` — half-life ~9 seconds
- `celebration` — half-life ~4 seconds
- `patience` — half-life ~20 seconds
- `curiosity` — half-life ~6 seconds
- `empathy` — half-life ~13 seconds
- `neutral` — the remainder (always 1 minus sum of active emotions)

**Stimulus mapping (automatic):**
- Positive speech (valence > 0.3) → celebration
- Errors in model → concern + empathy
- Model load start → patience + curiosity
- Model load end success → celebration
- Validation clean → celebration + nod gesture

**Morph target control:**
Emotions drive these morph targets per-frame:
- mouthSmile, mouthFrown, mouthOpen, cheekPuff
- browInnerUp, browOuterUp, noseSneer
- eyeSquint, eyesClosed

**Head movement:**
- Z-axis rotation (tilt) based on curiosity + empathy + concern weights
- X-axis rotation (lean) based on curiosity − patience difference

**Gaze control:**
- Look at model: eyes/head orient toward the loaded 3D asset
- Look at user: orient toward camera
- Auto-blend between states

**One-shot gestures:**
- Wave: plays wave animation clip
- Nod: brief head nod animation
- Shrug: brief shrug motion

### 6. Agent memory (4 types)
The in-memory store has four categories:
- **Short-term** — working memory for current conversation context
- **Long-term** — persistent facts the agent has been told to remember
- **Emotional** — history of emotional state changes (used to inform personality)
- **Action log** — timestamped record of every significant action

Memory is readable by the LLM runtime (injected into system prompt context) and writable via the `remember` tool.

Persistence is handled separately by the memory backend (`memory/` module) — see the Memory documentation.

### 7. Agent identity
The `agent-identity.js` module manages:
- **Passport** — the agent's public profile (name, description, creator address)
- **Diary** — a signed log of actions (`speak`, `remember`, `skill-done`, `validate`)
- **Wallet linking** — associates the agent with an Ethereum address
- **Backend sync** — fires-and-forgets to `/api/agent-actions` (non-blocking)

Every significant action is signed with the connected wallet when available, creating a tamper-evident history.

### 8. Skills
Skills extend what an agent can do. See the Skills documentation for full details. Brief overview here:
- Skills are loaded from a manifest (URL or inline JSON)
- Each skill has tool definitions and handler code
- The skill registry enforces trust modes (any, owned-only, whitelist)
- Skills can be chained (dependencies resolved recursively)

### 9. Speech I/O
TTS and STT are handled by `runtime/speech.js`:
- **TTS** — browser Web Speech API (default, free, no key required) or ElevenLabs (higher quality, requires API key)
- **STT** — browser SpeechRecognition API (Chrome/Edge) — starts listening when user presses the mic button
- Audio plays inline — no separate audio element needed

### 10. Configuring an agent
The minimum manifest to run an agent:
```json
{
  "name": "Aria",
  "description": "A helpful 3D guide for my product",
  "avatar": { "url": "https://example.com/aria.glb" },
  "personality": {
    "prompt": "You are Aria, a friendly guide. Be concise and helpful.",
    "voice": "female"
  },
  "memory": { "mode": "local" }
}
```

Full manifest schema reference in the Agent Manifest documentation.

### 11. Debugging an agent
- Open browser DevTools → Events tab to watch CustomEvents on the protocol bus
- Check `window.__3dagent_debug = true` for verbose logging
- NullProvider mode: set `brain` attribute without an LLM key to test avatar/emotion without AI
- Use `#brain` URL hash to run headless (no viewer, just the agent runtime)

## Tone
Thorough but not overwhelming. Use tables for event schemas and tool args. Walk through sequences with numbered steps. This is a reference for builders.

## Files to read for accuracy
- `/src/agent-protocol.js`
- `/src/agent-avatar.js` (770 lines — read fully)
- `/src/agent-memory.js`
- `/src/agent-identity.js`
- `/src/agent-skills.js`
- `/src/runtime/index.js`
- `/src/runtime/scene.js`
- `/src/runtime/tools.js`
- `/src/runtime/speech.js`
- `/src/runtime/providers.js`
- `/specs/AGENT_MANIFEST.md`
