# 36 — Thought bubble text: smart truncation and readability

## Status
Polish — the current 120-char truncation replaces the full text with `…` + last 110 chars. For very long responses, the bubble shows mid-sentence fragments. Better UX: show the most recent complete word boundary, and clear the bubble periodically (every N sentences) so it doesn't feel stale.

## File
`src/element.js` — `_streamToBubble()` / `_bubbleBuffer` logic (from prompt 14)

## What to change

Replace the raw char-count truncation with a word-boundary approach:

```js
_flushBubble() {
    this._bubbleRafPending = false;
    if (!this._thoughtTextEl) return;
    
    let t = this._bubbleBuffer;
    
    // Clear the buffer every time we cross a sentence boundary (.!?)
    // so the bubble feels like it's "thinking" live, not accumulating
    const sentenceEnd = t.search(/[.!?]\s/);
    if (sentenceEnd !== -1 && t.length > sentenceEnd + 2) {
        // Start fresh from after the sentence end
        this._bubbleBuffer = t.slice(sentenceEnd + 2);
        t = this._bubbleBuffer;
    }
    
    // Hard cap at 100 chars, break at last word boundary
    if (t.length > 100) {
        const truncated = t.slice(-90);
        const wordBreak = truncated.indexOf(' ');
        t = '…' + (wordBreak !== -1 ? truncated.slice(wordBreak) : truncated);
    }
    
    this._thoughtTextEl.textContent = t;
}
```

Change the RAF handler to call `_flushBubble()`:
```js
requestAnimationFrame(() => {
    this._bubbleRafPending = false;
    this._flushBubble();
});
```

This makes the bubble feel like a live "thought" that moves through sentences rather than a growing text dump.

## Verification
Ask the agent a question that generates a 200+ word response. The bubble should show fragments of the current sentence, clear at sentence boundaries, and never show more than ~100 chars. It should feel like the avatar is "thinking out loud" progressively.
