# Task: Remove completeConsensus dead code

## Context

`/workspaces/3D-Agent/chat/src/convo.js` exports a `completeConsensus()` function (~line 152) that was an experimental multi-model consensus feature. It is commented out everywhere it was called in `App.svelte` and is not reachable from any UI. It's ~100 lines of dead code that references OpenRouter specifically and would need significant work to actually function correctly.

There are also related TODO comments in `ModelSelector.svelte` and `SettingsModal.svelte` marking consensus UI as disabled.

## What to remove

### 1. Delete `completeConsensus` from convo.js

In `/workspaces/3D-Agent/chat/src/convo.js`, delete the entire `completeConsensus` export function. It starts at:
```js
export async function completeConsensus(convo, onupdate, onabort) {
```
and ends after the final closing `}` of that function (~line 250).

### 2. Remove the unused import in App.svelte

In `/workspaces/3D-Agent/chat/src/App.svelte`, find:
```js
import { complete, completeConsensus, generateImage } from './convo.js';
```
Remove `completeConsensus` from the import:
```js
import { complete, generateImage } from './convo.js';
```

### 3. Remove the commented-out TODO blocks

In `App.svelte` around line 742, delete the commented-out consensus block (the `// TODO: Consensus` comment and any surrounding commented code).

In `/workspaces/3D-Agent/chat/src/ModelSelector.svelte` around line 126, delete the `<!--TODO: Consensus-->` comment.

In `/workspaces/3D-Agent/chat/src/SettingsModal.svelte` around lines 201 and 595, delete the `<!--TODO: Consensus-->` comments.

## Files to edit
- `/workspaces/3D-Agent/chat/src/convo.js` — delete `completeConsensus` function
- `/workspaces/3D-Agent/chat/src/App.svelte` — remove import, remove commented TODO block
- `/workspaces/3D-Agent/chat/src/ModelSelector.svelte` — remove TODO comment
- `/workspaces/3D-Agent/chat/src/SettingsModal.svelte` — remove TODO comments (2 locations)

## Verification
- `cd /workspaces/3D-Agent/chat && npm run build` should complete with no errors
- `grep -r "completeConsensus\|TODO.*Consensus" /workspaces/3D-Agent/chat/src` should return no results
- The chat UI should work identically — no consensus feature ever appeared in the UI
