# Task: Audit and fix KnobsSidebar

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. `chat/src/KnobsSidebar.svelte` is a settings sidebar that controls `params` (temperature, max tokens, etc). Line 2 of that file has `<!-- FIXME: -->` with no description — something is broken or incomplete and was flagged but never documented.

## What to do

### 1. Read the file fully

Read `chat/src/KnobsSidebar.svelte` in its entirety. Note:
- What controls are present
- What `params` fields they bind to
- Whether any input is visually broken, incorrectly bounded, or missing a label

### 2. Read the `params` store definition

In `chat/src/stores.js`, `params` is a persisted store with these defaults:
```js
{
    temperature: 0.3,
    maxTokens: 0,
    messagesContextLimit: 0,
    reasoningEffort: {
        'low-medium-high': 'high',
        range: 64000,
    }
}
```

Cross-check: are all these fields represented in the sidebar? Are any sidebar controls binding to fields that don't exist in `params`?

### 3. Read how the sidebar is used in `App.svelte`

Search for `KnobsSidebar` in `App.svelte` to see how `knobsOpen` is toggled and whether any props are passed. Confirm there are no prop mismatches.

### 4. Check `reasoningEffort` controls

`params.reasoningEffort` has two modes: `'low-medium-high'` (string enum) and `range` (number). The sidebar may have controls for these. Verify:
- The range slider (if present) binds to `$params.reasoningEffort.range` not `$params.reasoningEffort`
- The low/medium/high selector (if present) binds to `$params.reasoningEffort['low-medium-high']`

Nested store paths in Svelte need care — `bind:value={$params.reasoningEffort.range}` works for reading but may not reactively write back. If a control is not persisting its value, fix the binding to use an intermediate variable or a setter.

### 5. Fix the FIXME

Based on your findings, fix whatever is broken. Remove the `<!-- FIXME: -->` comment once fixed (or replace it with a specific comment if something genuinely can't be fixed yet).

### 6. Add `messagesContextLimit` if missing

If the sidebar doesn't have a control for `messagesContextLimit`, add one — a number input labeled "Message history limit" with `min=0`, bound to `$params.messagesContextLimit`. A value of `0` means unlimited (note this in the label as "0 = unlimited"). Match the style of the existing max tokens input.

## Success criteria

1. All `params` fields have working, correctly-bound controls in the sidebar
2. The `<!-- FIXME: -->` comment is resolved — either fixed or replaced with a specific explanation
3. Changing a value in the sidebar persists after page refresh (because `params` is a persisted store)
4. `cd chat && npx vite build` passes

## House rules

- Edit `chat/src/KnobsSidebar.svelte` only (plus `stores.js` if there's a genuine store bug)
- Match existing label and input style in the sidebar
- Report: what the FIXME turned out to be, what was fixed, what was skipped, unrelated bugs noticed
