# Task: Implement tool search in ToolDropdown

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. The tool picker is in `chat/src/ToolDropdown.svelte`.

There is a commented-out search input at lines 64–70 of `ToolDropdown.svelte`:

```svelte
<!--				<input-->
<!--					type="text"-->
<!--					value=""-->
<!--					placeholder="Search for tools"-->
<!--					class="w-full rounded-lg border border-slate-300 px-3 py-2 text-[10px] text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"-->
<!--					on:input={() => {}}-->
<!--				/>-->
```

The `$toolSchema` store (from `chat/src/stores.js`) is an array of groups, each with `{ name: string, schema: Array<{ function: { name: string } }> }`. Currently all groups and tools are always shown.

## What needs to change

### `chat/src/ToolDropdown.svelte`

1. **Uncomment the search input** and wire it up properly.

2. **Add a `query` variable** in the script block (it likely already has one or similar — check before adding).

3. **Filter the displayed groups/tools** based on the query. The filter should:
   - Be case-insensitive
   - Match against both the group name and individual tool names (`schema[i].function.name`)
   - Show a group if the group name matches OR if any tool inside it matches
   - When a group partially matches (only some tools match), only show the matching tools in that group's list
   - Show all tools when query is empty

4. **Bind the input** to the query variable.

The filtered schema should be a derived value, not mutating `$toolSchema`. Use a local `$: filteredSchema = ...` reactive declaration.

Example shape:
```js
let query = '';
$: filteredSchema = query.trim()
    ? $toolSchema
        .map(group => {
            const q = query.toLowerCase();
            const groupMatch = group.name.toLowerCase().includes(q);
            const tools = groupMatch
                ? group.schema
                : group.schema.filter(t => t.function.name.toLowerCase().includes(q));
            return tools.length ? { ...group, schema: tools } : null;
        })
        .filter(Boolean)
    : $toolSchema;
```

Then replace `{#each $toolSchema as group}` with `{#each filteredSchema as group}`.

5. The search input should have `autofocus` so it's focused when the dropdown opens.

6. Show a "No tools found" message (similar to the existing empty state style) when `filteredSchema.length === 0` and `query` is non-empty.

## Success criteria

1. Opening the tool dropdown shows a functional search input at the top
2. Typing "trading" shows only the TradingViewChart tool
3. Typing "client" shows the full Client-side group
4. Clearing the search shows all groups again
5. `cd chat && npx vite build` passes with no errors

## House rules

- Edit `chat/src/ToolDropdown.svelte` only
- Match existing code style (tabs, Svelte syntax, Tailwind classes matching adjacent elements)
- Do not add a new dependency
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
