# 07 — Brief walk when user sends a message

## Status
Enhancement — when the user hits Enter or clicks send, there's a visible pause before the first `brain:stream` chunk arrives. During this gap the avatar stands idle. A brief "acknowledgement" walk makes the system feel instantly responsive.

## File
`src/element.js` — input `keydown` handler and `say()` method

## What to do

In `_renderShell()`, the Enter key handler is:
```js
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
        const v = input.value.trim();
        input.value = '';
        this.say(v);
    }
});
```

Add a `_onStreamChunk()` call immediately when the user submits, before `say()` dispatches to the runtime. This starts the walk immediately on keypress. The stream will then keep it going, or the debounce will expire after 600ms if something goes wrong.

```js
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
        const v = input.value.trim();
        input.value = '';
        this._onStreamChunk(); // immediate visual feedback
        this.say(v);
    }
});
```

Apply the same to the `say()` public method itself so programmatic calls also trigger it:

```js
async say(text, opts = {}) {
    this._onStreamChunk(); // acknowledge immediately
    if (!this._runtime) await this._waitForReady();
    ...
}
```

Guard with `avatar-chat !== 'off'` — `_onStreamChunk()` already does this internally.

## Verification
Type a message and press Enter. Avatar should start walking instantly, before the LLM responds.
