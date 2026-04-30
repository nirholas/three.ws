# Task 04 — Empty-state landing layout

## Goal
When the user has no messages in the active conversation, show a centered "What can I do for you?" hero with the composer below it and a row of suggestion chips beneath the composer. The existing sidebar collapses (or is hidden) on the empty state so the layout reads as a single centered column, just like Manus.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- Main shell: `chat/src/App.svelte`. Empty-state condition: `convo.messages.length === 0`.
- The current `App.svelte` already has logic at line ~1451 (`{#if convo.messages.length > 0}`) that gates the message stream. Use this as the seam: render the new landing in the `{:else}` branch.
- Existing sidebar markup is rendered conditionally based on a state variable already present in `App.svelte` (look for `sidebarOpen` or similar near the top of the script).

## Design tokens (use exactly)
- Page bg already `bg-paper` from task 01; do not set bg here.
- Hero: class `manus-hero` (defined in task 01) — fallback inline: `font-serif text-[44px] md:text-[56px] leading-[1.05] tracking-tight font-medium text-[#1A1A1A]`.
- Hero margin-bottom: 36px.
- Column max-width: 760px; horizontal padding: 24px; centered.
- Vertical layout: hero pushed ~22vh from the top of `<main>` so the composer sits roughly mid-screen on a 900px-tall window.

## What to ship

### Component: `chat/src/manus/EmptyState.svelte`
```svelte
<script>
  // The composer + chips are owned by tasks 05/06.
  // Import them and render them as children. While those components are not
  // yet implemented, render a slot so the integrator can drop them in.
</script>

<section class="w-full flex flex-col items-center px-6 pt-[18vh] md:pt-[22vh]">
  <h1 class="manus-hero text-center mb-9">What can I do for you?</h1>
  <div class="w-full max-w-[760px]">
    <slot name="composer" />
  </div>
  <div class="w-full max-w-[760px] mt-4">
    <slot name="chips" />
  </div>
</section>
```

### Wire into `App.svelte`
- Locate the conditional that toggles between the active conversation view and any current empty-state placeholder.
- In the empty-state branch, render `<EmptyState>` and pass the existing composer into the `composer` slot and the new chips row (task 06) into the `chips` slot.
  - If the composer component from task 05 is not yet merged, pass the **existing** input element into the `composer` slot — this task must render something useful even alone.
- Hide the sidebar on the empty state. Two options, pick the smallest diff:
  - If a `sidebarOpen` writable already exists, set it to `false` whenever `convo.messages.length === 0`.
  - Otherwise, wrap the sidebar render in `{#if convo.messages.length > 0}`.
  Restore the sidebar when messages exist (don't permanently remove it).

### Active-state untouched
- When `convo.messages.length > 0`, render the existing chat shell exactly as it works today. No layout changes there (task 19 handles that).

## Acceptance criteria
- Loading the chat with a fresh conversation shows the centered hero "What can I do for you?" in serif font, a composer below it, and an empty chips slot below the composer.
- Sending a first message hides the empty-state landing and reveals the existing chat UI.
- No sidebar is visible while the empty-state landing is shown; the page reads as a centered column under the top nav and announcement banner.
- The hero is vertically centered-ish (≈22vh from the top of the main area) and horizontally centered.

## Out of scope
- The composer's internal redesign (task 05).
- The chip set itself (task 06).
- The active conversation styling (task 19).
