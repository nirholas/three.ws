# Stage Spec v0.1 — `<agent-stage>` shared scene

A parent element that hosts one Three.js scene (one WebGL context) for multiple `<agent-3d>` children, letting several agents meet in the same room without paying for N renderers.

```html
<agent-stage formation="row">
	<agent-3d src="agent://base/42"></agent-3d>
	<agent-3d manifest="./coach-leo/manifest.json"></agent-3d>
</agent-stage>
```

A single-child stage is valid; a zero-child stage is valid (empty room). Stages nest inside normal page layout (`inline` by default); the children's `mode=` attribute has no effect inside a stage.

## Attributes

| Attribute | Values | Default | Notes |
|---|---|---|---|
| `formation` | `row` \| `circle` \| `freeform` | `row` | Arrangement of children in 3D + screen-space sub-rects. |

Additional scene attributes (`environment`, `camera-controls`, `shadows`, …) mirror `<agent-3d>` and may be added in a later version.

## Children

Every `<agent-3d>` element that is a descendant of an `<agent-stage>` at boot time:

1. Skips creating its own `Viewer` / `WebGLRenderer`. The stage's single `Viewer` is reused.
2. Loads its body GLB into a per-agent `Group`, normalised by `body.boundingBoxHeight` to a common human scale.
3. Gets its own `AnimationMixer` attached to that group — animations are isolated per agent.
4. Keeps its full shadow DOM chrome (chat pane + input + mic). Chrome is anchored to a stage-assigned sub-rect so it doesn't collide with other agents' chrome.
5. Keeps its own `Runtime`, `Memory`, `SkillRegistry` — brains are isolated, bodies share one context.

Detach a child from the DOM and its Group is removed from the scene with its textures / geometries / mixer disposed; the sibling agents keep rendering.

An `<agent-3d>` outside any `<agent-stage>` falls back to solo mode and behaves exactly as before.

## Formations

| Value | 3D layout | DOM sub-rect layout |
|---|---|---|
| `row` | evenly spaced along the X axis (`spacing = 1.1m`) | vertical slices, equal width |
| `circle` | evenly spaced around the Y axis on a radius scaled by agent count | vertical slices, equal width |
| `freeform` | all groups at origin — caller positions via JS | each child fills the stage |

The `row` and `circle` values are sufficient for most meeting-style layouts. A `grid` value may be added if 6+ agent scenes become common — propose it with a demo.

## JS API

```ts
interface AgentStageElement extends HTMLElement {
	formation: 'row' | 'circle' | 'freeform';
	viewer: Viewer;                                 // the shared three.js Viewer
	addAgent(manifest: object): Promise<HTMLElement>;
	removeAgent(agentId: string): void;
	getAgents(): Array<{ agentId, name, position: [x,y,z], element }>;
	broadcast(fromId: string, event: unknown): void;  // fires 'stage:message' on siblings
	routeMessage(fromId, toId, text): Promise<{ ok, reply?, error? }>;
}
```

`addAgent(manifest)` accepts an inline manifest object (no fetch). It is equivalent to `document.createElement('agent-3d')` + manual wiring, and returns the element once registered.

## Events

All events bubble and are `composed: true`.

| Type | Detail | Fired on |
|---|---|---|
| `stage:agent-joined` | `{ agentId, element, manifest }` | stage |
| `stage:agent-left` | `{ agentId, element }` | stage |
| `stage:message` | `{ from, event }` | stage (and each non-sender child when using `broadcast`) |

`broadcast(fromId, event)` fires `stage:message` on every `<agent-3d>` except the sender, and once on the stage itself. The payload is opaque — the message protocol is whatever the agents in the stage agree on.

## Built-in tools (stage-scoped)

When a `Runtime` is attached to a stage, two extra tools are appended to its tool list automatically. They are not present in solo mode.

### `observe_agents`
Returns `{ ok: true, agents: [{ agentId, name, position }] }` listing every other agent on the stage (the caller is excluded).

### `say_to_agent(agentId, text)`
Routes `text` into the target agent's runtime as a user turn formatted `[from <callerId>] <text>`. Also fires a `stage:message` broadcast with `{ kind: 'direct', to: agentId, text }` so spectators can observe the exchange.

Returns `{ ok: true, reply }` where `reply` is the target's final text, or `{ ok: false, error }` on a bad id.

## Constraints

- **One `WebGLRenderer` per stage.** Never two canvases for this feature — shared context or nothing.
- **Shadow DOM per child stays isolated.** The chat pane of agent A is not reachable from agent B. Cross-agent communication flows exclusively through `stage.broadcast()` and `say_to_agent`.
- **No global registry.** Use the DOM: `element.closest('agent-stage')` is the only discovery mechanism.
- **Voice conflicts:** TTS is per-agent and not serialised across the stage. If two agents speak at the same time, browser TTS will overlap. A per-stage speaking queue is a follow-up.
- **Camera follow:** out of scope. One `OrbitControls` instance is owned by the stage; no agent fights for it.
- **Discovery over the network** (agent A fetching agent B's manifest from another site) is the registry task's job, not this one.
