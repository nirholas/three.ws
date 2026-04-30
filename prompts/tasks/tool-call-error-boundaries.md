# Task: Add error boundaries around tool call invocation in App.svelte

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` has a tool call pipeline where the LLM returns a tool call, the frontend invokes it against a server endpoint, and the result is fed back into the conversation. This multi-step async flow has no error handling.

If the tool server is down, returns invalid JSON, or a tool throws — the pipeline silently breaks, the conversation gets stuck, and the user sees a spinner forever.

## What to fix

### 1. Find the tool invocation code

Search for the `fetch('/tool'` or similar call in `App.svelte`. It likely looks like:

```js
const toolResponse = await fetch(`${$remoteServer.address}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: toolcall.name, arguments: toolcall.args })
});
const result = await toolResponse.json();
```

Find the exact location by searching for `toolcall` and `fetch` near each other in App.svelte.

### 2. Wrap with try-catch and surface errors

Replace the bare fetch+json pattern with:
```js
let toolResult;
try {
    const toolResponse = await fetch(`${$remoteServer.address}/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: toolcall.name, arguments: toolcall.args })
    });
    if (!toolResponse.ok) {
        throw new Error(`Tool server returned ${toolResponse.status}`);
    }
    toolResult = await toolResponse.json();
} catch (err) {
    toolResult = { error: err.message || 'Tool invocation failed' };
}
```

Feeding an error object back into the conversation is correct — it lets the LLM see that the tool failed and respond accordingly, rather than hanging.

### 3. Check the tool result shape

The Go server at `/workspaces/3D-Agent/chat/server/main.go` returns `{"error": "..."}` for failures. Make sure the code that reads `toolResult` and adds it to `convo.messages` handles the `error` field gracefully (doesn't crash trying to read `toolResult.output` when only `toolResult.error` exists).

Look for where the tool response is appended to messages and ensure it works whether the result is a success object or `{ error: string }`.

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte` — wrap tool fetch in try-catch

## Verification
- In Settings, set the remote server address to `http://localhost:9999` (nothing running there)
- Enable a tool and ask the LLM to use it
- The conversation should continue with an error message from the tool rather than hanging
- The LLM should receive the error and be able to explain what went wrong
- No unhandled promise rejections in the browser console
