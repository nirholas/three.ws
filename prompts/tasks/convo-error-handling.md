# Task: Add error handling to convo.js API boundaries

## Context

`/workspaces/3D-Agent/chat/src/convo.js` is the core file that calls LLM provider APIs (OpenAI-compatible, Anthropic, etc.) and handles streaming responses.

Currently fetch calls do not check `response.ok`, JSON parses can throw silently, and provider-level error responses (e.g. `{"error": {"message": "..."}}`) are treated as valid data. This causes silent failures and cryptic UI states.

## What to fix

### 1. Check `response.ok` after every fetch (~line 143)

Currently:
```js
const response = await completions(get(controller).signal);
if (stream) {
    streamResponse(model.provider, response.body, onupdate, onabort);
} else {
    const responseBody = await response.json();
    onupdate(responseBody);
}
```

Should be:
```js
const response = await completions(get(controller).signal);
if (!response.ok) {
    let msg = `API error ${response.status}`;
    try { const e = await response.json(); msg = e?.error?.message || e?.message || msg; } catch {}
    throw new Error(msg);
}
if (stream) {
    streamResponse(model.provider, response.body, onupdate, onabort);
} else {
    const responseBody = await response.json();
    onupdate(responseBody);
}
```

### 2. Wrap `response.json()` calls in try-catch (~line 200 in `completeConsensus`)

Currently:
```js
const result = await response.json();
return { model: model.id, response: result.choices[0].message.content };
```

Should be:
```js
let result;
try { result = await response.json(); } catch {
    throw new Error(`Invalid JSON from ${model.id}`);
}
if (!result?.choices?.[0]?.message?.content) {
    throw new Error(`Unexpected response shape from ${model.id}`);
}
return { model: model.id, response: result.choices[0].message.content };
```

### 3. In `complete()` (~line 50-150), wrap the entire function body in try-catch and call `onabort` on error

Currently errors thrown inside `complete()` propagate uncaught. The caller in `App.svelte` does not always have a try-catch.

Wrap the body:
```js
export async function complete(convo, onupdate, onabort) {
    try {
        // ... existing body ...
    } catch (err) {
        if (err.name === 'AbortError') return;
        onabort?.(err.message || String(err));
    }
}
```

### 4. Check `response.ok` for image generation fetch (~line 559)

Find the image generation `fetch(...)` call and add the same `response.ok` check pattern.

## Files to edit
- `/workspaces/3D-Agent/chat/src/convo.js`

## Verification
- In the running chat app, set an invalid API key and send a message — the UI should show an error message rather than silently hanging or crashing.
- In browser devtools, network tab should show the failed request; the chat UI should display the API error message text.
- Valid requests should still work normally.
