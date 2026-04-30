# Task: Wire up Consensus mode

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. A multi-model consensus feature was started but never completed. The backend function `completeConsensus` is fully implemented in `chat/src/convo.js` (line 152). The UI toggle and call site are all commented out. This task wires it all together.

## What exists

### `chat/src/convo.js` — `completeConsensus` (line 152)

Fully implemented. It:
1. Queries all models in `convo.models` in parallel (non-streaming)
2. Sends all results to `anthropic/claude-3.5-sonnet` via OpenRouter to produce a consensus summary
3. Calls `onupdate` with the summary chunk

It's imported in `App.svelte` at line 5 but never called.

### `chat/src/App.svelte` — commented-out call site (lines 742–755)

```js
// TODO: Consensus
// if (convo.models.length === 1) {
complete(convo, onupdate, onabort);
// } else {
// 	completeConsensus(convo, ...)
// }
```

### `chat/src/SettingsModal.svelte` — commented-out tab (lines 201–212 and 595–606)

A "Consensus mode" settings tab is commented out. It was going to show a `ModelSelector` for choosing the summary model.

### `chat/src/ModelSelector.svelte` — commented-out checkbox (lines 126–135)

A checkbox next to each model for multi-select is commented out.

## What needs to change

### 1. `chat/src/App.svelte`

Uncomment and fix the call site (lines 742–755). When `convo.models.length > 1`, use `completeConsensus` instead of `complete`. The commented code has a bug — it passes a raw chunk to `onupdate` without the full delta shape. Fix it to match how `onupdate` works for the normal `complete` path (look at how `onupdate` processes chunks in the surrounding code — it expects `chunk.choices[0].delta.content`).

The fix should be:
```js
if (convo.models.length > 1) {
    completeConsensus(convo, onupdate, onabort);
} else {
    complete(convo, onupdate, onabort);
}
```

### 2. `chat/src/ModelSelector.svelte`

Uncomment the checkbox block (lines 126–135). The checkbox needs to:
- Be checked when `convo.models` contains this model
- On change, dispatch a `changeMulti` event with the model (the commented code already does this)

Look at how the `changeMulti` event is handled in `App.svelte` (search for `changeMulti`) and confirm it's wired. If it's not, add a handler that adds/removes the model from `convo.models`.

### 3. `chat/src/SettingsModal.svelte`

Uncomment the "Consensus mode" nav tab (lines 201–212) and its tab content (lines 595–606). The tab content just shows a `ModelSelector` — that's fine as-is.

### 4. Visual indicator

When `convo.models.length > 1`, the input area or the model selector should visually indicate "Consensus mode". A small badge or label next to the model display is enough — keep it minimal.

## Success criteria

1. Selecting multiple models in ModelSelector enables consensus mode
2. Sending a message with 2+ models queries all of them and produces a single summarized response
3. Single-model convos work exactly as before
4. The Settings modal shows the Consensus tab
5. `cd chat && npx vite build` passes with no errors

## House rules

- Edit existing files only: `App.svelte`, `ModelSelector.svelte`, `SettingsModal.svelte`, `convo.js`
- Do not change the `completeConsensus` implementation in `convo.js` unless there's a clear bug
- Match existing code style
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
