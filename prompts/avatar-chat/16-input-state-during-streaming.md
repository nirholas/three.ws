# 16 — Input state management during thinking and streaming

## Status
Gap — while the avatar is thinking/streaming, the text input remains fully active. The user can submit another message which throws a "Runtime busy" error. The input should visually indicate the busy state and block submission.

## File
`src/element.js` — `_renderShell()`, `brain:thinking` handler, CSS

## CSS additions

```css
.input-row input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.input-row input[data-state="thinking"] {
    opacity: 0.6;
}
.input-row[data-busy="true"] {
    opacity: 0.75;
}
```

## JS changes

Add a `_setBusy(busy)` helper:
```js
_setBusy(busy) {
    if (!this._inputEl) return;
    this._inputEl.disabled = busy;
    this._inputEl.dataset.state = busy ? 'thinking' : '';
    const row = this._inputEl.closest('.input-row');
    if (row) row.dataset.busy = busy ? 'true' : 'false';
    if (!busy) this._inputEl.placeholder = 'Say something...';
    else this._inputEl.placeholder = 'Thinking…';
}
```

Call `_setBusy(true)` when `brain:thinking` fires with `thinking: true`.
Call `_setBusy(false)` when `brain:thinking` fires with `thinking: false`.

In the `brain:thinking` handler:
```js
if (ev === 'brain:thinking') {
    const isThinking = !!e.detail?.thinking;
    this._setBusy(isThinking);
    // ... existing code ...
}
```

Also call `_setBusy(false)` on error — in the `send()` promise rejection path if element.js catches it, or on `agent:error` event.

Add `this._setBusy(false)` to `_teardown()` so the input is never left locked after a reboot.

## Verification
Send a message. Input should disable and show "Thinking…". After the response arrives, input should re-enable. Trying to submit while busy should be impossible (input is `disabled`).
