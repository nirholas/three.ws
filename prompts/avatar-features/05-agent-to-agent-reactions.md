# Feature: Agent-to-Agent Reactions

## Goal
When Bob roasts Alice, Alice's avatar should physically react — not just stand idle until her next turn. Cross-agent reactions make multi-agent scenes feel like actual people in the same room rather than two chatbots taking turns.

## Context

**`agent-voice-chat/agents.config.json`** — defines Bob and Alice as two separate agents, each with their own personality, voice, and avatar.

**`src/agent-protocol.js`** — each agent instance has its own `AgentProtocol` bus. Currently there is no cross-agent event forwarding.

**`src/agent-avatar.js`** — `AgentAvatar` listens to its own agent's protocol. It has no awareness of other agents.

**`agent-voice-chat/server.js`** or `src/element.js`** — where multiple agent instances are likely instantiated. This is where we can wire cross-agent reactions without modifying the avatar layer.

## Architecture

Don't add cross-agent coupling inside `AgentAvatar`. Instead, create a thin **reaction bridge** that listens to agent A's protocol and emits targeted stimuli on agent B's protocol. The bridge lives outside both agents.

### 1. Create `src/agent-reaction-bridge.js`

```js
/**
 * AgentReactionBridge — forwards emotional triggers cross-agent.
 *
 * When agentA speaks, agentB's avatar gets a stimulus proportional
 * to how "directed" the speech is (detected via name mention or sentiment).
 */
export class AgentReactionBridge {
    /**
     * @param {import('./agent-protocol.js').AgentProtocol} sourceProtocol
     * @param {import('./agent-protocol.js').AgentProtocol} targetProtocol
     * @param {string} targetName  — e.g. "Alice", used for mention detection
     */
    constructor(sourceProtocol, targetProtocol, targetName) { ... }

    attach() { ... }   // subscribe to source events
    detach() { ... }   // unsubscribe
}
```

### 2. Reaction rules (implement in `attach()`)

Subscribe to `ACTION_TYPES.SPEAK` on `sourceProtocol`. On each speak event:

**Name mention** (`text.toLowerCase().includes(targetName.toLowerCase())`):
- Inject `curiosity: 0.6` on target (they look up / take notice)
- If sentiment < -0.3 (roast): also inject `concern: 0.3` (mock-defensive posture)
- If sentiment > 0.4 (praise): inject `celebration: 0.4`

**No name mention but high arousal** (agent is animated/excited):
- Inject `curiosity: 0.2` on target — ambient awareness of the other agent being loud

**Reaction gesture** (optional, only if a `react` slot exists):
```js
targetProtocol.emit(ACTION_TYPES.GESTURE, { name: 'react', duration: 0.8 });
```

Use `targetProtocol.emit()` to inject — the target avatar's `_onEmote` and `_onGesture` handlers already handle these.

### 3. Gaze direction during cross-agent speech

When a `SPEAK` event comes from the *other* agent, the listener's avatar should look toward that agent's position in 3D space (not at the camera).

Add an optional `targetPosition: Vector3` to the bridge constructor. When source speaks and target has a position:
```js
targetProtocol.emit(ACTION_TYPES.LOOK_AT, { target: 'agent', worldPosition: this._sourcePosition });
```

You'll need to add `'agent'` as a valid `look-at` target in `AgentAvatar._onLookAt()`:
```js
} else if (target === 'agent' && action.payload?.worldPosition) {
    const p = action.payload.worldPosition;
    this._lookTarget = new Vector3(p.x, p.y, p.z);
}
```

### 4. Wire the bridge where agents are instantiated

Find where Bob and Alice's `AgentProtocol` instances are created (likely in `agent-voice-chat/server.js` or the room manager). Add:

```js
const bobToAlice = new AgentReactionBridge(bobProtocol, aliceProtocol, 'Alice');
const aliceToBob = new AgentReactionBridge(aliceProtocol, bobProtocol, 'Bob');
bobToAlice.attach();
aliceToBob.attach();
```

Detach when agents are destroyed.

### 5. Throttle cross-agent reactions

Add a `_lastReactionAt` timestamp to the bridge. Minimum 800ms between reactions per source speak event — prevents rapid-fire stimuli when the agent speaks quickly.

## Testing
- Load the two-agent scene (Bob + Alice)
- Say something to Bob that mentions Alice
- Alice's avatar should show a curiosity/reaction without Alice speaking
- Bob saying something sarcastic ("Alice is being dramatic again") → Alice shows mild concern morph

## Conventions
- ESM only, tabs 4-wide
- The bridge is purely additive — it only injects stimuli, never suppresses or overrides
- Don't modify `AgentAvatar` internals except to add the `'agent'` look-at case
- Update `src/CLAUDE.md` event vocabulary if you add new look-at targets
