# Task 03 — Announcement banner

## Goal
Add the muted "Manus is now part of Meta — bringing AI to businesses worldwide →" banner that sits directly below the top navigation. Dismissible with persistence in `localStorage`.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- Existing `localStorage` helper: `chat/src/localstorage.js` exports `persisted(key, default)` returning a Svelte writable store synced to localStorage.
- Banner mounts in `App.svelte` directly under `TopNav`. If `TopNav` isn't merged yet, mount it as the first child of `<body>` content with `position: sticky; top: 0` until task 02 lands; the integrator will reorder.

## Design tokens
- bg: `bg-paper-deep` (`#EBE8E0`); fallback `bg-[#EBE8E0]`
- text: `text-ink` (`#1A1A1A`); arrow same color
- height: 40px desktop, 56px mobile (text wraps OK)
- font: Inter 400, 14px, centered
- arrow: feather `arrow-right` icon, 16px, ml-2
- close button (right edge): feather `x` icon, 16px, `text-ink-soft hover:text-ink`, absolute right-3 top-1/2 -translate-y-1/2

## What to ship

### Component: `chat/src/manus/AnnouncementBanner.svelte`
```svelte
<script>
  import { persisted } from '../localstorage.js';
  import Icon from '../Icon.svelte';
  import { feArrowRight, feX } from '../feather.js';

  const dismissed = persisted('manusBannerDismissed_v1', false);
  export let href = '#'; // overridable; default is no-op
  export let message = 'Manus is now part of Meta — bringing AI to businesses worldwide';
</script>

{#if !$dismissed}
  <div class="relative w-full bg-[#EBE8E0] text-[#1A1A1A]">
    <a {href} class="flex items-center justify-center gap-2 h-10 text-sm font-medium hover:opacity-80">
      <span>{message}</span>
      <Icon icon={feArrowRight} size={16} />
    </a>
    <button
      class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#6B6B6B] hover:text-[#1A1A1A]"
      on:click={() => $dismissed = true}
      aria-label="Dismiss announcement">
      <Icon icon={feX} size={16} />
    </button>
  </div>
{/if}
```

### Mount
In `App.svelte`, render `<AnnouncementBanner />` immediately below `<TopNav />` and above `<main>`. If `feArrowRight` is not yet exported from `chat/src/feather.js`, add it (the project uses a generated re-export pattern — copy the existing pattern for any other arrow icon).

## Acceptance criteria
- Banner is visible on first load on every route.
- Clicking the X dismisses it; reload preserves dismissal.
- Banner uses the muted beige background and centered text with right arrow.
- Banner is full-width and sits under the top nav, above all page content.

## Out of scope
- A real "what's new" landing destination; the banner href is a stub.
