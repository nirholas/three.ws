# src/CLAUDE.md

Scoped guidance for the viewer + agent runtime. Read [/CLAUDE.md](../CLAUDE.md) first.

---

## The two halves

- **Viewer half** — [viewer.js](viewer.js), [viewer/](viewer/), [environments.js](environments.js), [validator.js](validator.js), [animation-manager.js](animation-manager.js), [model-info.js](model-info.js), [annotations.js](annotations.js), [editor/](editor/). Pure three.js. Loads GLB, renders, manages animations, validates.
- **Agent half** — [agent-*.js](./), [runtime/](runtime/), [skills/](skills/), [memory/](memory/), [erc8004/](erc8004/), [manifest.js](manifest.js), [element.js](element.js). Adds persona, memory, skills, identity, emotional presence.

The viewer doesn't know about agents. The agent layer wraps the viewer through [runtime/scene.js](runtime/scene.js) (SceneController).

---

## Module map

### Agent primitives (singleton-ish, per element instance)
- [agent-protocol.js](agent-protocol.js) — **the bus.** Everything communicates through `protocol.emit()` / `protocol.on()`. Don't add direct module-to-module coupling.
- [agent-identity.js](agent-identity.js) — passport + diary. localStorage + `/api/agents/:id`. Wallet linking, signed action history.
- [agent-memory.js](agent-memory.js) — in-memory 4-type store (see also [memory/index.js](memory/index.js) for the file-based variant).
- [agent-skills.js](agent-skills.js) — built-in skills (greet, present-model, validate-model, remember, think, sign-action, help).
- [agent-avatar.js](agent-avatar.js) — **the Empathy Layer.** Emotion blend, morph targets, gaze, one-shot gestures.
- [agent-home.js](agent-home.js) — identity card + action timeline + emotion presence UI.
- [agent-resolver.js](agent-resolver.js) — resolves `agent-id="..."` attributes to manifests via `/api/agents/:id`.

### Runtime (LLM brain)
- [runtime/index.js](runtime/index.js) — tool loop. `MAX_TOOL_ITERATIONS = 8`.
- [runtime/providers.js](runtime/providers.js) — `AnthropicProvider`, `NullProvider`.
- [runtime/scene.js](runtime/scene.js) — SceneController wraps Viewer with agent-facing API (`playClipByName`, `lookAt`, `setExpression`, `loadGLB`).
- [runtime/tools.js](runtime/tools.js) — `BUILTIN_TOOLS` + handlers (wave, lookAt, play_clip, setExpression, speak, remember).
- [runtime/speech.js](runtime/speech.js) — TTS/STT via browser Web Speech API.

### Format loaders
- [manifest.js](manifest.js) — `agent-manifest/0.1`. Loads from `agent://chain/id`, `ipfs://`, `ar://`, `https://`. `normalize()` adapts ERC-8004 registration JSON.
- [skills/index.js](skills/index.js) — SkillRegistry. `.install(spec, { bundleBase })`, trust modes (`any`, `owned-only`, `whitelist`), recursive deps.
- [memory/index.js](memory/index.js) — file-based (frontmatter `.md` files + auto-generated MEMORY.md index + append-only timeline). Modes: `local`, `ipfs`, `encrypted-ipfs`, `none`.
- [ipfs.js](ipfs.js) — IPFS/Arweave → HTTPS gateway with fallback (ipfs.io → dweb.link → nft.storage).

### Web component boundary
- [element.js](element.js) — `<agent-3d>` custom element. IntersectionObserver lazy boot unless `eager`. See attribute list in [specs/EMBED_SPEC.md](../specs/EMBED_SPEC.md).
- [lib.js](lib.js) — CDN library export surface.
- [app.js](app.js) — main SPA entry. **URL hash routing lives here** — keys: `model`, `widget`, `agent`, `kiosk`, `brain`, `proxyURL`, `preset`, `cameraPosition`, `register`.

### Blockchain
- [erc8004/abi.js](erc8004/abi.js) — IdentityRegistry / ReputationRegistry / ValidationRegistry ABIs + `REGISTRY_DEPLOYMENTS` (mainnet + testnet addresses, keyed by chainId).
- [erc8004/agent-registry.js](erc8004/) — `connectWallet()`, `registerAgent()`, `buildRegistrationJSON()`, `pinToIPFS()`.
- [erc8004/privy.js](erc8004/) — Privy OAuth hooks.
- [erc8004/reputation.js](erc8004/) — `submitFeedback()`, `getReputation()`, `getRecentReviews()`.
- [erc8004/validation-recorder.js](erc8004/) — `recordValidation()`, `hashReport()`.

---

## The protocol bus — event vocabulary

All events are `CustomEvent` with `detail = { type, payload, timestamp, agentId, sourceSkill }`. Emitters fire on `protocol`, consumers subscribe via `protocol.on(type, handler)`.

| Type | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `speak` | `{ text, sentiment }` (-1..1) | runtime, skills | avatar (emotion), home (timeline), nich-agent (chat UI) |
| `think` | `{ thought }` | runtime | home, avatar |
| `gesture` | `{ name, duration }` | skills, avatar | avatar (one-shot clip) |
| `emote` | `{ trigger, weight }` (0..1) | skills, avatar internals | avatar (emotion blend) |
| `look-at` | `{ target: 'model'\|'user'\|'camera' }` | skills | scene-ctrl |
| `perform-skill` | `{ skill, args, animationHint }` | runtime | skills registry |
| `skill-done` | `{ skill, result: { success, output, sentiment, data } }` | skill handlers | avatar, identity |
| `skill-error` | `{ skill, error }` | skill handlers | avatar (concern + empathy), identity |
| `remember` | `{ type, content, ... }` | skills, runtime | memory, identity |
| `sign` | `{ message, address }` | skills | identity |
| `load-start` | `{ uri }` | viewer | avatar (patience + curiosity) |
| `load-end` | `{ uri, error? }` | viewer | avatar (concern or celebration) |
| `validate` | `{ errors, warnings }` | validator | avatar, identity |
| `presence` | `{ state }` | element | home |

**Identity records these to the backend:** `speak`, `remember`, `sign`, `skill-done`, `validate`, `load-end`. Fire-and-forget via `POST /api/agent-actions`.

**Debug:** `window.VIEWER.agent_protocol.history.slice(-10)` or `protocol.on('*', console.log)`.

---

## The Empathy Layer — how it actually works

### State
Continuous weighted blend of `{ neutral, concern, celebration, patience, curiosity, empathy }`. All blend simultaneously. `neutral = 1 - sum(others)`.

### Decay (per second)
| Emotion | Rate | Half-life |
|---|---|---|
| concern | 0.08 | ~9s |
| celebration | 0.18 | ~4s |
| patience | 0.035 | ~20s |
| curiosity | 0.12 | ~6s |
| empathy | 0.055 | ~13s |

### Stimulus rules (protocol → emotion)
- `speak`: valence > 0.3 → celebration; < -0.2 → concern; arousal > 0.5 → curiosity
- `skill-done`: `result.sentiment` > 0.3 → celebration; < -0.2 → concern
- `skill-error`: concern + empathy (scaled by error streak × 0.25)
- `load-start`: patience + curiosity
- `load-end`: error → concern; success → celebration + curiosity
- `validate`: errors → concern; warnings → concern; clean → celebration + nod

### Morph target mapping (per frame, lerp speed ~4.0)
- celebration → mouthSmile 0.85, mouthOpen 0.2, cheekPuff 0.2
- concern → mouthFrown 0.55, browInnerUp 0.6, noseSneer 0.15
- empathy → eyeSquint 0.4, browInnerUp 0.5
- curiosity → browOuterUp 0.7/0.5
- patience → eyesClosed 0.15 (subtle)

### Head transform
Z-rotation = `(curiosity*12 + empathy*9 + concern*4)` degrees. X-rotation (lean) = `curiosity*0.03 - patience*0.02`. Finds `Head` or `Neck` bone in skeleton.

**Don't add a discrete emotion FSM.** The whole point is the continuous blend.

---

## Conventions

- **ESM only.** No CommonJS.
- **Tabs, 4-wide.** Prettier-enforced.
- **JSDoc for public APIs.** No TypeScript.
- **Classes over factories** where there's state. EventTarget for buses.
- **Naming:** CamelCase classes, camelCase methods, UPPER_CASE constants, `_underscore` for private methods/fields.
- **vhtml JSX** in `*.jsx` components — string-based, no virtual DOM. See [components/](components/).
- **Tool result shape:** `{ ok: true, ... }` or `{ ok: false, error: 'msg' }`.
- **Skill handler context:** `(args, ctx)` where `ctx = { viewer, memory, llm, speak, listen, fetch, loadGLB, loadClip, loadJSON, call }`.

---

## Gotchas

- **`window.VIEWER`** is a debug global exposing `.editor, .agent, .agent_protocol, .agent_avatar, .agent_skills, .runtime, .scene_ctrl`. Never rely on it in production code — use closure / DI.
- **Manifest `_baseURI`** must end with `/` for relative resolution of `body.uri`, `SKILL.md`, `tools.json`, `handlers.js`.
- **Viewer._afterAnimateHooks** — avatar hooks its `_tickEmotion` here for per-frame decay. Fragile coupling; don't rearrange.
- **SpeechRecognition** silently noops if unavailable. Check `window.SpeechRecognition || window.webkitSpeechRecognition` before relying.
- **Morph traversal** iterates every mesh every frame. Cheap on Mixamo avatars, expensive on scene-scale models — don't add per-vertex work.
- **Skill `owned-only` trust** compares `manifest.author` with `ownerAddress` from element attr or backend. Mismatch → skill load throws.
- **[viewer.js](viewer.js) is the biggest file in `src/` (~1.2k lines).** Further module split is tracked in [prompts/scalability/03-module-split.md](../prompts/scalability/03-module-split.md). Don't start that refactor ad-hoc.
- **`memory.recall()` is substring search.** No embeddings yet.
- **No rate limit on `protocol.emit()`.** A runaway skill loop will cascade.

---

## What's half-built (don't assume working)

- [features/hero-pretext.js](features/) — flag-gated, not core
- [editor/](editor/) — GLB export + material editor exist, agent-system integration minimal
- ERC-8004 reputation/validation — hooked but no UI
- Memory `encrypted-ipfs` mode — stub
- Runtime `thinking: 'auto'` — limited UX wiring
- Privy integration — functions exist, no full auth flow in element.js
- Avatar Creator save-to-account — may not persist in all flows
- Avatar Creator now wraps the Ready Player Me iframe. Configure the subdomain via `VITE_RPM_SUBDOMAIN`; falls back to `demo.readyplayer.me`.

---

## Adding things

**New action type:** add to `ACTION_TYPES` in [agent-protocol.js](agent-protocol.js), emit at source, subscribe in consumers. Update the event vocabulary table above.

**New built-in tool:** add to `BUILTIN_TOOLS` array + `BUILTIN_HANDLERS` in [runtime/tools.js](runtime/tools.js). Handler signature: `async (args, ctx) => ({ ok: true, ... })`.

**New skill:** bundle under [skills/](skills/). See /CLAUDE.md "Canonical patterns → New agent skill" for the 5-step recipe.

**New URL hash param:** parse in [app.js](app.js) next to existing keys. Don't invent a new routing layer.
