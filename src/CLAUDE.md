# src/CLAUDE.md

Scoped guidance for the viewer + agent runtime. Read [/CLAUDE.md](../CLAUDE.md) first.

---

## The two halves

- **Viewer half** — [viewer.js](viewer.js), [viewer/](viewer/), [environments.js](environments.js), [validator.js](validator.js), [animation-manager.js](animation-manager.js), [model-info.js](model-info.js), [annotations.js](annotations.js), [editor/](editor/). Pure three.js. Loads GLB, renders, manages animations, validates.
- **Agent half** — [agent-\*.js](./), [runtime/](runtime/), [skills/](skills/), [memory/](memory/), [erc8004/](erc8004/), [manifest.js](manifest.js), [element.js](element.js). Adds persona, memory, skills, identity, emotional presence.

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
- [runtime/data-reactive.js](runtime/data-reactive.js) — `startDataReactive({ protocol, source, bindings, signal })`. Wires a live SSE/WS/poll source to the protocol bus via declarative `{ match, emit }` bindings. Available in skill handlers as `ctx.dataReactive.start({...})`.

### Format loaders

- [manifest.js](manifest.js) — `agent-manifest/0.1`. Loads from `agent://chain/id`, `ipfs://`, `ar://`, `https://`. `normalize()` adapts ERC-8004 registration JSON.
- [skills/index.js](skills/index.js) — SkillRegistry. `.install(spec, { bundleBase })`, trust modes (`any`, `owned-only`, `whitelist`), recursive deps.
- [memory/index.js](memory/index.js) — file-based (frontmatter `.md` files + auto-generated MEMORY.md index + append-only timeline). Modes: `local`, `ipfs`, `encrypted-ipfs`, `none`.
- [ipfs.js](ipfs.js) — IPFS/Arweave → HTTPS gateway with fallback (ipfs.io → dweb.link → nft.storage).

### Web component boundary

- [element.js](element.js) — `<agent-3d>` custom element. IntersectionObserver lazy boot unless `eager`. See attribute list in [specs/EMBED_SPEC.md](../specs/EMBED_SPEC.md).

  **Avatar-chat mode** (default on): vertical chrome layout with `.avatar-anchor` transparent window. Thought bubble appears above the anchor. Walk animation (`walk` clip) plays during `brain:stream` events. Disabled via `avatar-chat="off"` attribute. New public methods: `enableAvatarChat()`, `disableAvatarChat()`.

#### Avatar-chat methods (element.js)

- `enableAvatarChat()` — re-enable inline avatar layout + walk + bubble (default on)
- `disableAvatarChat()` — disable to restore bottom-bar layout; removes attribute `avatar-chat="off"`
- `_onStreamChunk()` — start walking; debounces stop by 600ms; respects prefers-reduced-motion
- `_stopWalkAnimation()` — crossfade walk→idle immediately
- `_streamToBubble(chunk)` — append token chunk to bubble, RAF-batched
- `_clearThoughtBubble()` — hide bubble and reset text+buffer
- `_setBusy(busy)` — disable/enable input; sets placeholder and data-busy

- [lib.js](lib.js) — CDN library export surface.
- [app.js](app.js) — main SPA entry. **URL routing lives here.** Hash keys (embed/legacy): `model`, `widget`, `agent`, `kiosk`, `brain`, `proxyURL`, `preset`, `cameraPosition`, `register`. Query-string keys: `agent=<id>` (authenticated edit mode — distinct from `#agent=` which stays in embed mode), `pending=1` (post-login save round-trip).

### Blockchain

- [erc8004/abi.js](erc8004/abi.js) — IdentityRegistry / ReputationRegistry / ValidationRegistry ABIs + `REGISTRY_DEPLOYMENTS` (mainnet + testnet addresses, keyed by chainId).
- [erc8004/agent-registry.js](erc8004/) — `connectWallet()`, `registerAgent()`, `buildRegistrationJSON()`, `pinToIPFS()`.
- [erc8004/privy.js](erc8004/) — Privy OAuth hooks.
- [erc8004/reputation.js](erc8004/) — `submitFeedback()`, `getReputation()`, `getRecentReviews()`.
- [erc8004/validation-recorder.js](erc8004/) — `recordValidation()`, `hashReport()`.

---

## The protocol bus — event vocabulary

All events are `CustomEvent` with `detail = { type, payload, timestamp, agentId, sourceSkill }`. Emitters fire on `protocol`, consumers subscribe via `protocol.on(type, handler)`.

| Type            | Payload                                                   | Emitted by               | Consumed by                                             |
| --------------- | --------------------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `speak`         | `{ text, sentiment }` (-1..1)                             | runtime, skills          | avatar (emotion), home (timeline), nich-agent (chat UI) |
| `think`         | `{ thought }`                                             | runtime                  | home, avatar                                            |
| `gesture`       | `{ name, duration }`                                      | skills, avatar           | avatar (one-shot clip)                                  |
| `emote`         | `{ trigger, weight }` (0..1)                              | skills, avatar internals | avatar (emotion blend)                                  |
| `look-at`       | `{ target: 'model'\|'user'\|'camera' }`                   | skills                   | scene-ctrl                                              |
| `perform-skill` | `{ skill, args, animationHint }`                          | runtime                  | skills registry                                         |
| `skill-done`    | `{ skill, result: { success, output, sentiment, data } }` | skill handlers           | avatar, identity                                        |
| `skill-error`   | `{ skill, error }`                                        | skill handlers           | avatar (concern + empathy), identity                    |
| `remember`      | `{ type, content, ... }`                                  | skills, runtime          | memory, identity                                        |
| `sign`          | `{ message, address }`                                    | skills                   | identity                                                |
| `load-start`    | `{ uri }`                                                 | viewer                   | avatar (patience + curiosity)                           |
| `load-end`      | `{ uri, error? }`                                         | viewer                   | avatar (concern or celebration)                         |
| `validate`      | `{ errors, warnings }`                                    | validator                | avatar, identity                                        |
| `presence`      | `{ state }`                                               | element                  | home                                                    |
| `interrupted`   | `{}`                                                      | speech.js (TTS cancel)   | avatar (startle + curiosity)                            |
| `notify`        | `{ message, priority, duration }`                         | element.notify(), data-reactive | AgentNotifier (enter/exit frame + speak)        |

**Runtime EventTarget events** — `brain:stream` and `skill:tool-start` are NOT routed through `protocol.emit()`. They are dispatched on the Runtime EventTarget and re-dispatched by element.js as composed CustomEvents on the host element. Listen on the host element, not via `protocol.on()`.

| Type              | Payload                    | Emitted by                              | Consumed by                                        |
| ----------------- | -------------------------- | --------------------------------------- | -------------------------------------------------- |
| `brain:stream`    | `{ chunk: string }`        | runtime `_loop()` via `dispatchEvent`   | element.js (thought bubble streaming, chat buffer) |
| `skill:tool-start`| `{ tool: string, args: object }` | runtime `_loop()` via `dispatchEvent` | element.js (walk animation, bubble label)     |

**Identity records these to the backend:** `speak`, `remember`, `sign`, `skill-done`, `validate`, `load-end`. Fire-and-forget via `POST /api/agent-actions`.

**Debug:** `window.VIEWER.agent_protocol.history.slice(-10)` or `protocol.on('*', console.log)`.

---

## The Empathy Layer — how it actually works

### State

Continuous weighted blend of `{ neutral, concern, celebration, patience, curiosity, empathy }`. All blend simultaneously. `neutral = 1 - sum(others)`.

### Decay (per second)

| Emotion     | Rate  | Half-life |
| ----------- | ----- | --------- |
| concern     | 0.08  | ~9s       |
| celebration | 0.18  | ~4s       |
| patience    | 0.035 | ~20s      |
| curiosity   | 0.12  | ~6s       |
| empathy     | 0.055 | ~13s      |
| uncertain   | 0.10  | ~7s       |

### Stimulus rules (protocol → emotion)

- `speak`: valence > 0.3 → celebration; < -0.2 → concern; arousal > 0.5 → curiosity; hedge vocab → uncertain (capped 0.8)
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
- uncertain → mouthPressLeft/Right 0.35, browInnerUp max(concern×0.6, uncertain×0.45, empathy×0.5); also scales idle hip-drift amplitude (base 0.018 rad + bias×0.025 rad)

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
- **Skill handler context:** `(args, ctx)` where `ctx = { viewer, memory, llm, speak, listen, fetch, loadGLB, loadClip, loadJSON, call, dataReactive }`.

---

## Gotchas

- **`window.VIEWER`** is a debug global exposing `.editor, .agent, .agent_protocol, .agent_avatar, .agent_skills, .runtime, .scene_ctrl`. Never rely on it in production code — use closure / DI.
- **Manifest `_baseURI`** must end with `/` for relative resolution of `body.uri`, `SKILL.md`, `tools.json`, `handlers.js`.
- **Viewer.\_afterAnimateHooks** — avatar hooks its `_tickEmotion` here for per-frame decay. Fragile coupling; don't rearrange.
- **SpeechRecognition** silently noops if unavailable. Check `window.SpeechRecognition || window.webkitSpeechRecognition` before relying.
- **Morph traversal** iterates every mesh every frame. Cheap on Mixamo avatars, expensive on scene-scale models — don't add per-vertex work.
- **Skill `owned-only` trust** compares `manifest.author` with `ownerAddress` from element attr or backend. Mismatch → skill load throws.
- **[viewer.js](viewer.js) is the biggest file in `src/` (~1.2k lines).** Further module split is tracked in [prompts/scalability/03-module-split.md](../prompts/scalability/03-module-split.md). Don't start that refactor ad-hoc.
- **`memory.recall()` is substring search.** No embeddings yet.
- **`_onStreamChunk()` debounce**: The walk animation uses a 600ms debounce. Calling `_stopWalkAnimation()` directly will interrupt it. Only call `_stopWalkAnimation()` in response to `brain:thinking { thinking: false }` or deliberate teardown.
- **Thought bubble RAF queue**: `_streamToBubble()` buffers chunks and flushes on the next animation frame. Don't read `_thoughtTextEl.textContent` synchronously after calling `_streamToBubble()` — it won't reflect the latest buffer yet.
- **`brain:stream` fires per token** — at 50+ tokens/sec this is frequent. All handlers must be O(1) and RAF-batched. Never do synchronous network or heavy DOM work in a `brain:stream` handler.
- **Walk animation requires walk+idle clips preloaded** — if `animationManager.isLoaded('walk')` returns false, `_onStreamChunk()` silently skips the walk. Ensure the preload strategy (prompt 29) is implemented before relying on walk-on-stream.
- **Throttle policies on `protocol.emit()`.** Animation-driving events are shaped by default: `gesture` (leading-edge throttle, 600 ms), `emote` (coalesce by `payload.trigger` with max-weight merge, 150 ms window), `look-at` (trailing debounce, 100 ms). All other types pass through. Override per-instance with `protocol.setThrottlePolicy(type, policy)` where `policy` is `{ mode: 'passthrough' }`, `{ mode: 'throttle', leading: true, intervalMs }`, `{ mode: 'debounce', intervalMs }`, or `{ mode: 'coalesce', windowMs, key, merge }`. Inspect suppressed events via `protocol.droppedCount(type)`. Passthrough events still go through the burst rate-limiter as a last-resort cascade guard.

---

## What's half-built (don't assume working)

- [features/hero-pretext.js](features/) — flag-gated, not core
- [editor/](editor/) — GLB export + material editor exist, agent-system integration minimal
- ERC-8004 reputation/validation — hooked but no UI
- Memory `encrypted-ipfs` mode — stub
- `avatar-chat` inline layout — fully wired. Walk clip, thought bubble, stream events all connected. See `prompts/avatar-chat/` for remaining polish items.
- Privy integration — functions exist, no full auth flow in element.js
- Avatar Creator save-to-account — may not persist in all flows
- Avatar Creator now wraps the Ready Player Me iframe. Configure the subdomain via `VITE_RPM_SUBDOMAIN`; falls back to `demo.readyplayer.me`.

---

## Adding things

**New action type:** add to `ACTION_TYPES` in [agent-protocol.js](agent-protocol.js), emit at source, subscribe in consumers. Update the event vocabulary table above.

**New built-in tool:** add to `BUILTIN_TOOLS` array + `BUILTIN_HANDLERS` in [runtime/tools.js](runtime/tools.js). Handler signature: `async (args, ctx) => ({ ok: true, ... })`.

**New skill:** bundle under [skills/](skills/). See /CLAUDE.md "Canonical patterns → New agent skill" for the 5-step recipe.

**New URL hash param:** parse in [app.js](app.js) next to existing keys. Don't invent a new routing layer.
