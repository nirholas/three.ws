# 05 — Walk during tool call execution

## Status
Gap — between LLM turns when a tool is running, no streaming chunks arrive (the LLM is waiting for tool results). The avatar stands still. It should walk during tool execution to signal activity.

## File
`src/element.js` — `skill:tool-called` handler around line 1215

## Current code
```js
if (ev === 'skill:tool-called') {
    const { tool, result } = e.detail || {};
    this._setToolIndicator(tool);
    this._clearToolIndicator();
    ...
}
```

## What to add

When a tool call starts (before the result is back), trigger a walk. When the tool finishes, the next LLM stream will continue walking naturally, or `_stopWalkAnimation()` will fire on `brain:thinking: false`.

The `skill:tool-called` event currently fires AFTER the tool result is available (it carries both `tool` and `result`). To walk DURING execution, the runtime needs to emit a `skill:tool-start` event before awaiting the tool handler.

### In `src/runtime/index.js` — `_loop()` tool dispatch loop

Add a `skill:tool-start` event before `await this._dispatchTool(call)`:
```js
for (const call of response.toolCalls) {
    this.dispatchEvent(new CustomEvent('skill:tool-start', {
        detail: { tool: call.name, args: call.input }
    }));
    let output, isError = false;
    try {
        output = await this._dispatchTool(call);
    } catch (err) { ... }
    this.dispatchEvent(new CustomEvent('skill:tool-called', { ... }));
    ...
}
```

### In `src/element.js`

Add `'skill:tool-start'` to the re-dispatch list.

In the event handler:
```js
if (ev === 'skill:tool-start') {
    this._onStreamChunk(); // start walking
    if (this._thoughtBubbleEl && this.getAttribute('avatar-chat') !== 'off') {
        // Show tool name in bubble (dots mode, not streaming mode)
        this._thoughtBubbleEl.dataset.active = 'true';
        this._thoughtBubbleEl.dataset.streaming = 'false';
    }
}
```

## Verification
Install a slow skill (or add a `setTimeout(2000)` inside a tool handler temporarily). Send a message that triggers it. Avatar should walk while the tool runs.
