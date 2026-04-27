# Agent Task: Write "Multi-Agent Scenes" Documentation

## Output file
`public/docs/multi-agent.md`

## Target audience
Developers building scenes with multiple three.wss — like a panel discussion, a marketplace with multiple characters, or a game. Covers how to run multiple `<agent-3d>` elements, have them interact, and share a stage.

## Word count
1200–2000 words

## What this document must cover

### 1. What is a multi-agent scene?
A scene with two or more agents loaded simultaneously. Use cases:
- A debate between two AI characters
- A customer support agent and a product expert
- An educational scene with a teacher and a student character
- A marketplace with multiple vendor agents
- An interview panel

### 2. The simplest multi-agent setup
Multiple `<agent-3d>` elements on the same page — each is independent:

```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>

<div style="display:flex;gap:16px">
  <!-- Agent 1: Host -->
  <agent-3d
    id="host"
    agent-id="aria-host"
    style="width:300px;height:400px"
  ></agent-3d>

  <!-- Agent 2: Guest -->
  <agent-3d
    id="guest"
    agent-id="leo-guest"
    style="width:300px;height:400px"
  ></agent-3d>
</div>
```

Reference the working example at `/examples/two-agents.html`.

### 3. Making agents communicate
By default, agents are isolated. To make them interact, use the host page as the coordinator:

```js
const host = document.getElementById('host');
const guest = document.getElementById('guest');

// When host speaks, guest reacts
host.addEventListener('agent-speak', async e => {
  const hostSaid = e.detail.text;

  // Tell guest what the host said (they hear it as context)
  await guest.sendMessage(`[Host said: "${hostSaid}"] — How do you respond?`);
});
```

### 4. Turn-based conversation
Automate a conversation between two agents:

```js
const agents = [host, guest];
let turn = 0;

async function nextTurn(previousSpeech) {
  const current = agents[turn % 2];
  const other = agents[(turn + 1) % 2];

  const prompt = turn === 0
    ? 'Start the conversation with a greeting'
    : `The other agent said: "${previousSpeech}". Respond to them.`;

  const response = await current.sendMessage(prompt);
  turn++;

  // After agent responds, wait 1s and trigger next turn
  current.addEventListener('agent-speak', async e => {
    if (turn < 10) { // limit to 10 turns
      await new Promise(r => setTimeout(r, 1500));
      nextTurn(e.detail.text);
    }
  }, { once: true });
}

// Start the conversation
guest.addEventListener('ready', () => nextTurn(''));
host.addEventListener('ready', () => {});
Promise.all([host.ready, guest.ready]).then(() => nextTurn(''));
```

### 5. Shared stage concept
For more control, use a shared three.js scene — one renderer, multiple agent avatars. This is more advanced (requires custom integration) but allows:
- Agents to look at each other (gaze tracking)
- Physically positioned in the same 3D space
- Shared environment/lighting
- More performant (one WebGL context)

This requires using the viewer API directly rather than the web component:
```js
import { Viewer } from '@3dagent/sdk/viewer';
import { AgentAvatar } from '@3dagent/sdk/avatar';

const viewer = new Viewer({ canvas });
const avatar1 = await viewer.loadGLB('./aria.glb');
const avatar2 = await viewer.loadGLB('./leo.glb');

// Position them
avatar1.position.set(-1, 0, 0);
avatar2.position.set(1, 0, 0);

// Gaze at each other
avatar1.lookAt(avatar2.position);
avatar2.lookAt(avatar1.position);
```

### 6. WebGL context limits
Browsers limit the number of WebGL contexts per page (typically 8-16). Each `<agent-3d>` element creates its own context. For scenes with many agents:
- Use the shared stage approach (one context)
- Or use iframe embeds (each iframe has its own context limit)
- Destroy unused contexts: `el.remove()` and `delete el`

On mobile, context limits are lower (often 4). Test on actual devices.

### 7. Performance considerations
Running multiple LLM runtimes is expensive:
- Each agent with `brain` enabled maintains a separate LLM connection
- Consider running only the "speaking" agent's brain at a time
- Use the `NullProvider` for non-speaking agents (avatar + emotion only, no LLM)
- Or share one LLM brain and route responses to different avatars

Architecture for shared brain:
```js
// One LLM brain, two avatars
const brain = new AgentRuntime({ provider: 'anthropic', ... });
brain.addEventListener('speak', e => {
  // Route to the right avatar based on context
  const targetAgent = e.detail.speaker === 'aria' ? host : guest;
  targetAgent.speak(e.detail.text);
});
```

### 8. The two-agents example
Reference the full working example at `/examples/two-agents.html`. Walk through it:
- Two agents loaded side by side
- Simple event bridge connecting them
- Shows turn-taking pattern
- Explains how to customize for your use case

### 9. Orchestration patterns
Three patterns for multi-agent orchestration:

**Pattern A: Parallel (independent):**
Both agents run independently, react to the same user input.
```
User message → broadcast to both agents → both respond
```
Good for: showing different perspectives, agent comparison.

**Pattern B: Sequential (turn-based):**
Agents take turns responding to each other and the user.
```
User → Agent 1 → Agent 2 → Agent 1 → ...
```
Good for: debates, interviews, storytelling.

**Pattern C: Hierarchical (manager + specialists):**
One "manager" agent routes requests to specialist agents.
```
User → Manager → picks specialist → specialist responds → manager synthesizes
```
Good for: complex domains where no single agent has all knowledge.

### 10. Agent-to-agent context sharing
Agents don't share memory by default. To share context:
```js
// After Agent 1 remembers something
host.addEventListener('agent-remember', async e => {
  // Share the memory with Agent 2
  await guest.agent.memory.write('shared', e.detail.key, e.detail.value);
});
```

Or use a shared IPFS memory namespace:
```json
{
  "memory": {
    "mode": "ipfs",
    "namespace": "shared-scene-001"  // both agents use same IPFS namespace
  }
}
```

## Tone
Technical guide. Practical examples. The two-agents.html example is the most valuable reference — make sure to direct readers to it. Be honest about WebGL context limits.

## Files to read for accuracy
- `/examples/two-agents.html` — complete working example
- `/src/element.js` — web component isolation model
- `/src/runtime/index.js` — LLM runtime (for shared brain pattern)
- `/src/agent-memory.js` — memory sharing
- `/src/viewer.js` — for shared stage pattern
