# 38 — NullProvider / skills-only mode: graceful avatar-chat behavior

## Status
Gap — when `brain.provider = "none"` (NullProvider), there are no LLM turns, no streaming, and no `brain:stream` events. Skills drive the agent directly. The avatar-chat feature must degrade gracefully.

## Files
`src/runtime/providers.js` — `NullProvider.complete()`
`src/element.js` — walk/bubble logic

## What to verify

`NullProvider.complete()` returns `{ text: '', toolCalls: [], stopReason: 'end_turn' }` immediately with no streaming. This means:
- `brain:thinking` fires with `{ thinking: true }` then immediately `{ thinking: false }` — bubble appears and disappears before user notices
- No `brain:stream` events — no walk
- If skills call `ctx.speak(text)`, that fires `voice:speech-start` — walk from prompt 06 handles this

## What to fix

### Prevent flicker on null provider

When `brain:thinking` fires with `thinking: true` and then `thinking: false` within a single tick (synchronous), the bubble appears and disappears so fast it flickers. Add a minimum display time:

In `_clearThoughtBubble()`, add a 200ms delay before hiding:
```js
_clearThoughtBubble() {
    clearTimeout(this._bubbleClearTimer);
    this._bubbleClearTimer = setTimeout(() => {
        this._bubbleBuffer = '';
        if (!this._thoughtBubbleEl) return;
        this._thoughtBubbleEl.dataset.active = 'false';
        this._thoughtBubbleEl.dataset.streaming = 'false';
        if (this._thoughtTextEl) this._thoughtTextEl.textContent = '';
    }, 200);
}
```

Add `this._bubbleClearTimer = null` to constructor and `clearTimeout(this._bubbleClearTimer)` to teardown.

This minimum 200ms prevents the bubble from appearing and vanishing in the same frame.

### Skill-driven speak walks correctly

When a skill calls `ctx.speak(text)`, the runtime dispatches `voice:speech-start`. Prompt 06 wires walk to this event. No extra work needed.

## Verification
Set `brain="none"` (no LLM provider). Install a skill that calls `ctx.speak('hello')`. Trigger it. Avatar should walk while speaking, no flicker on the thought bubble.
