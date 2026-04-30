# Task 07 — UI: Installed Skills Toolbar Chip Strip

## Goal
When one or more skills are installed (i.e. `$toolSchema.length > 0`), show a horizontal strip
of chips just above the chat input bar listing each installed skill by name, with an × to remove
it. This makes the active skill set visible at a glance without opening the modal.

## Prerequisites
Tasks 01–04 must be complete and building cleanly.

## Context
- File to edit: `/chat/src/App.svelte` (read the entire file first)
- `toolSchema` store: `Array<{ name: string, schema: ToolDef[] }>` from `./stores.js`
- Find where the chat input component (`<Input ...>` or equivalent) is rendered. The chip strip
  goes immediately above it, inside the same container.
- The input area likely has classes like `border-t`, `px-4 py-2`, or similar — match the spacing.

## What to build

### Chip strip
Add this block immediately above the chat input render point in App.svelte:

```svelte
{#if $toolSchema.length > 0}
  <div class="flex flex-wrap gap-1.5 px-4 pt-2 pb-0">
    {#each $toolSchema as group}
      <span class="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700">
        {group.name}
        <button
          class="ml-0.5 rounded-full p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
          on:click={() => removeSkill(group.name)}
          aria-label="Remove {group.name}"
        >
          <!-- feather x icon, 10px -->
        </button>
      </span>
    {/each}
    <button
      class="text-[11px] text-slate-400 hover:text-slate-600"
      on:click={() => (showSkillsMarketplace = true)}
    >
      + Add skill
    </button>
  </div>
{/if}
```

### removeSkill helper
Add this function in the App.svelte `<script>` block (near the other tool-related logic):
```js
function removeSkill(name) {
  toolSchema.update(groups => groups.filter(g => g.name !== name));
}
```

### Icon
Use the existing `feather.js` / `Icon` component pattern already used in App.svelte for the
× icon (look at how other small × close buttons are done in the file and match exactly).

## Constraints
- Surgical: only add the chip strip block and the `removeSkill` function. Nothing else.
- Do not change the layout of the input area itself.
- `showSkillsMarketplace` is already declared in App.svelte from Task 04 — do not re-declare it.

## Verification
1. Run `cd /workspaces/3D-Agent/chat && npm run build` — must pass.
2. Confirm the chip strip only renders when `$toolSchema.length > 0`.
3. Confirm clicking × removes only that group from `toolSchema`.
4. Confirm "+ Add skill" opens the marketplace modal.
