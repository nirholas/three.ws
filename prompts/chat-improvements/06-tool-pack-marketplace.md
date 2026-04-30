# Task: Add tool pack install to the ToolDropdown

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. Tools are displayed in groups in `chat/src/ToolDropdown.svelte`. The `toolSchema` store (persisted to localStorage in `chat/src/stores.js`) holds an array of `{ name, schema }` groups.

Currently, tool groups are hardcoded in `chat/src/tools.js` (`defaultToolSchema`, `agentToolSchema`, `pumpToolSchema`) and loaded into the store at startup in `App.svelte`. There is no way for users to install additional tool packs.

There is an existing marketplace at `/api/marketplace/` for agents. The goal here is to add a **"Browse packs"** button at the bottom of the ToolDropdown that opens a small modal listing installable tool packs, each of which can be added to `toolSchema`.

## What to build

### 1. Define curated tool packs

In `chat/src/tools.js`, add an exported array `curatedToolPacks`. Each pack has:
- `id` — unique string
- `name` — display name
- `description` — one line
- `schema` — same shape as a group's `schema` array (array of tool objects with `clientDefinition` + `function`)

Start with these two packs (in addition to the already-existing TradingViewChart which is in the default schema):

**Pack: "Web Search"** — a single tool `WebSearch` that fetches `https://api.duckduckgo.com/?q={query}&format=json&no_html=1` and returns the `AbstractText` and top 3 `RelatedTopics[].Text`. Body uses `fetch`.

**Pack: "Date & Time"** — two tools: `GetCurrentTime` (returns `new Date().toISOString()`) and `GetTimezone` (returns `Intl.DateTimeFormat().resolvedOptions().timeZone`).

### 2. `chat/src/ToolDropdown.svelte`

At the bottom of the dropdown (after the `</ul>`), add a "Browse packs" button:

```svelte
<div class="border-t border-slate-100 px-3 py-2">
    <button
        class="w-full rounded-lg border border-slate-200 py-1.5 text-[11px] text-slate-500 transition-colors hover:bg-gray-50 hover:text-slate-700"
        on:click={() => (packModalOpen = true)}
    >
        Browse tool packs
    </button>
</div>
```

### 3. Pack install modal

Create `chat/src/ToolPackModal.svelte`. It's a simple modal (use the existing `Modal.svelte` component) that:
- Lists each pack from `curatedToolPacks`
- Shows name, description, tool count
- Shows an "Install" button if not installed, "Remove" if installed (check by matching `group.name` against pack `name` in `$toolSchema`)
- Install: appends the pack as a new group to `$toolSchema`
- Remove: filters it out of `$toolSchema`

Use the existing `Modal.svelte` — import and wrap with `<Modal bind:open={packModalOpen}>`.

Check how `Modal.svelte` is used in `SettingsModal.svelte` for the correct usage pattern.

### 4. Wire into `ToolDropdown.svelte`

Import `ToolPackModal` and add `<ToolPackModal bind:open={packModalOpen} />` to the dropdown template. Add `let packModalOpen = false` to the script.

## Success criteria

1. A "Browse tool packs" button appears at the bottom of the tool dropdown
2. Clicking it opens a modal listing the curated packs
3. Installing a pack adds it as a group to the tool dropdown and persists across refresh
4. Removing a pack removes it from the dropdown
5. `cd chat && npx vite build` passes

## House rules

- Add to `chat/src/tools.js` and create `chat/src/ToolPackModal.svelte`; edit `chat/src/ToolDropdown.svelte`
- Do not create a backend API — packs are curated client-side for now
- Match existing Tailwind class style from `ToolDropdown.svelte` and `SettingsModal.svelte`
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
