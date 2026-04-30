# Task: Auto-install tool pack from URL param on chat load

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. The marketplace page (at `/marketplace?tab=tools`) links to `/chat` with a query param like `?install=tradingview` to trigger installing a tool pack. This task wires up the Svelte side to detect that param and install the pack automatically.

This task depends on tool packs being defined in `chat/src/tools.js` as `curatedToolPacks` (added in prompt `06-tool-pack-marketplace.md`). If that array doesn't exist yet, create a minimal version with just the TradingViewChart pack for now.

## What to build

### `chat/src/App.svelte`

On mount, check `window.location.search` for an `?install=` param. If present, find the matching pack from `curatedToolPacks` by `id`, and install it if not already in `$toolSchema`.

Add this to the `onMount` block (or near the existing URL/hash handling):

```js
const urlParams = new URLSearchParams(window.location.search);
const installId = urlParams.get('install');
if (installId) {
    const pack = curatedToolPacks.find(p => p.id === installId);
    if (pack) {
        const alreadyInstalled = $toolSchema.some(g => g.name === pack.name);
        if (!alreadyInstalled) {
            $toolSchema = [...$toolSchema, { name: pack.name, schema: pack.schema }];
        }
    }
    // Remove the param from URL without reload
    const url = new URL(window.location.href);
    url.searchParams.delete('install');
    window.history.replaceState({}, '', url.toString());
}
```

### Import

Import `curatedToolPacks` in `App.svelte`:
```js
import { defaultToolSchema, agentToolSchema, pumpToolSchema, curatedToolPacks } from './tools.js';
```

### User feedback

After auto-installing, show a brief toast or flash message: "Tool pack '[name]' installed." Use whatever notification mechanism already exists in the app — search for `flash` or toast usage in `App.svelte`. There's an `actions.js` with a `flash` action — use that if it's already in use.

## Success criteria

1. Navigating to `/chat?install=tradingview` automatically installs the TradingViewChart tool pack
2. The `?install=` param is removed from the URL after install (no page reload)
3. Already-installed packs are not duplicated
4. Unknown `install` values are silently ignored
5. `cd chat && npx vite build` passes

## House rules

- Edit `chat/src/App.svelte` and `chat/src/tools.js` only
- Do not add a new dependency
- Match existing code style
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
