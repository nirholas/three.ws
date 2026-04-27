# Multi-Agent Scenes

A multi-agent scene loads two or more `<agent-3d>` characters simultaneously — each with its own brain, memory, and persona — sharing a common stage. Use cases include:

- A debate between two AI characters
- A customer support agent paired with a product expert
- An educational scene with a teacher and a student
- A marketplace with multiple vendor agents
- An interview panel

This guide covers the two main approaches: a **shared stage** (one WebGL context, recommended) and **side-by-side embeds** (independent contexts). It also covers agent communication, turn-based conversations, orchestration patterns, and performance limits.

---

## The simplest setup: `<agent-stage>`

The `<agent-stage>` element is a shared scene host. All `<agent-3d>` children render inside a single WebGL canvas — one renderer, one context, positioned automatically in a formation.

```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>

<agent-stage id="stage" formation="row" style="width:100%;height:540px">
  <agent-3d
    id="leo"
    name="Coach Leo"
    body="/avatars/leo.glb"
    instructions="You are Coach Leo. Friendly, short answers."
    eager
  ></agent-3d>

  <agent-3d
    id="mira"
    name="Mira"
    body="/avatars/mira.glb"
    brain="none"
    instructions="You are Mira, a quiet observer who only speaks when spoken to."
    eager
  ></agent-3d>
</agent-stage>
```

The `formation` attribute controls avatar placement:

| Value | Layout |
|---|---|
| `row` | Side by side, evenly spaced |
| `circle` | Equidistant around a centre point |
| `freeform` | All overlapping at origin — position manually |

Each `<agent-3d>` child keeps its own brain, memory, and chat chrome. Setting `brain="none"` gives an agent a live avatar with animations and emotions but no LLM — useful for characters that only react, or that you drive programmatically.

See the full working example at `/examples/two-agents.html`.

---

## Alternative: side-by-side embeds

If you don't need shared 3D space, you can place two independent `<agent-3d>` elements anywhere on the page. Each creates its own WebGL context and is completely self-contained.

```html
<div style="display:flex;gap:16px">
  <agent-3d
    id="host"
    body="/avatars/aria.glb"
    instructions="You are Aria, the host."
    style="width:300px;height:400px"
    eager
  ></agent-3d>

  <agent-3d
    id="guest"
    body="/avatars/leo.glb"
    instructions="You are Leo, the guest."
    style="width:300px;height:400px"
    eager
  ></agent-3d>
</div>
```

This approach is simpler to set up but costs two WebGL contexts. See the [WebGL context limits](#webgl-context-limits) section before using it on mobile or with more than a few agents.

---

## Making agents communicate

By default, each agent's brain is isolated. To make them interact, use the host page as a coordinator.

### Using `stage.routeMessage()`

When agents are inside an `<agent-stage>`, use `routeMessage` to send one agent's reply to another:

```js
const stage = document.getElementById('stage');
const leo   = document.getElementById('leo');

leo.addEventListener('brain:message', async (e) => {
  if (e.detail.role !== 'assistant') return;
  const said = e.detail.content;

  // Route what Leo said to Mira
  const reply = await stage.routeMessage('leo', 'mira', said);
  console.log('Mira replied:', reply.reply);
});
```

`routeMessage(fromId, toId, text)` wraps the message in `[from leo] <text>` so the target agent sees who is speaking. It returns `{ ok: true, reply: '...' }` or `{ ok: false, error: '...' }`.

### Using `stage.broadcast()`

`broadcast(fromId, event)` sends a custom event to every other agent on stage. Agents receive a `stage:message` event:

```js
// Broadcast an event from test-harness to all agents
stage.broadcast('test-harness', { kind: 'cue', text: 'Start the debate.' });

// Each agent-3d child receives:
leo.addEventListener('stage:message', (e) => {
  console.log(e.detail.from, e.detail.event);
});
```

### Using the `brain:message` event directly

For side-by-side embeds (no `<agent-stage>`), bridge agents manually via the `brain:message` event:

```js
const host  = document.getElementById('host');
const guest = document.getElementById('guest');

host.addEventListener('brain:message', async (e) => {
  if (e.detail.role !== 'assistant') return;

  // Tell guest what the host just said
  await guest.say(`Host said: "${e.detail.content}" — How do you respond?`);
});
```

---

## Turn-based conversation

To automate a back-and-forth between two agents, use `ask()` — which sends a message and returns the reply text — inside a recursive turn loop:

```js
const agents = [leo, mira];
let turn = 0;

async function nextTurn(previousSpeech) {
  if (turn >= 10) return; // limit to 10 turns

  const speaker  = agents[turn % 2];
  const prompt   = turn === 0
    ? 'Start the conversation with a greeting.'
    : `The other character said: "${previousSpeech}". Respond to them.`;

  const reply = await speaker.ask(prompt);
  turn++;

  // Brief pause, then continue
  await new Promise(r => setTimeout(r, 1500));
  nextTurn(reply);
}

// Start once both are ready
let readyCount = 0;
for (const el of [leo, mira]) {
  el.addEventListener('agent:ready', () => {
    if (++readyCount === 2) nextTurn('');
  }, { once: true });
}
```

`ask(text)` is a convenience wrapper around `say(text)` that resolves to the assistant's reply string. If the runtime is busy (e.g., the agent is still generating a previous response), `say()` throws — add a `try/catch` in production loops.

---

## Stage events

`<agent-stage>` fires lifecycle events as agents join or leave:

```js
stage.addEventListener('stage:agent-joined', (e) => {
  console.log('joined:', e.detail.agentId, e.detail.manifest?.name);
});

stage.addEventListener('stage:agent-left', (e) => {
  console.log('left:', e.detail.agentId);
});

stage.addEventListener('stage:message', (e) => {
  console.log('broadcast from', e.detail.from, e.detail.event);
});
```

You can also inspect agents at runtime:

```js
stage.getAgents();
// [{ agentId: 'Coach Leo', name: 'Coach Leo', position: [-0.55, 0, 0], element }, ...]
```

To add or remove agents dynamically:

```js
const el = await stage.addAgent({ name: 'Extra', body: { uri: '/avatars/extra.glb' } });
stage.removeAgent('Extra');
```

---

## Orchestration patterns

Three patterns cover most multi-agent scenes:

**Pattern A — Parallel (independent)**

Both agents receive the same user message and respond independently. Good for showing different perspectives or running an agent comparison side by side.

```
User message → broadcast to both → both respond concurrently
```

**Pattern B — Sequential (turn-based)**

Agents alternate, each responding to what the other said. Good for debates, interviews, or structured storytelling. The turn-loop above implements this pattern.

```
User → Agent 1 → Agent 2 → Agent 1 → ...
```

**Pattern C — Hierarchical (manager + specialists)**

One manager agent receives all user input, decides which specialist to involve, and synthesizes the result. Good for complex domains where no single agent has complete knowledge.

```
User → Manager (routes) → Specialist → Manager (synthesizes) → User
```

Implement Pattern C by giving the manager agent a tool or skill that calls `stage.routeMessage()` to query a specialist, then incorporates that reply into its own response.

---

## Agent-to-agent context sharing

Agents don't share memory by default. Each agent's memory is namespaced to its `name` or `agent-id`.

To share a fact from one agent's conversation into another's context, write it explicitly:

```js
leo.addEventListener('brain:message', async (e) => {
  if (e.detail.role !== 'assistant') return;

  // Inject Leo's reply into Mira's memory
  await mira.memory.note('shared_context', { from: 'leo', text: e.detail.content });
});
```

For a common namespace across agents, set both to the same IPFS memory namespace in their manifests:

```json
{
  "memory": {
    "mode": "ipfs",
    "namespace": "shared-scene-001"
  }
}
```

Both agents then read and write the same memory bundle. Note that the `encrypted-ipfs` mode is not yet fully wired; use plain `ipfs` for shared scenes.

---

## WebGL context limits

Browsers cap the number of active WebGL contexts per page. The typical limit is **8–16 on desktop**, often as low as **4 on mobile**. Exceeding it causes older contexts to be silently lost.

**`<agent-stage>` uses one context for all children** — this is its primary advantage. Two agents inside an `<agent-stage>` consume one context total.

Two standalone `<agent-3d>` elements each consume one context. Keep the count low (≤ 3–4) on pages that use other WebGL libraries (maps, charts, other 3D widgets).

To free a context when an agent is no longer needed:

```js
el.destroy(); // tears down the runtime and releases the WebGL context
el.remove();  // remove from DOM
```

Test on actual mobile hardware — emulation does not enforce the lower context limits.

---

## Performance considerations

Running multiple LLM connections simultaneously is expensive, especially when users are not actively talking to every agent.

**Recommendations:**

- Set `brain="none"` on agents that only react (animations, emotion blends) rather than generate responses. The avatar layer is cheap; the LLM layer is not.
- Pause idle agents' runtimes between turns. Call `el.pause()` on agents waiting for their turn, resume when needed.
- Avoid turn loops that fire without a delay — add at least 1–1.5 seconds between turns so TTS and animations can finish before the next prompt lands.
- On mobile, prefer `formation="row"` with two agents max. The shared-stage approach keeps GPU work to a single draw pass.

---

## Walking through the example

Open `/examples/two-agents.html` to see a complete, runnable scene. Key things to notice:

1. **Single `<agent-stage>` with `formation="row"`** — both agents share one canvas and one WebGL context.
2. **Leo has a brain; Mira has `brain="none"`** — Leo drives the conversation; Mira is an avatar waiting to be spoken to.
3. **"Send to Leo" button calls `leo.say(text)`** — the user's message goes only to Leo's brain.
4. **"Broadcast" button calls `stage.broadcast('test-harness', {...})`** — demonstrates the stage's event bus.
5. **The log panel subscribes to `brain:message` and `skill:tool-called`** — shows how to observe what each agent is thinking and doing.

To extend this into a full turn-based scene, add a `brain` attribute to Mira, then wire the `brain:message` listener above to call `stage.routeMessage()` after each of Leo's replies.
