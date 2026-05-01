# 22 — Concurrent request guard and queue

## Status
Gap — if the user sends a message while the input is not yet disabled (brief window before prompt 16 lands), or via the programmatic `say()` API, the runtime throws "Runtime busy". This error surfaces as an unhandled rejection with no user feedback.

## File
`src/element.js` — `say()` method

## Current behavior
```js
async say(text, opts = {}) {
    if (!this._runtime) await this._waitForReady();
    return await this._runtime.send(text, { voice: ... });
    // If runtime is busy, send() throws "Runtime busy"
}
```

## What to do

Queue the message instead of erroring. Only one message can be in-flight, but a pending message can wait:

```js
say(text, opts = {}) {
    if (this._pendingSay) {
        // Replace any previously queued message with the latest
        this._pendingSay = { text, opts };
        return;
    }
    this._pendingSay = { text, opts };
    this._drainSayQueue();
}

async _drainSayQueue() {
    while (this._pendingSay) {
        const { text, opts } = this._pendingSay;
        this._pendingSay = null;
        try {
            if (!this._runtime) await this._waitForReady();
            this._onStreamChunk();
            await this._runtime.send(text, { voice: opts.voice ?? this.hasAttribute('voice') });
        } catch (err) {
            this._stopWalkAnimation();
            this._clearThoughtBubble();
            this._setBusy(false);
            this.dispatchEvent(new CustomEvent('agent:error', {
                detail: { phase: 'send', error: err },
                bubbles: true, composed: true,
            }));
        }
    }
}
```

Also add `this._pendingSay = null` to the constructor and clear it in `_teardown()`.

## Verification
Rapidly type and submit three messages. The first should be processed, the third (latest) should be queued and sent next. The second should be silently dropped (replaced by the third). No unhandled rejections in the console.
