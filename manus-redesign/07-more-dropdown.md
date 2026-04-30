# Task 07 — "More" dropdown menu

## Goal
Build the dropdown that opens from the `More` chip on the empty state. It contains nine items (icon + label). Most items set the `mode` store; `Playbook` opens an external link with an arrow indicator.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `mode` writable in `chat/src/stores.js` (created in task 06).
- Icons: `chat/src/feather.js` — add any of these that don't exist:
  - `feSmartphone` (Develop apps), `feCalendar` (Schedule task), `feGlobe` or `feTarget` (Wide Research),
  - `feGrid` (Spreadsheet), `feBarChart2` (Visualization), `fePlay` (Video), `feActivity` (Audio),
  - `feMessageSquare` (Chat mode), `feBookOpen` (Playbook), `feExternalLink` (Playbook trailing arrow).

## Design tokens
- Card: `bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-2 w-[260px]`.
- Item: `flex items-center gap-3 w-full px-3 h-10 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4EF]`.
- Icon: 16px, `text-[#1A1A1A]`.
- Trailing external arrow: 14px, `text-[#9C9A93]`, ml-auto.
- Position: anchored above-right of the More chip with `bottom-full mb-2 right-0`. On screens narrower than the dropdown, fall back to `left-1/2 -translate-x-1/2`.

## What to ship

### Component: `chat/src/manus/MoreDropdown.svelte`
```svelte
<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '../Icon.svelte';
  import { mode } from '../stores.js';
  import {
    feSmartphone, feCalendar, feGlobe, feGrid, feBarChart2,
    fePlay, feActivity, feMessageSquare, feBookOpen, feExternalLink
  } from '../feather.js';

  const dispatch = createEventDispatcher();
  const items = [
    { id: 'desktop',       label: 'Develop apps',  icon: feSmartphone },
    { id: 'schedule',      label: 'Schedule task', icon: feCalendar },
    { id: 'research',      label: 'Wide Research', icon: feGlobe },
    { id: 'spreadsheet',   label: 'Spreadsheet',   icon: feGrid },
    { id: 'visualization', label: 'Visualization', icon: feBarChart2 },
    { id: 'video',         label: 'Video',         icon: fePlay },
    { id: 'audio',         label: 'Audio',         icon: feActivity },
    { id: 'chat',          label: 'Chat mode',     icon: feMessageSquare },
    { id: 'playbook',      label: 'Playbook',      icon: feBookOpen, external: true },
  ];

  function pick(item) {
    if (item.external) {
      window.open('/playbook', '_blank');
    } else {
      mode.set(item.id);
    }
    dispatch('close');
  }

  function onKey(e) { if (e.key === 'Escape') dispatch('close'); }
</script>

<svelte:window on:keydown={onKey} />

<div class="absolute bottom-full mb-2 right-0 z-30 bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-2 w-[260px]">
  {#each items as item}
    <button
      class="flex items-center gap-3 w-full px-3 h-10 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4EF]"
      on:click={() => pick(item)}>
      <Icon icon={item.icon} size={16} />
      <span>{item.label}</span>
      {#if item.external}
        <Icon icon={feExternalLink} size={14} class="ml-auto text-[#9C9A93]" />
      {/if}
    </button>
  {/each}
</div>

<button
  class="fixed inset-0 z-20 cursor-default"
  aria-hidden="true"
  on:click={() => dispatch('close')}>
</button>
```

(Note: Svelte's `class` on an `<Icon>` may need to be `class:trailing` or a wrapper `<span class="ml-auto …">`; pick the form that compiles cleanly with the existing `Icon.svelte` component. If `Icon.svelte` does not forward `class`, wrap the trailing icon in a `<span class="ml-auto text-[#9C9A93]">`.)

## Acceptance criteria
- Clicking `More` from `SuggestionChips` opens this dropdown anchored above-right.
- Each item sets `$mode` to its id (except `Playbook`, which opens `/playbook` in a new tab) and closes the dropdown.
- Esc closes the dropdown.
- Clicking outside the dropdown closes it (achieved via the full-viewport dismiss button below the card).

## Out of scope
- The flow UI inside the composer for each mode (tasks 14–18).
- The `/playbook` page itself (task 18).
