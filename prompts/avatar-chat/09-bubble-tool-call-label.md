# 09 — Show tool call name in thought bubble during tool execution

## Status
Enhancement — after prompt 05 adds `skill:tool-start`, the thought bubble shows dots during tool calls. It should show a human-readable label like "Searching pump.fun…" so the user knows what the avatar is doing.

## File
`src/element.js` — `skill:tool-start` handler (added in prompt 05)

## What to do

Reuse the existing `_toolIndicatorLabel(toolName)` map. When `skill:tool-start` fires, populate the bubble `.text` span with the label and switch to streaming mode (text visible, dots hidden):

```js
if (ev === 'skill:tool-start') {
    this._onStreamChunk();
    if (this._thoughtBubbleEl && this.getAttribute('avatar-chat') !== 'off') {
        const label = this._toolIndicatorLabel(e.detail?.tool ?? '');
        this._thoughtBubbleEl.dataset.active = 'true';
        this._thoughtBubbleEl.dataset.streaming = 'true';
        if (this._thoughtTextEl) this._thoughtTextEl.textContent = label;
    }
}
```

When `brain:thinking` fires with `thinking: true` (next LLM iteration begins), the bubble reverts to dots mode naturally because `_streamToBubble` will switch it back on the first chunk.

Add a clear in `skill:tool-called` (after tool finishes) to reset the label so it doesn't persist:
```js
if (ev === 'skill:tool-called') {
    // existing code...
    if (this._thoughtTextEl) this._thoughtTextEl.textContent = '';
    if (this._thoughtBubbleEl) this._thoughtBubbleEl.dataset.streaming = 'false';
}
```

## Verification
Send a message that triggers a tool call (e.g. pump.fun search). The thought bubble should show "Searching pump.fun…" as text (not dots) while the tool runs, then switch back to streaming text when the next LLM turn starts.
