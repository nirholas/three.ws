# AG-UI event stream

`POST /api/agent/run` can answer in [AG-UI](https://docs.ag-ui.com) events instead of the default OpenAI chat-completion chunks. AG-UI is the open event protocol that CopilotKit, assistant-ui and the LangChain front ends speak, so any of them can drive a three.ws agent with no custom adapter.

Pinned version: AG-UI protocol 1.0 (`@ag-ui/core` 1.0.3). The stream announces it in `RUN_STARTED.protocolVersion`.

## Switching it on

Either of these selects the AG-UI stream. The default stream is unchanged when neither is present.

| Selector | Example |
|---|---|
| Query | `POST /api/agent/run?protocol=ag-ui` |
| Accept | `Accept: application/vnd.ag-ui.event+stream` |

The body is an AG-UI `RunAgentInput`: `threadId`, `runId`, `messages` (user, assistant, system; text-part arrays are flattened) and optional `forwardedProps`. To speak as one of your agents (memory, skills, sandbox), pass its id as `forwardedProps.agent_id`, with the same sign-in rules as `agent_id` on the default route. `tools`, `context` and `state` are accepted and ignored: the server runs its own tool registry. The AG-UI stream is always streaming, whatever `stream` says.

## Event sequence

```
RUN_STARTED
  TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT* / TEXT_MESSAGE_END   (text before a tool call)
  TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END
  CUSTOM three.ws.embodiment { type: "think" }
  TOOL_CALL_RESULT
  TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT* / TEXT_MESSAGE_END   (the answer)
RUN_FINISHED   { result: { usage } }
```

- A text message opens on its first delta and always closes before a tool call starts or the run ends.
- Tool calls arrive once per tool, with the model's arguments as one `TOOL_CALL_ARGS` delta. `TOOL_CALL_RESULT.content` is the JSON the tool returned, or `{"error": "..."}` when it failed.
- A failure anywhere after `RUN_STARTED` ends the stream with `RUN_ERROR { message, code: "agent_loop_failed" }` and no `RUN_FINISHED`. Failures before the stream opens (bad body, rate limit, unknown agent) are ordinary JSON errors with an HTTP status.
- `RUN_FINISHED.result` carries token `usage`, plus `sandbox_run` when the run used the code sandbox.

## Embodiment

Embodiment cues ride `CUSTOM` events named `three.ws.embodiment`. The value mirrors the Agent Action Protocol (`src/agent-protocol.js`), so an `<agent-3d>` host can forward it straight to the avatar.

| Value | When |
|---|---|
| `{ "type": "think", "phase": "tool", "tool": "<name>" }` | A tool call starts |
| `{ "type": "emote", "emotion": "concern", "reason": "tool_error", "tool": "<name>" }` | A tool returned an error |
| `{ "type": "emote", "emotion": "concern", "reason": "tool_blocked", "tool": "<name>" }` | The guard chain blocked a tool call |

A `CUSTOM` event named `three.ws.sandbox` with `{ sandbox_run }` is sent the first time the run touches the code sandbox, so the client can continue that workspace next turn.

## Try it

```bash
curl -N -X POST 'https://three.ws/api/agent/run?protocol=ag-ui' \
  -H 'content-type: application/json' \
  -d '{"threadId":"t1","runId":"r1","messages":[{"role":"user","content":"What is the SOL price right now?"}]}'
```

## CopilotKit

CopilotKit's `HttpAgent` (from `@ag-ui/client`) posts a `RunAgentInput` and parses exactly this stream.

```js
import { HttpAgent } from '@ag-ui/client';

const agent = new HttpAgent({
  url: 'https://three.ws/api/agent/run?protocol=ag-ui',
  headers: { authorization: `Bearer ${apiKey}` },
});

agent.messages = [{ id: 'm1', role: 'user', content: 'What is the SOL price?' }];
agent.runAgent({}, {
  onTextMessageContentEvent: ({ event }) => render(event.delta),
  onToolCallEndEvent: ({ toolCallName }) => showToolChip(toolCallName),
  onCustomEvent: ({ event }) => {
    if (event.name === 'three.ws.embodiment') avatar.dispatchEvent(new CustomEvent('agent-action', { detail: event.value }));
  },
});
```

The callbacks above are `AgentSubscriber` hooks from `@ag-ui/client`. The anonymous route is rate limited per IP; send an API key, or sign in, to name your own agent.

## Source

- Encoder and request mapping: `api/_lib/ag-ui.js`
- Route: `api/agent/run.js`
- Tests: `tests/agent-ag-ui-stream.test.js`
