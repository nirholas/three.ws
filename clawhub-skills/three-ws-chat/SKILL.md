---
name: three-ws-chat
description: Chat with any three.ws AI agent via the streaming SDK — send messages, iterate over streamed response chunks, and embed agent iframes into web pages.
allowed-tools: Read, Edit, Write, Bash(npm:*)
---

# three-ws-chat

The `@3d-agent/sdk` wraps the `https://three.ws/api/chat` streaming endpoint, letting you send messages to any three.ws agent and iterate over the response as a real-time stream of JSON chunks.

## Install

```bash
npm install @3d-agent/sdk
```

## Authentication

Every request requires an API key and an agent ID. Get both from [three.ws](https://three.ws).

```js
import { createAgent } from '@3d-agent/sdk';

const agent = createAgent('YOUR_API_KEY', 'YOUR_AGENT_ID');
```

Or instantiate the class directly:

```js
import { Agent } from '@3d-agent/sdk';

const agent = new Agent('YOUR_API_KEY', 'YOUR_AGENT_ID');
```

## Streaming chat

`agent.chat()` returns an `AsyncIterable` of parsed JSON chunks:

```js
const stream = await agent.chat('What is the meaning of life?');

for await (const chunk of stream) {
  process.stdout.write(chunk.text ?? '');
}
```

### With conversation history

Pass `history` as an array of `{ role, content }` pairs to maintain context across turns:

```js
const history = [
  { role: 'user',      content: 'What is 2 + 2?' },
  { role: 'assistant', content: 'Four.' },
];

const stream = await agent.chat('And times 3?', history);

for await (const chunk of stream) {
  process.stdout.write(chunk.text ?? '');
}
```

### Collecting the full response

```js
async function chatOnce(agent, message, history = []) {
  const stream = await agent.chat(message, history);
  const parts = [];
  for await (const chunk of stream) {
    if (chunk.text) parts.push(chunk.text);
  }
  return parts.join('');
}

const reply = await chatOnce(agent, 'Summarize the Iliad in one sentence.');
console.log(reply);
```

## Embedding an agent iframe

Append an agent iframe to any DOM element:

```js
agent.embed(document.getElementById('avatar-container'));
```

This creates a full `<agent-3d>` embed at `https://three.ws/agent/<agentId>/embed`.

## API

### `createAgent(apiKey, agentId)`

Factory function. Returns an `Agent` instance.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| `apiKey`  | string | yes      |
| `agentId` | string | yes      |

### `agent.chat(message, history?)`

| Parameter | Type                                              | Required |
| --------- | ------------------------------------------------- | -------- |
| `message` | string                                            | yes      |
| `history` | `{ role: 'user' \| 'assistant', content: string }[]` | no |

Returns `Promise<AsyncIterable<any>>`. Each yielded value is a parsed JSON object from the SSE stream. Throws if the HTTP response is not 2xx.

### `agent.embed(element)`

| Parameter | Type        | Required |
| --------- | ----------- | -------- |
| `element` | HTMLElement | yes      |

Appends an `<iframe>` pointing to the agent's embed URL. The iframe fills 100% width and height of the container with no border.

## Error handling

```js
try {
  const stream = await agent.chat('Hello');
  for await (const chunk of stream) {
    // process chunks
  }
} catch (err) {
  // err.message contains status code and response body on HTTP errors
  console.error('Chat failed:', err.message);
}
```

## React integration

```jsx
import { useState, useRef, useEffect } from 'react';
import { createAgent } from '@3d-agent/sdk';

const agent = createAgent(import.meta.env.VITE_THREE_WS_KEY, import.meta.env.VITE_AGENT_ID);

export function AgentChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg = { role: 'user', content: input };
    const history = messages.map(({ role, content }) => ({ role, content }));

    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);

    const stream = await agent.chat(input, history);
    for await (const chunk of stream) {
      if (chunk.text) {
        setMessages((m) => {
          const updated = [...m];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + chunk.text,
          };
          return updated;
        });
      }
    }

    setStreaming(false);
  }

  return (
    <div>
      {messages.map((m, i) => <div key={i}><b>{m.role}:</b> {m.content}</div>)}
      <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
      <button onClick={send} disabled={streaming}>Send</button>
    </div>
  );
}
```

## Environment variables

Store credentials in `.env`, never in source code:

```env
VITE_THREE_WS_KEY=your_api_key_here
VITE_AGENT_ID=your_agent_id_here
```

For Node.js / server-side:

```env
THREE_WS_API_KEY=your_api_key_here
THREE_WS_AGENT_ID=your_agent_id_here
```
