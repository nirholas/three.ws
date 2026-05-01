# 21 — Stream abort and error recovery

## Status
Gap — if the user navigates away, tears down the component, or a network error occurs mid-stream, the SSE reader in `AnthropicProvider.complete()` will hang or throw unhandled. The thought bubble and walk state may get stuck on.

## Files
`src/runtime/providers.js` — `AnthropicProvider.complete()`
`src/runtime/index.js` — `_loop()`
`src/element.js` — teardown

## Changes needed

### 1 — AbortController in provider

`complete()` should accept an `AbortSignal` and cancel the fetch + reader:

```js
async complete({ system, messages, tools, onChunk, signal }) {
    const url = ...;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) { ... }

    const reader = res.body.getReader();
    // If aborted, cancel the reader
    signal?.addEventListener('abort', () => reader.cancel());

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (signal?.aborted) break;
            // ... existing SSE parsing ...
        }
    } catch (err) {
        if (err.name === 'AbortError') return out; // graceful exit
        throw err;
    }
    return out;
}
```

### 2 — AbortController in runtime

In `Runtime`, store a controller per `send()` call:

```js
async send(userText, opts = {}) {
    if (this._busy) throw new Error('Runtime busy');
    this._busy = true;
    this._abortController = new AbortController();
    try {
        ...
        const reply = await this._loop(this._abortController.signal);
        ...
    } finally {
        this._busy = false;
        this._abortController = null;
    }
}

async _loop(signal) {
    ...
    const response = await this.provider.complete({
        ...,
        signal,
        onChunk: (chunk) => {
            if (signal?.aborted) return;
            this.dispatchEvent(new CustomEvent('brain:stream', { detail: { chunk } }));
        },
    });
    ...
}
```

Add a `cancel()` method to `Runtime`:
```js
cancel() {
    this._abortController?.abort();
}
```

### 3 — Call cancel on teardown in element.js

In `_teardown()`, before destroying the runtime:
```js
this._runtime?.cancel();
```

### 4 — Recover UI state on error

In element.js, if `say()` rejects (network error, abort), ensure the UI resets:
```js
async say(text, opts = {}) {
    try {
        this._onStreamChunk();
        ...
        return await this._runtime.send(text, ...);
    } catch (err) {
        this._stopWalkAnimation();
        this._clearThoughtBubble();
        this._setBusy(false);
        throw err;
    }
}
```

## Verification
Start a message. Close/reopen the agent component before the response arrives. No hanging readers, no stuck walk animation, no console errors.
