# Task 06 — Primary suggestion chips row

## Goal
Render the row of five chips directly below the composer on the empty-state landing: `Create slides`, `Build website`, `Develop desktop apps`, `Design`, `More`. Clicking the first four sets a `mode` store and updates the composer's inline mode pill + flow UI (tasks 14–17 own those flows). Clicking `More` opens the dropdown defined in task 07.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- Add a `mode` writable store in `chat/src/stores.js` (create if absent):
  ```js
  import { writable } from 'svelte/store';
  export const mode = writable(null); // null | 'slides' | 'website' | 'desktop' | 'design' | 'schedule' | 'research' | 'spreadsheet' | 'visualization' | 'video' | 'audio' | 'chat' | 'playbook'
  ```
- Icons live in `chat/src/feather.js`. The Manus chips use simple line icons; map as follows (add any missing exports to `feather.js`):
  - Create slides → `feLayout` (or any "deck"-like icon)
  - Build website → `feCode` (the `< />` glyph)
  - Develop desktop apps → `feMonitor`
  - Design → `feFeather` or a magic-wand icon — feather has `feZap`; that's fine
  - More → `feMoreHorizontal`

## Design tokens
- Chip: class `manus-chip` (defined in task 01) — fallback: `inline-flex items-center gap-2 h-9 px-4 rounded-full border border-[#E5E3DC] bg-white text-[#1A1A1A] text-sm font-medium hover:bg-[#F0EEE6] transition-colors`.
- Selected: `manus-chip-selected` — `bg-[#EFF6FF] border-[#BFDBFE] text-[#3B82F6]`.
- Row: `flex flex-wrap gap-3 justify-center mt-4`.

## What to ship

### Component: `chat/src/manus/SuggestionChips.svelte`
```svelte
<script>
  import { mode } from '../stores.js';
  import Icon from '../Icon.svelte';
  import { feCode, feMonitor, feZap, feMoreHorizontal, feLayout } from '../feather.js';
  import MoreDropdown from './MoreDropdown.svelte'; // task 07

  let moreOpen = false;
  const chips = [
    { id: 'slides',  label: 'Create slides',         icon: feLayout },
    { id: 'website', label: 'Build website',         icon: feCode },
    { id: 'desktop', label: 'Develop desktop apps',  icon: feMonitor },
    { id: 'design',  label: 'Design',                icon: feZap },
  ];
  function pick(id) { mode.set($mode === id ? null : id); }
</script>

<div class="flex flex-wrap gap-3 justify-center mt-4">
  {#each chips as c}
    <button class="manus-chip {$mode === c.id ? 'manus-chip-selected' : ''}"
            on:click={() => pick(c.id)}>
      <Icon icon={c.icon} size={16} />
      {c.label}
    </button>
  {/each}
  <div class="relative">
    <button class="manus-chip" on:click={() => moreOpen = !moreOpen}>
      <Icon icon={feMoreHorizontal} size={16} />
      More
    </button>
    {#if moreOpen}
      <MoreDropdown on:close={() => moreOpen = false} />
    {/if}
  </div>
</div>
```

### Wire into `EmptyState`
- In task 04's `EmptyState.svelte`, fill the `chips` slot with `<SuggestionChips />` from `App.svelte`.
- Subscribe to `mode` in `App.svelte` to pass it down to the `Composer` so the inline mode pill and flow UI update.

### Stub for `MoreDropdown.svelte`
If task 07 is not yet merged, create a placeholder `chat/src/manus/MoreDropdown.svelte` that renders an empty card so this component compiles. Task 07 will replace the body.

## Acceptance criteria
- The five chips render below the composer on the empty state, centered.
- Clicking a chip sets `$mode` and applies the selected styling; clicking it again clears.
- Setting `$mode` is reflected by the composer's inline mode pill (when task 05 is merged).
- `More` opens a dropdown anchored to the chip; clicking outside closes it.

## Out of scope
- The contents of `More` (task 07).
- What each mode actually changes inside the composer (tasks 14–18).
