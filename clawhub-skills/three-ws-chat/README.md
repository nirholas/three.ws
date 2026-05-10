# three-ws-chat

Chat with any [three.ws](https://three.ws) AI agent using the official JavaScript SDK. Supports real-time streaming responses, multi-turn conversation history, and one-call iframe embeds — framework-agnostic.

| Property      | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| name          | three-ws-chat                                                                    |
| description   | Stream chat responses from any three.ws agent — install SDK, send messages, iterate chunks |
| allowed-tools | Read, Edit, Write, Bash(npm:*)                                                   |

## Install

```
openclaw skills install three-ws-chat
```

Or via direct URL:

```
Install the skill https://raw.githubusercontent.com/nirholas/3D-Agent/main/clawhub-skills/three-ws-chat/SKILL.md
```

## SDK install

```bash
npm install @3d-agent/sdk
```

## Authentication

Get an API key and agent ID from [three.ws](https://three.ws), then:

```js
import { createAgent } from '@3d-agent/sdk';

const agent = createAgent(process.env.THREE_WS_API_KEY, process.env.THREE_WS_AGENT_ID);
```

## Core workflow

```
1. Install SDK      →  npm install @3d-agent/sdk
2. Create agent     →  createAgent(apiKey, agentId)
3. Send message     →  agent.chat(message, history?)
4. Stream response  →  for await (const chunk of stream) { ... }
5. (Optional) Embed →  agent.embed(domElement)
```

## Quick start

### Minimal streaming chat

```js
import { createAgent } from '@3d-agent/sdk';

const agent = createAgent('YOUR_API_KEY', 'YOUR_AGENT_ID');

const stream = await agent.chat('What can you help me with?');

for await (const chunk of stream) {
  if (chunk.text) process.stdout.write(chunk.text);
}
```

### Multi-turn conversation

```js
const history = [];

async function chat(message) {
  const stream = await agent.chat(message, history);
  let reply = '';

  for await (const chunk of stream) {
    if (chunk.text) {
      process.stdout.write(chunk.text);
      reply += chunk.text;
    }
  }

  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: reply });
  return reply;
}

await chat('My name is Alice.');
await chat('What did I just tell you?');  // agent remembers "Alice"
```

### Collect full response

```js
async function chatOnce(agent, message, history = []) {
  const stream = await agent.chat(message, history);
  const parts = [];
  for await (const chunk of stream) {
    if (chunk.text) parts.push(chunk.text);
  }
  return parts.join('');
}
```

## Iframe embed

Append the agent's `<agent-3d>` iframe to any DOM element:

```js
agent.embed(document.getElementById('avatar-container'));
```

The iframe fills 100% of the container with no border. Pair with the `agent-3d` skill for full postMessage control over the embedded avatar.

## API reference

### `createAgent(apiKey, agentId) → Agent`

| Parameter | Type   | Required | Description              |
| --------- | ------ | -------- | ------------------------ |
| `apiKey`  | string | yes      | Your three.ws API key    |
| `agentId` | string | yes      | The agent ID to chat with |

### `Agent.chat(message, history?) → Promise<AsyncIterable>`

Streams a response from the agent.

| Parameter | Type                                                    | Required | Default |
| --------- | ------------------------------------------------------- | -------- | ------- |
| `message` | string                                                  | yes      |         |
| `history` | `{ role: 'user' \| 'assistant', content: string }[]`   | no       | `[]`    |

Returns a `Promise` that resolves to an `AsyncIterable<{text?: string, ...}>`. Each yielded object is one parsed SSE data frame. Throws on non-2xx HTTP status.

### `Agent.embed(element) → void`

| Parameter | Type        | Required | Description                     |
| --------- | ----------- | -------- | ------------------------------- |
| `element` | HTMLElement | yes      | Container to append the iframe to |

## Framework examples

### React — streaming chat component

```jsx
import { useState } from 'react';
import { createAgent } from '@3d-agent/sdk';

const agent = createAgent(import.meta.env.VITE_THREE_WS_KEY, import.meta.env.VITE_AGENT_ID);

export function Chat() {
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!draft.trim() || busy) return;
    const userMsg = { role: 'user', content: draft };
    const assistantMsg = { role: 'assistant', content: '' };
    setHistory((h) => [...h, userMsg, assistantMsg]);
    setDraft('');
    setBusy(true);

    const msgHistory = [...history, userMsg].map(({ role, content }) => ({ role, content }));
    const stream = await agent.chat(draft, msgHistory);

    for await (const chunk of stream) {
      if (chunk.text) {
        setHistory((h) => {
          const copy = [...h];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + chunk.text };
          return copy;
        });
      }
    }

    setBusy(false);
  }

  return (
    <div>
      {history.map((m, i) => (
        <p key={i}><strong>{m.role}:</strong> {m.content}</p>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
      <button onClick={send} disabled={busy}>Send</button>
    </div>
  );
}
```

### Next.js — server-side API route

```ts
// app/api/chat/route.ts
import { Agent } from '@3d-agent/sdk';

export async function POST(req: Request) {
  const { message, history = [] } = await req.json();
  const agent = new Agent(process.env.THREE_WS_API_KEY!, process.env.THREE_WS_AGENT_ID!);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const agentStream = await agent.chat(message, history);
      for await (const chunk of agentStream) {
        if (chunk.text) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

### Vanilla JS — chat in the browser

```html
<div id="chat"></div>
<input id="msg" type="text" placeholder="Say something..." />
<button onclick="send()">Send</button>

<script type="module">
  import { createAgent } from 'https://esm.sh/@3d-agent/sdk';

  const agent = createAgent('YOUR_KEY', 'YOUR_AGENT_ID');
  const history = [];

  window.send = async () => {
    const input = document.getElementById('msg');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';

    const chat = document.getElementById('chat');
    chat.innerHTML += `<p><b>You:</b> ${message}</p><p id="reply"><b>Agent:</b> </p>`;
    const reply = document.getElementById('reply');

    const h = history.map(({ role, content }) => ({ role, content }));
    const stream = await agent.chat(message, h);
    let full = '';

    for await (const chunk of stream) {
      if (chunk.text) {
        full += chunk.text;
        reply.innerHTML = `<b>Agent:</b> ${full}`;
      }
    }

    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: full });
  };
</script>
```

## Environment setup

Store credentials securely — never commit them:

```env
# .env (Vite / browser)
VITE_THREE_WS_KEY=sk_live_...
VITE_AGENT_ID=a_abc123

# .env (Node.js)
THREE_WS_API_KEY=sk_live_...
THREE_WS_AGENT_ID=a_abc123
```

Add `.env` to `.gitignore`:

```bash
echo ".env" >> .gitignore
```

## Error handling

```js
try {
  const stream = await agent.chat('Hello');
  for await (const chunk of stream) {
    // ...
  }
} catch (err) {
  if (err.message.includes('401')) {
    console.error('Invalid API key');
  } else if (err.message.includes('404')) {
    console.error('Agent not found');
  } else {
    console.error('Chat error:', err.message);
  }
}
```

## Common gotchas

- **401 Unauthorized** — wrong or missing API key; check `Authorization: Bearer <key>` header
- **Agent not found** — verify your `agentId` in the [three.ws dashboard](https://three.ws)
- **Empty stream** — the agent may still be warming up; retry once after 2–3 seconds
- **History format** — `history` must be `[{ role, content }]`; any other shape is silently ignored

## Source

SDK: [`sdk/agent-sdk/src/index.ts`](https://github.com/nirholas/3D-Agent/blob/main/sdk/agent-sdk/src/index.ts)
