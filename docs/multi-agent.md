# Multi-Agent Scenes

A multi-agent scene loads two or more `<agent-3d>` characters simultaneously, each with its own brain, memory, and persona, sharing a common stage. Use cases include:

- A debate between two AI characters
- A customer support agent paired with a product expert
- An educational scene with a teacher and a student
- A marketplace with multiple vendor agents
- An interview panel

This guide covers the two main approaches, a **shared stage** (one coordinated scene, recommended) and **side-by-side embeds** (independent elements), plus agent communication, one-voice-at-a-time speech, turn-based conversations, orchestration patterns, memory sharing, and performance limits.

---

## The simplest setup: `<agent-stage>`

The `<agent-stage>` element is a shared scene host. Every `<agent-3d>` child registers with it as soon as its brain boots, which gives the agents a common address book (`observe_agents`, `say_to_agent`), a shared event bus (`broadcast`), and a single speaking queue so only one of them talks at a time.

> **Rendering today:** each child still draws its own body in its own canvas, laid out by the stage's formation. Sharing one WebGL context across the children's bodies is specified in [specs/STAGE_SPEC.md](https://github.com/nirholas/three.ws/blob/main/specs/STAGE_SPEC.md) but not yet wired, so count one context per child when you plan a page (see [WebGL context limits](#webgl-context-limits)).

```html
<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js"></script>

<agent-stage id="stage" formation="row" style="width:100%;height:540px">
  <agent-3d
    id="leo"
    name="Coach Leo"
    body="https://three.ws/avatars/xbot.glb"
    instructions="You are Coach Leo. Friendly, short answers."
    eager
  ></agent-3d>

  <agent-3d
    id="mira"
    name="Mira"
    body="https://three.ws/avatars/realistic-female.glb"
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
| `freeform` | All overlapping at origin; position manually |

Each `<agent-3d>` child keeps its own brain, memory, and chat chrome. Setting `brain="none"` gives an agent a live avatar with animations and emotions but no LLM, useful for characters that only react, or that you drive programmatically.

See the full working example:
[`examples/two-agents.html`](https://github.com/nirholas/three.ws/blob/main/examples/two-agents.html).
The `examples/` directory ships with the repo rather than the site, so run it
with `npm run dev` and open `http://localhost:3000/examples/two-agents.html`.

---

## Alternative: side-by-side embeds

If you don't need a shared 3D space, you can place two independent `<agent-3d>` elements anywhere on the page. Each creates its own WebGL context and is completely self-contained.

```html
<div style="display:flex;gap:16px">
  <agent-3d
    id="host"
    body="https://three.ws/avatars/michelle.glb"
    instructions="You are Aria, the host."
    style="width:300px;height:400px"
    eager
  ></agent-3d>

  <agent-3d
    id="guest"
    body="https://three.ws/avatars/xbot.glb"
    instructions="You are Leo, the guest."
    style="width:300px;height:400px"
    eager
  ></agent-3d>
</div>
```

This approach is simpler to set up but costs two WebGL contexts. Read the [WebGL context limits](#webgl-context-limits) section before using it on mobile or with more than a few agents.

---

## Making agents communicate

By default, each agent's brain is isolated. To make agents interact, use the host page as coordinator.

### Using `stage.routeMessage()`

When agents live inside an `<agent-stage>`, use `routeMessage` to send one agent's reply directly to another:

```js
const stage = document.getElementById('stage');
const leo   = document.getElementById('leo');

leo.addEventListener('brain:message', async (e) => {
  if (e.detail.role !== 'assistant') return;
  const said = e.detail.content;

  // Forward what Leo said to Mira
  const reply = await stage.routeMessage('leo', 'mira', said);
  console.log('Mira replied:', reply.reply);
});
```

`routeMessage(fromId, toId, text, { priority })` prefixes the message with `[from leo]` so the receiving agent knows who is speaking. The target's spoken reply goes through the stage's speaking queue at `priority` (default `'user'`), so it plays after whatever Leo is saying instead of over it. It returns `{ ok: true, reply: '...' }` on success, `{ ok: false, error: 'No agent "x" on stage' }` for an unknown id, or `{ ok: false, error: 'Agent "x" did not reply' }` when the target produced no text.

### Using `stage.broadcast()`

`broadcast(fromId, event)` sends a custom event payload to every other agent on stage. Each target agent receives a `stage:message` DOM event:

```js
// Fire a cue to all agents on stage
stage.broadcast('test-harness', { kind: 'cue', text: 'Start the debate.' });

// Each child agent-3d receives:
leo.addEventListener('stage:message', (e) => {
  console.log(e.detail.from, e.detail.event);
  // → "test-harness" { kind: "cue", text: "Start the debate." }
});
```

`broadcast` is useful for scene cues that every agent should react to: a director's "action" call, a timed stage event, or a user interaction that should affect all characters simultaneously.

### Bridging side-by-side embeds manually

For standalone `<agent-3d>` elements without an `<agent-stage>`, bridge agents through the `brain:message` event:

```js
const host  = document.getElementById('host');
const guest = document.getElementById('guest');

host.addEventListener('brain:message', async (e) => {
  if (e.detail.role !== 'assistant') return;

  // Pass the host's reply into the guest's context
  await guest.say(`Host said: "${e.detail.content}". How do you respond?`);
});
```

The `brain:message` event fires for both `role: "user"` and `role: "assistant"` turns. Always check `e.detail.role` before triggering the other agent, or you will create a feedback loop.

---

## Turn-based conversation

To automate a full back-and-forth between two agents, use `ask()`, which sends a message and returns the reply text, inside a recursive turn loop:

```js
const agents = [leo, mira];
let turn = 0;

async function nextTurn(previousSpeech) {
  if (turn >= 10) return; // limit to 10 turns

  const speaker = agents[turn % 2];
  const prompt  = turn === 0
    ? 'Start the conversation with a greeting.'
    : `The other character said: "${previousSpeech}". Respond to them.`;

  const reply = await speaker.ask(prompt);
  turn++;

  // Brief pause so TTS and animations finish before the next prompt
  await new Promise(r => setTimeout(r, 1500));
  nextTurn(reply);
}

// Start once both agents are ready
let readyCount = 0;
for (const el of [leo, mira]) {
  el.addEventListener('agent:ready', () => {
    if (++readyCount === 2) nextTurn('');
  }, { once: true });
}
```

`ask(text)` is a convenience wrapper around `say(text)` that resolves to the assistant's reply string. `say()` itself resolves to `{ text }` when the turn completes. Calls made while a turn is running are queued: the newest waiting call replaces any older waiting one (the replaced call resolves `null`), so a loop never stacks up stale prompts. A turn that fails (rate limit, network) also resolves `null` and shows the error in the agent's chat pane; check for `null` in production loops.

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
  // Fires whenever broadcast() is called
  console.log('broadcast from', e.detail.from, e.detail.event);
});
```

`stage:speaking-change` fires every time the floor changes hands. `detail.speaking` is the line now playing (or `null` when the stage falls silent) and `detail.previous` is the line that just ended:

```js
stage.addEventListener('stage:speaking-change', (e) => {
  const { speaking, previous } = e.detail;
  // speaking: { agentId, text, priority, startedAt } | null
  spotlight(speaking?.agentId ?? null);
});
```

You can inspect and modify the agent lineup at runtime:

```js
// Query who's on stage
stage.getAgents();
// → [{ agentId: 'leo', name: 'Coach Leo', position: [-0.55, 0, 0], element }, ...]
// agentId is the element's id attribute, or the manifest name when it has none.

// Add a new agent dynamically
const el = await stage.addAgent({ name: 'Extra', body: { uri: 'https://three.ws/avatars/mannequin.glb' } });

// Remove by agentId
stage.removeAgent('leo');
```

---

## One voice at a time: the speaking queue

Every agent has its own text-to-speech engine, and browsers will happily play two at once. Inside an `<agent-stage>` that never happens: everything an agent says out loud (its replies when `voice` is on, the `speak` skill, a `say_to_agent` reply, or your own `stage.speak()` call) waits in one queue and plays when the line in front of it ends.

```js
// Both agents answer a cue. Both lines are requested at the same instant;
// the stage plays them one after the other.
for (const el of [leo, mira]) {
  el.addEventListener('stage:message', async (e) => {
    if (e.detail.event?.kind !== 'cue') return;
    const outcome = await stage.speak(el.stageAgentId, `Ready for ${e.detail.event.text}.`, {
      priority: 'broadcast',
    });
    // outcome.status: 'spoken' | 'dropped' | 'cancelled' | 'error' | 'timeout'
  });
}
stage.broadcast('director', { kind: 'cue', text: 'scene two' });
```

| Priority | Use for | Order |
|---|---|---|
| `user` | A person spoke to this agent, or another agent did through `say_to_agent` | Plays first |
| `broadcast` | A cue every agent answers | After waiting `user` lines |
| `ambient` | Idle chatter, scripted asides, the `speak` skill | Last; first to be evicted when the queue is full |

The rules that matter in practice:

- A higher priority line jumps the waiting lines, never the agent already talking.
- The same agent asking to say the same line twice gets one utterance (the second request shares the first one's outcome).
- At most 8 lines wait. When full, the oldest `ambient` line is dropped to make room, then a `user` line may bump the oldest `broadcast` line; otherwise the new line resolves `dropped`.
- A voice that errors or never finishes is settled (`error` or `timeout`) and the queue moves on, so one broken engine cannot silence the scene.
- Removing an agent, or calling `el.pause()`, cancels its waiting lines and stops its current one.

Read the floor at any time with `stage.speaking` (the current line) and `stage.speechQueue` (waiting lines in play order), and cancel an agent's lines with `stage.cancelSpeech(agentId)`. The full contract is in [specs/STAGE_SPEC.md](https://github.com/nirholas/three.ws/blob/main/specs/STAGE_SPEC.md#speaking-queue).

---

## Orchestration patterns

Three patterns cover most multi-agent scenes:

**Pattern A: parallel (independent)**

Both agents receive the same user message and respond independently. Good for showing different perspectives or running an agent comparison side by side.

```
User message → broadcast to both → both respond concurrently
```

Implementation: call `leo.say(text)` and `mira.say(text)` without waiting for either to finish. Both brains run in parallel.

**Pattern B: sequential (turn-based)**

Agents alternate, each responding to what the other said. Good for debates, interviews, or structured storytelling. The turn-loop above implements this pattern.

```
User → Agent 1 → Agent 2 → Agent 1 → ...
```

**Pattern C: hierarchical (manager + specialists)**

One manager agent receives all user input, decides which specialist to involve, and synthesizes the result. Good for complex domains where no single agent has complete knowledge: for example, a triage agent routing medical questions to a pharmacology specialist and a symptoms specialist separately.

```
User → Manager (routes) → Specialist → Manager (synthesizes) → User
```

Implement Pattern C by giving the manager agent a custom skill that calls `stage.routeMessage()` to query a specialist, then incorporates the returned text into its own final reply.

---

## Agent-to-agent context sharing

Agents don't share memory by default. Each agent's memory is namespaced to its `name` or `agent-id`. To inject information from one agent's conversation into another's context, write to the target agent's memory explicitly:

```js
leo.addEventListener('brain:message', async (e) => {
  if (e.detail.role !== 'assistant') return;

  // Write Leo's reply into Mira's memory so she has context
  await mira.memory.note('shared_context', { from: 'leo', text: e.detail.content });
});
```

For a fully shared starting point, point both agents at the same pinned IPFS memory bundle in their manifests:

```json
{
  "memory": {
    "mode": "ipfs",
    "namespace": "shared-scene-001"
  }
}
```

Both agents then load the same memory bundle at boot. Runtime writes stay in each agent's own session, so for live sharing during a conversation use the host-page bridge above (`memory.note` into the other agent), or register a custom backend (`Memory.registerBackend`) that both agents point at. Avoid `encrypted-ipfs` for shared scenes: its key is derived from one wallet's signature, so two agents can only share it if they share the same wallet-derived key.

---

## WebGL context limits

Browsers cap the number of active WebGL contexts per page. The typical limit is **8 to 16 on desktop**, and as low as **4 on mobile**. Exceeding it causes older contexts to be silently lost: avatars freeze or disappear without an error.

**Count one context per rendered agent today, stage or not.** Children of an `<agent-stage>` still render their own bodies (sharing one context is specified but not yet wired), so the stage's advantage over side-by-side embeds is coordination (shared tools, broadcast, one voice at a time), not context count.

Every rendered `<agent-3d>` consumes its own context. Keep the total count low (3 or 4 at most) on pages that also use other WebGL libraries such as maps, data visualizations, or other 3D widgets.

To release a context when an agent is no longer needed:

```js
el.destroy(); // tears down the runtime and releases the WebGL context
el.remove();  // remove from DOM
```

**Test on actual mobile hardware.** Browser DevTools emulation does not enforce the lower context limits that real mobile devices impose.

---

## Performance considerations

Running multiple LLM connections simultaneously is expensive, especially when most agents are idle at any given moment.

**Recommendations:**

- Set `brain="none"` on agents that only react (animations, emotion blends) rather than generate text. The avatar and empathy layers are cheap; the LLM layer is not.
- Call `el.pause()` on agents waiting for their turn in a sequential scene. This cancels any in-progress TTS and STT. Call `el.say()` to resume when it's their turn again.
- Avoid turn loops that fire without a delay. On a stage you do not need a delay for speech: the speaking queue already holds each line until the previous one ends. Without a stage, add at least 1 to 1.5 seconds between turns so TTS and animations finish before the next prompt starts.
- On mobile, prefer `formation="row"` with two agents maximum. Each child currently renders its own body, so GPU work grows with the number of agents on screen.
- Past four agents on one page, give the extra characters `brain="none"` and keep them off screen until needed, because each rendered child holds its own WebGL context today (see [WebGL context limits](#webgl-context-limits)).

---

## Walking through the example

Run `npm run dev` and open `http://localhost:3000/examples/two-agents.html`
([source](https://github.com/nirholas/three.ws/blob/main/examples/two-agents.html))
to see a complete, runnable scene with real avatar files. Key things to notice:

1. **Single `<agent-stage>` with `formation="row"`**: both agents register with the stage as soon as their brains boot. The log shows each `joined` event.
2. **Both agents have `brain="free"` and `voice`**: each has its own persona and its own voice, and Leo's instructions tell him to use `say_to_agent` when asked to talk to Mira.
3. **"Send to Leo" calls `leo.say(text, { voice: true })`**: only Leo hears you. Ask him to say hi to Mira and the log shows the `say_to_agent` tool call, Mira's reply, and Leo relaying it, with Mira's spoken line queued behind Leo's.
4. **"Broadcast" calls `stage.broadcast('director', { kind: 'cue', text })`**: both agents receive `stage:message` and both answer with `stage.speak(..., { priority: 'broadcast' })` at the same instant. The "On the floor" bar and the log's `floor:` lines show the stage playing them one after the other.
5. **The floor bar subscribes to `stage:speaking-change`**: it names the agent holding the floor and lists who is waiting, and every change is timestamped in the log.

To turn this into a full dialogue scene, wire Leo's `brain:message` listener to call `stage.routeMessage('leo', 'mira', said)` after each of his replies. Speech ordering is already handled by the stage.

---

## Related

- [Agent system](/docs/agent-system): the runtime, protocol bus, and stage-scoped tools
- [How three.ws works](/docs/how-it-works): the embed boot sequence each `<agent-3d>` follows
- [Memory system](/docs/memory): namespaces and custom backends for shared context
- [Layers](/docs/layers): where `<agent-stage>` sits in the embed layer
