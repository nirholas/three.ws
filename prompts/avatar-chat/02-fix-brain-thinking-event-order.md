# 02 — Fix brain:thinking event order in runtime loop

## Status
Bug — in `src/runtime/index.js` `_loop()`, the sequence is:
1. `brain:thinking { thinking: true }` — correct, shown at start
2. `brain:thinking { thinking: false }` — fires when `complete()` resolves
3. `brain:thinking { content: response.thinking }` — fires AFTER the false, re-triggering the indicator

This causes the tool indicator and thought bubble to flicker off then back on.

## File
`src/runtime/index.js` — `_loop()` around line 100

## Current code
```js
this.dispatchEvent(new CustomEvent('brain:thinking', { detail: { thinking: true } }));
const response = await this.provider.complete({ ... });
this.dispatchEvent(new CustomEvent('brain:thinking', { detail: { thinking: false } }));

if (response.thinking) {
    this.dispatchEvent(
        new CustomEvent('brain:thinking', { detail: { content: response.thinking } }),
    );
}
```

## Fix
Merge the thinking content into the `thinking: false` event so it's a single emission:
```js
this.dispatchEvent(new CustomEvent('brain:thinking', { detail: { thinking: true } }));
const response = await this.provider.complete({ ... });
this.dispatchEvent(new CustomEvent('brain:thinking', {
    detail: { thinking: false, content: response.thinking || '' }
}));
```

Remove the separate `if (response.thinking)` block entirely — it's now merged.

Update `element.js` handler for `brain:thinking` to read `e.detail.content` if needed for future display (currently unused, but preserve the field for consumers listening on the host element).

## Verification
Console-log brain:thinking events. There should be exactly 2 per LLM turn: `{ thinking: true }` then `{ thinking: false, content: '...' }`. No third emission.
