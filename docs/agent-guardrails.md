# Agent guardrails

Optional checks an agent owner can turn on for their agent's chat, run on NVIDIA NemoGuard models. Status: **under evaluation**. The code ships behind each owner's own opt-in, and every check is off by default.

| Check | What it stops | Model |
|---|---|---|
| Jailbreak detection | Messages that try to make the agent ignore its instructions or persona | `nvidia/nemoguard-jailbreak-detect` (NIM security endpoint) |
| Content safety (input) | Harmful visitor messages, before the model answers | `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` |
| Content safety (output) | A reply that turns harmful partway through. It is stopped and replaced while it streams | `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` |
| Topic control | Questions outside the topics the owner listed. They get a polite redirect | `nvidia/llama-3.1-nemoguard-8b-topic-control`, falling back to `nvidia/nemotron-3.5-lightning-30b-a3b` when the topic model is not served |

Measured accuracy and latency per check: [docs/nvidia/evals/guardrails-2026-11-16.md](nvidia/evals/guardrails-2026-11-16.md).

## Turning them on

Open **Edit agent > Brain > Guardrails** (`/agents/<id>/edit?tab=guardrails`). Each check has its own switch. Topic control needs at least one allowed topic (up to 12, 120 characters each), and takes an optional redirect message (280 characters). Leave the redirect empty and the agent answers with one built from the topic list:

> That's outside what I can help with here. I'm set up to help with 3D modeling and avatars and using the three.ws editor. What would you like to know about those?

Saved settings apply to the next message. They live in `agent_identities.meta.guardrails`, and there is no migration.

The same settings over HTTP (owner only; a bearer token needs `agents:read` / `agents:write`):

```
GET /api/agents/:id/guardrails
PUT /api/agents/:id/guardrails
{ "jailbreak": true, "safety": true,
  "topics": { "enabled": true, "allowed": ["3D modeling and avatars"], "redirect": "" } }
```

`GET` returns `{ settings, redirect_preview, stats, limits, budget_ms, models, available }`. `available` is false when the server holds no NVIDIA key, in which case turned-on checks are recorded as unchecked and nothing is blocked.

## How a turn runs

```
visitor message
  |-- jailbreak --|
  |-- safety -----|-- all in parallel, inside a 2 s budget
  |-- topic ------|
  |-- model call -|  (starts at the same time; nothing is written until the checks answer)
        |
   a flag blocks once every higher-priority check has answered (jailbreak > input safety > topic);
   the model stream is cancelled and the visitor gets one short reply instead
        |
   no flag: the reply streams through the output gate
        sentence buffer -> safety verdict -> release, in order (two verdicts in flight)
        unsafe sentence -> stop the upstream, replace the reply
```

- **Input budget.** The input checks race the model call, so a clean turn costs only the check time the model has not already used, never the sum of the checks. Once 2 s pass, any check still out is abandoned and the turn proceeds.
- **Fail open, every check.** A guard that times out, errors, rate-limits, or returns a verdict we cannot parse lets the turn through and is counted as *unchecked*. An NVIDIA outage then degrades guarded agents to unguarded ones instead of taking them offline. Only a clean parsed flag blocks.
- **Output streaming.** The reply is cut at sentence ends (at least 40 characters; a run of 320 characters with no sentence end is judged anyway), and each piece is released once its verdict is back. With two verdicts in flight, the reply still arrives in steps, one sentence behind the model. When a piece is flagged, the upstream read is cancelled, nothing after it is released, and the reply is replaced.

## What the visitor sees

| Outcome | Reply |
|---|---|
| Jailbreak | "I can't change how I work or set aside my instructions, but I'm glad to help with anything else." |
| Unsafe message | "I can't help with that request. If there's something else you need, just ask." |
| Off topic | The owner's redirect, or the one built from the topic list |
| Unsafe reply | "I can't share that answer. Could you ask in a different way, or ask about something else?" |

On `/api/chat` an output stop sends two frames. A `chunk` carries the replacement, so older clients still show coherent text, and `{type:"guard", action:"replace", text}` lets a client that knows it swap out the partial reply. The avatar page, Brain Studio and talk mode all handle it. The terminal `done` frame carries `guard: { on, blocked }`.

On the embed proxy (`/api/llm/anthropic`, used by `<agent-3d>`), the reply stays a valid Anthropic Messages stream. Every content block that was started is stopped, the replacement goes into the open text block (or a new one), and the message always ends with `message_delta` + `message_stop`. An input block answers with a complete one-block message, in the SSE or JSON form the caller asked for. Input checks run only on a visitor's own turn, not on the tool-result rounds of an agent loop.

## What the owner sees

The panel shows block counts for the last 30 days: jailbreak attempts, unsafe messages, off-topic redirects, unsafe replies stopped, and how many turns went through unchecked. These come from a `guard` summary on each chat usage row:

```json
{ "on": ["jailbreak", "input_safety", "output_safety", "topic"], "blocked": "topic",
  "unchecked": [], "input_ms": 412, "output_checks": 0 }
```

Check ids and timings only. **No message text is stored** for any check, blocked or not.

## Code

| Piece | File |
|---|---|
| Settings, classifiers, input runner, output gate, stats | [api/_lib/chat-guardrails.js](../api/_lib/chat-guardrails.js) |
| Visitor-facing copy (shared with the editor preview) | [api/_lib/guardrail-copy.js](../api/_lib/guardrail-copy.js) |
| Anthropic SSE wrapper for the embed proxy | [api/_lib/anthropic-sse-guard.js](../api/_lib/anthropic-sse-guard.js) |
| Owner endpoint | [api/agents/[id]/guardrails.js](../api/agents/[id]/guardrails.js) |
| Editor panel | [src/agent-guardrails.js](../src/agent-guardrails.js) |
| Chat wiring | [api/chat.js](../api/chat.js), [api/llm/anthropic.js](../api/llm/anthropic.js) |
| Tests | `tests/chat-guardrails.test.js`, `tests/anthropic-sse-guard.test.js` |
| Eval | `npm run nvidia:guard-eval` ([scripts/nvidia-guard-eval.mjs](../scripts/nvidia-guard-eval.mjs)) |
| Live check | `node scripts/nvidia-guard-live-check.mjs` (real server on an isolated database) |
