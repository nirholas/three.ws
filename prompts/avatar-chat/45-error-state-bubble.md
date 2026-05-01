# 45 — Error state: bubble shows failure feedback

## Status
Gap — when the LLM call fails (network error, 429 rate limit, 500 server error), the current behavior is: walk stops, bubble clears, `agent:error` fires. The user sees nothing. The bubble should briefly show an error state before clearing.

## File
`src/element.js` — `say()` / `_drainSayQueue()` error handler (prompt 22), and a new `_showBubbleError()` method

## What to add

```js
_showBubbleError(message = 'Something went wrong') {
    if (!this._thoughtBubbleEl || this.getAttribute('avatar-chat') === 'off') return;
    clearTimeout(this._bubbleClearTimer);
    this._thoughtBubbleEl.dataset.active = 'true';
    this._thoughtBubbleEl.dataset.streaming = 'true';
    this._thoughtBubbleEl.dataset.error = 'true';
    if (this._thoughtTextEl) this._thoughtTextEl.textContent = message;
    // Auto-clear after 3 seconds
    this._bubbleClearTimer = setTimeout(() => {
        this._thoughtBubbleEl.dataset.error = 'false';
        this._clearThoughtBubble();
    }, 3000);
}
```

Add CSS for error state:
```css
.thought-bubble[data-error="true"] {
    --agent-bubble-bg: rgba(239, 68, 68, 0.92);
    --agent-bubble-color: #fff;
    background: rgba(239, 68, 68, 0.92);
    color: #fff;
}
.thought-bubble[data-error="true"]::after {
    border-top-color: rgba(239, 68, 68, 0.92);
}
```

Call it in the error handler:
```js
// In _drainSayQueue catch block:
catch (err) {
    this._stopWalkAnimation();
    const msg = err?.message?.includes('429') ? 'Too many requests — try again' :
                err?.message?.includes('busy') ? 'Still thinking…' :
                'Connection error';
    this._showBubbleError(msg);
    this._setBusy(false);
    this.dispatchEvent(new CustomEvent('agent:error', { ... }));
}
```

## Verification
Simulate a network error (disable network in DevTools mid-stream). The bubble should turn red with an error message for 3 seconds, then disappear. Avatar returns to idle.
