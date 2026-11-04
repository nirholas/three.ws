# Stage Spec v0.2: `<agent-stage>` shared scene

A parent element that hosts one Three.js scene (one WebGL context) for multiple `<agent-3d>` children, letting several agents meet in the same room without paying for N renderers.

```html
<agent-stage formation="row">
	<agent-3d src="agent://base/42"></agent-3d>
	<agent-3d manifest="./coach-leo/manifest.json"></agent-3d>
</agent-stage>
```

A single-child stage is valid; a zero-child stage is valid (empty room). Stages nest inside normal page layout (`inline` by default); the children's `mode=` attribute has no effect inside a stage.

## Attributes

| Attribute   | Values                          | Default | Notes                                                   |
| ----------- | ------------------------------- | ------- | ------------------------------------------------------- |
| `formation` | `row` \| `circle` \| `freeform` | `row`   | Arrangement of children in 3D + screen-space sub-rects. |

Additional scene attributes (`environment`, `camera-controls`, `shadows`, …) mirror `<agent-3d>` and may be added in a later version.

## Children

Every `<agent-3d>` element that is a descendant of an `<agent-stage>` at boot time:

1. Skips creating its own `Viewer` / `WebGLRenderer`. The stage's single `Viewer` is reused.
2. Loads its body GLB into a per-agent `Group`, normalised by `body.boundingBoxHeight` to a common human scale.
3. Gets its own `AnimationMixer` attached to that group, so animations are isolated per agent.
4. Keeps its full shadow DOM chrome (chat pane + input + mic). Chrome is anchored to a stage-assigned sub-rect so it doesn't collide with other agents' chrome.
5. Keeps its own `Runtime`, `Memory`, `SkillRegistry`: brains are isolated, bodies share one context.
6. Registers with the stage on boot (`registerAgent`) under its `id` attribute, or its manifest name when it has no `id`, and unregisters when it is torn down. Registration is what gives it the stage tools and puts its voice on the stage's speaking queue.

**Implementation status (v0.2).** Steps 5 and 6 ship. Steps 1 to 4 (one shared `Viewer` for every body) do not yet: each child still boots its own viewer and renders its own body, so a stage costs one WebGL context per child plus the stage's own. Brains, tools and voice are fully stage-aware; body sharing is the remaining work, and `registerAgent` already accepts the per-agent `group` it will need.

Detach a child from the DOM and its Group is removed from the scene with its textures / geometries / mixer disposed; the sibling agents keep rendering.

An `<agent-3d>` outside any `<agent-stage>` falls back to solo mode and behaves exactly as before.

**Implementation status (v0.2).** Points 4 and 5 hold today: every child joins the stage through `registerAgent()` the moment its `Runtime` boots (`element.closest('agent-stage')`), which gives it the stage tools and the shared speaking queue. Points 1 to 3 do not yet: each child still boots its own `Viewer` and renders its own body inside its own box, and the stage viewer is empty unless a caller passes a `group` to `registerAgent()`. Body sharing is a separate piece of work; brains, voices and tools are already stage-wide.

## Formations

| Value      | 3D layout                                                         | DOM sub-rect layout          |
| ---------- | ----------------------------------------------------------------- | ---------------------------- |
| `row`      | evenly spaced along the X axis (`spacing = 1.1m`)                 | vertical slices, equal width |
| `circle`   | evenly spaced around the Y axis on a radius scaled by agent count | vertical slices, equal width |
| `freeform` | all groups at origin; the caller positions them via JS            | each child fills the stage   |

The `row` and `circle` values are sufficient for most meeting-style layouts. A `grid` value may be added if 6+ agent scenes become common; propose it with a demo.

## JS API

```ts
interface AgentStageElement extends HTMLElement {
	formation: 'row' | 'circle' | 'freeform';
	viewer: Viewer; // the shared three.js Viewer
	addAgent(manifest: object): Promise<HTMLElement>;
	removeAgent(agentId: string): void;
	getAgents(): Array<{ agentId; name; position: [x, y, z]; element }>;
	broadcast(fromId: string, event: unknown): void; // fires 'stage:message' on siblings
	routeMessage(
		fromId,
		toId,
		text,
		opts?: { priority?: SpeechPriority },
	): Promise<{ ok; reply?; error? }>;

	// Registration: every <agent-3d> child registers itself, custom agents call it directly
	registerAgent(
		element: HTMLElement,
		opts?: {
			id?: string;
			manifest?: object;
			group?: Object3D; // the body, once bodies share the stage viewer
			speak?: (text: string) => Promise<unknown>; // play one line, resolve when it ends
			stopSpeaking?: () => void; // cut the current line short
		},
	): string; // the agent id; idempotent per element
	unregisterAgent(element: HTMLElement): void;

	// Speaking queue: one voice at a time
	speak(
		agentId: string,
		text: string,
		opts?: { priority?: SpeechPriority },
	): Promise<SpeechOutcome>;
	cancelSpeech(agentId: string): number; // lines cancelled
	readonly speaking: SpeechLine | null; // the line holding the floor
	readonly speechQueue: SpeechLine[]; // waiting lines, in play order
}

type SpeechPriority = 'user' | 'broadcast' | 'ambient';
type SpeechLine = { agentId: string; text: string; priority: SpeechPriority; startedAt?: number };
type SpeechOutcome = {
	status: 'spoken' | 'dropped' | 'cancelled' | 'error' | 'timeout';
	agentId: string;
	text: string;
	priority: SpeechPriority;
	reason?: string; // why it was dropped, cancelled or timed out
	error?: string; // the speaker's error message
};
```

`addAgent(manifest)` accepts an inline manifest object (no fetch). It is equivalent to `document.createElement('agent-3d')` + manual wiring, and returns the element once registered.

## Events

All events bubble and are `composed: true`.

| Type                    | Detail                                                   | Fired on                                                 |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `stage:agent-joined`    | `{ agentId, element, manifest }`                         | stage                                                    |
| `stage:agent-left`      | `{ agentId, element }`                                   | stage                                                    |
| `stage:message`         | `{ from, event }`                                        | stage (and each non-sender child when using `broadcast`) |
| `stage:speaking-change` | `{ speaking, previous }` (each a `SpeechLine` or `null`) | stage, each time the floor changes hands                 |

`broadcast(fromId, event)` fires `stage:message` on every `<agent-3d>` except the sender, and once on the stage itself. The payload is opaque: the message protocol is whatever the agents in the stage agree on.

`stage:speaking-change` fires when a line starts, when one hands over to the next, and once with `speaking: null` when the stage falls silent. Use it to drive a "now speaking" indicator, a talking-head highlight, or captions.

## Speaking queue

Every agent on a stage owns a TTS pipeline, and browsers will play two at once. The stage owns the floor instead: an agent's voiced reply is queued on the stage and plays when the line in front of it ends. Implementation: [src/stage-speech-queue.js](../src/stage-speech-queue.js) (pure, dependency-free).

- **Priority.** `user` (someone spoke to this agent: a typed or spoken turn, or a `say_to_agent` exchange) beats `broadcast` (a stage cue every agent answers) beats `ambient` (idle chatter, skill asides, scripted lines). Within one level, first in first out.
- **Never mid-utterance.** A higher priority line jumps waiting lines only. The agent holding the floor always finishes, is cancelled, or times out.
- **De-duplication.** The same agent asking to say the same line (case and whitespace folded) while that line is waiting or playing gets the existing request back, promoted to the higher priority if it is still waiting.
- **Depth.** At most 8 lines wait. A new line in a full queue evicts the oldest `ambient` line; failing that, a `user` line evicts the oldest `broadcast` line; failing that, the new line is refused with `status: 'dropped', reason: 'queue full'`. `user` lines are never evicted.
- **Failure isolation.** A speaker that throws or rejects settles as `error`; one that never ends is cut off through `stopSpeaking` after `10s + 400ms per word` and settles as `timeout`. Either way the next line plays, so one broken voice cannot silence the stage.
- **Leaving.** Removing an agent cancels its waiting lines and stops its current one (`cancelled`, `reason: 'agent removed'`). Removing the stage cancels everything. `cancelSpeech(agentId)` does the same on demand, and an `<agent-3d>` calls it when paused.
- `speak()` never rejects; an unknown `agentId` or an agent registered without a voice resolves as `error`. An invalid `priority` throws `RangeError` synchronously.

A runtime decides the priority of its own lines: `element.say(text, { voice: true, priority })` and `runtime.send(text, { voice: true, priority })` default to `user`; `ctx.speak()` from a skill uses the turn's priority, or `ambient` outside a turn. Outside a stage, `<agent-3d>` speaks directly, exactly as before.

## Built-in tools (stage-scoped)

When a `Runtime` is attached to a stage, two extra tools are appended to its tool list automatically. They are not present in solo mode.

### `observe_agents`

Returns `{ ok: true, agents: [{ agentId, name, position }] }` listing every other agent on the stage (the caller is excluded).

### `say_to_agent(agentId, text)`

Routes `text` into the target agent's runtime as a user turn formatted `[from <callerId>] <text>`. Also fires a `stage:message` broadcast with `{ kind: 'direct', to: agentId, text }` so spectators can observe the exchange.

The target's spoken reply carries the caller's turn priority, so it queues behind whatever the caller is saying and the two never talk over each other.

Returns `{ ok: true, reply }` where `reply` is the target's final text, `{ ok: false, error: 'No agent "x" on stage' }` on a bad id, or `{ ok: false, error: 'Agent "x" did not reply' }` when the target produced no reply (no brain, or its turn failed).

## Constraints

- **One `WebGLRenderer` per stage.** Never two canvases for this feature: shared context or nothing. (The target; see the implementation status under Children.)
- **Shadow DOM per child stays isolated.** The chat pane of agent A is not reachable from agent B. Cross-agent communication flows exclusively through `stage.broadcast()` and `say_to_agent`.
- **No global registry.** Use the DOM: `element.closest('agent-stage')` is the only discovery mechanism.
- **One voice at a time.** TTS stays per agent, but every voiced line on a stage goes through the speaking queue above. A page that drives an agent's TTS directly (bypassing `say`, `send` and `stage.speak`) opts out of serialisation.
- **Camera follow:** out of scope. One `OrbitControls` instance is owned by the stage; no agent fights for it.
- **Discovery over the network** (agent A fetching agent B's manifest from another site) is the registry task's job, not this one.
