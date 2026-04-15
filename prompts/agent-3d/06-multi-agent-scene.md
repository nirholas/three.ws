# Task 06 — Multi-agent shared scene

## Context

A single `<agent-3d>` renders one agent in its own shadow-DOM canvas. But the vision (per [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) + project direction) is **multiple agents meeting in one scene**: an on-chain-identified agent A can mount, then discover agent B via the ERC-8004 registry, fetch B's manifest, and `scene.mount(B)` — bringing B's body into the same WebGL context.

Today there is no Scene-level API; each `<agent-3d>` is isolated. We need a way to share a Three.js scene graph, a single render loop, and a coordination protocol between multiple agents rendered in the same canvas.

## Goal

Introduce `<agent-stage>` — a parent element that hosts one canvas and zero-or-more `<agent-3d>` children. Child agents attach to the parent scene instead of creating their own.

## Deliverable

1. **`<agent-stage>` element** in `src/stage-element.js` (new file):
	 - Creates its own `Viewer` instance (one per stage). All child `<agent-3d>` elements detect the parent and attach their body to the stage's scene rather than creating a new Viewer.
	 - Manages shared orbit controls, lighting, environment map.
	 - Positions children along a default formation (row, circle, freeform) — `formation="row"` attribute.
	 - Exposes `stage.addAgent(manifest)` / `stage.removeAgent(agentId)` JS API in addition to declarative children.
2. **Modify [src/element.js](../../src/element.js)**:
	 - In `_boot()`, detect `this.closest('agent-stage')`. If present, skip creating a local Viewer — use the parent stage's Viewer, scope the body under a per-agent `Group`, and use a sub-canvas-rect for chat chrome.
	 - When detached, fall back to solo mode.
3. **Cross-agent messaging**:
	 - Add `stage.broadcast(from, event)` — in-process event dispatch visible to all child agents.
	 - Add a built-in tool `observe_agents` to each agent's tool list (scoped by a new `tools` flag in manifest or stage opt-in), returning `[{ agentId, name, position }]` for other agents on the same stage.
	 - Add a built-in tool `say_to_agent(agentId, text)` that routes a message to another agent's runtime as a user-turn-from-agent-X.
4. **Positioning**:
	 - `SceneController` gains `setGroup(group: Three.Group)` to scope all its operations to a sub-group.
	 - Each child agent's GLB loads into its own Group; bounding-box normalized to a common human height (uses `manifest.body.boundingBoxHeight`); positioned per `formation`.
5. **Spec updates**:
	 - New `specs/STAGE_SPEC.md` describing the element, formation options, messaging protocol, event names (`stage:agent-joined`, `stage:agent-left`, `stage:message`).
	 - Link from [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) under a new "Multi-agent" section.

## Audit checklist

- [ ] A page with `<agent-stage><agent-3d/><agent-3d/></agent-stage>` renders both avatars in one canvas at 60fps on a modern laptop.
- [ ] Each child agent has its own Runtime + Memory + Skills — isolated brains, shared body-pool.
- [ ] Each child's chat chrome is anchored to a sub-rect near its body, not overlapping other agents' chrome.
- [ ] A single orbit-controls instance manages the camera; each agent does not fight for camera control.
- [ ] `stage.broadcast()` reaches all other agents but not the sender by default.
- [ ] `observe_agents` tool returns correct positions + names.
- [ ] `say_to_agent` routes a message, triggers the target's runtime, and the reply is rendered in the target's chrome.
- [ ] A child detached from the stage (removed from DOM) cleans up its Group without leaking Three.js resources.
- [ ] Solo mode still works — `<agent-3d>` outside a stage behaves exactly as before.

## Constraints

- Only one Viewer/WebGL context per page — never two canvases side by side for this feature.
- Do not require a stage to have two children — a single-child stage is a valid, if wasteful, configuration. Don't refuse.
- Shadow DOM per element stays isolated; the chat pane of agent A is not accessible to agent B.
- Do not use global state (`window.__stageRegistry`) for messaging — use DOM events bubbling from the stage.

## Verification

1. `node --check src/stage-element.js`.
2. `npm run build:lib` passes.
3. Author a demo in `examples/two-agents.html`: Coach Leo + a second agent (can be another GLB with brain="none") on the same stage, formation="row". Confirm both render, both talk when prompted, and broadcast messages propagate.
4. Memory test: devtools > Performance → record 30s of both agents idling, confirm no frame drops and stable memory.

## Scope boundaries — do NOT do these

- Do not implement cross-origin agent discovery over the network in this task (agent A fetching agent B from a different site). That's the registry task.
- Do not try to interleave voice — if two agents try to TTS simultaneously, queue them per-stage or document the conflict and move on.
- Do not add a "camera follows active speaker" cinematic — separate follow-up.
- Do not add multiplayer/remote-presence — this is local-scene only.

## Reporting

- Frame-rate with 1 / 2 / 3 / 5 agents on a modern laptop and a mobile browser.
- Memory-controller approach used for chrome positioning (projection to screen space, or per-agent anchor Group).
- Any physics/collision choices if agents overlap (likely: none; positions are chosen, agents don't walk).
- Whether the `formation` values you shipped are enough (row, circle) or if you proposed a third (grid, orbit).
