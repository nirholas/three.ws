# Task 02 — Top navigation bar

## Goal
Add a Manus-style top navigation: serif `manus` wordmark on the left, six center nav items (`Features`, `Solutions`, `Resources`, `Events`, `Business`, `Pricing`), and `Sign in` / `Sign up` on the right. Each center item is a hover trigger for a dropdown that other tasks fill in — this task only wires up the bar and the trigger buttons (empty stubs are fine).

## Codebase context
- Stack: Svelte 4 + Vite + Tailwind. Source root: `/workspaces/3D-Agent/chat/`.
- Main shell: `chat/src/App.svelte` (the existing app renders into `#app`).
- Add a `route` store at `chat/src/stores.js` if it doesn't exist:
  ```js
  import { writable } from 'svelte/store';
  export const route = writable('chat');
  ```
- Persist via `location.hash`: on load read `location.hash.slice(1) || 'chat'`; on `route` change set `location.hash`.

## Design tokens (use exactly)
- Page bg: `bg-paper` (`#F5F4EF`)
- Border: `border-rule` (`#E5E3DC`)
- Text primary: `text-ink` (`#1A1A1A`)
- Text muted: `text-ink-soft` (`#6B6B6B`)
- Logo font: `font-serif` (Lora, weight 600), size 22px, lowercase
- Nav link font: Inter 500, 14px, color `text-ink`, hover `text-ink-soft`
- Sign in button: `bg-black text-white rounded-full px-4 h-9 text-sm font-medium`
- Sign up button: `bg-white border border-rule text-ink rounded-full px-4 h-9 text-sm font-medium`

If the design tokens above are not yet defined in Tailwind, use literal hex values inline: `bg-[#F5F4EF]`, `border-[#E5E3DC]`, `text-[#1A1A1A]`, `text-[#6B6B6B]`.

## What to ship

### Component: `chat/src/manus/TopNav.svelte`
```
- <header> sticky top-0 z-40 bg-paper
  - max-width 1240px, mx-auto, h-14, px-6
  - flex items-center justify-between
  - LEFT: <button> that sets route='chat' — shows a small bot/logo SVG (use any feather icon temporarily) and the wordmark "manus" in font-serif
  - CENTER: <nav> hidden on <md, flex on md+
    - 6 buttons: Features, Solutions, Resources, Events, Business, Pricing
    - Each: h-14 px-3 inline-flex items-center text-sm font-medium text-ink hover:text-ink-soft
    - First 5 are dropdown triggers — wire up { isOpen: bool } state per item.
      Hovering for >120ms or clicking opens the dropdown.
      Mouse-leave with 200ms grace closes it.
      Render a placeholder <div class="manus-card shadow-pop p-4 w-[420px]">Coming soon</div>
      anchored below the trigger (use absolute positioning inside a relative wrapper).
      Other tasks (08–11) will replace those placeholder bodies.
    - "Pricing" is a plain link: sets route='pricing'.
  - RIGHT: two buttons
    - "Sign in" (black pill) → sets route='signin'
    - "Sign up" (outlined pill) → sets route='signup'
```

### Mount in `App.svelte`
- Import `TopNav` and place it as the first child of the app root, above any existing chat layout. The chat content becomes `<main>` below it.
- Existing sidebar and chat shell stay as-is; just leave room (the existing layout already scrolls inside its own container).

### Mobile
- Below `md` (880px breakpoint per Tailwind config), hide center nav and right buttons; show a hamburger button that toggles a full-width sheet listing the same items (no nested dropdowns on mobile — each item is a flat link).

## Acceptance criteria
- The bar is present on every route.
- Hovering "Features", "Solutions", "Resources", "Events", "Business" opens a placeholder card; clicking outside or hovering away closes it after the 200ms grace.
- Clicking "Pricing" updates the URL hash to `#pricing` and sets the `route` store; clicking the logo sets it back to `chat`.
- "Sign in" / "Sign up" set `route` to `signin` / `signup` (target pages may render a placeholder until task 13 lands).
- Existing chat behavior is intact.

## Out of scope
- Dropdown contents — only stubs here.
- Pricing/auth page bodies (tasks 12 and 13).
