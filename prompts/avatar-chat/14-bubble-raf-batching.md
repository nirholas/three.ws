# 14 — Batch thought bubble DOM updates with requestAnimationFrame

## Status
Performance — `_streamToBubble(chunk)` writes to `textContent` on every token chunk. At high streaming rates (50+ tokens/sec) this causes layout thrashing. The user can't read that fast anyway — batching to 60fps is sufficient.

## File
`src/element.js` — `_streamToBubble()` and constructor

## Current code
```js
_streamToBubble(chunk) {
    if (!this._thoughtBubbleEl || !this._thoughtTextEl) return;
    this._thoughtBubbleEl.dataset.active = 'true';
    this._thoughtBubbleEl.dataset.streaming = 'true';
    this._thoughtTextEl.textContent += chunk;
    const t = this._thoughtTextEl.textContent;
    if (t.length > 120) {
        this._thoughtTextEl.textContent = '…' + t.slice(-110);
    }
}
```

## New approach

Accumulate chunks in a string buffer and flush to DOM on the next animation frame:

```js
// In constructor:
this._bubbleBuffer = '';
this._bubbleRafPending = false;

// Replace _streamToBubble:
_streamToBubble(chunk) {
    if (!this._thoughtBubbleEl || !this._thoughtTextEl) return;
    this._thoughtBubbleEl.dataset.active = 'true';
    this._thoughtBubbleEl.dataset.streaming = 'true';
    this._bubbleBuffer += chunk;
    if (!this._bubbleRafPending) {
        this._bubbleRafPending = true;
        requestAnimationFrame(() => {
            this._bubbleRafPending = false;
            if (!this._thoughtTextEl) return;
            const t = this._bubbleBuffer;
            this._thoughtTextEl.textContent = t.length > 120 ? '…' + t.slice(-110) : t;
        });
    }
}

// Update _clearThoughtBubble to also clear the buffer:
_clearThoughtBubble() {
    this._bubbleBuffer = '';
    this._bubbleRafPending = false;
    if (!this._thoughtBubbleEl) return;
    this._thoughtBubbleEl.dataset.active = 'false';
    this._thoughtBubbleEl.dataset.streaming = 'false';
    if (this._thoughtTextEl) this._thoughtTextEl.textContent = '';
}
```

## Verification
Open Chrome Performance panel. Record while receiving a long LLM response. There should be at most 60 layout operations per second for the bubble — not one per token.
