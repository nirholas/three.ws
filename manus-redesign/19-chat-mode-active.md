# Task 19 — Active conversation styling (post-first-message)

## Goal
After the first user message is sent, the empty-state landing is replaced by the active conversation view. Restyle this view to match the Manus aesthetic: page bg `bg-paper`, message column centered with max-width 760px, user messages right-aligned in a soft gray bubble, assistant messages full-width with no bubble (just typography), composer pinned to the bottom with the same rounded card from task 05, and the sidebar reappearing on the left.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- Active view condition: `convo.messages.length > 0`.
- Message component: `chat/src/Message.svelte` (currently 599 lines; preserve all logic, only restyle).
- Composer: `chat/src/manus/Composer.svelte` (task 05).
- Sidebar: existing in `App.svelte`.

## Design tokens
- Page bg: `bg-paper`.
- Conversation column: `max-w-[760px] mx-auto px-6`.
- User bubble: `bg-[#EBE8E0] text-[#1A1A1A] rounded-2xl px-4 py-3 max-w-[78%] ml-auto`.
- Assistant message: no bubble. `text-[#1A1A1A] text-[15px] leading-7 prose-sm prose-neutral`. Use the existing markdown styles but ensure the `prose` class targets the new tokens (override link color to `#1A1A1A`, code block bg to `bg-paper-deep`).
- Toolcalls / artifacts already styled — leave them, only ensure they sit inside the 760px column.
- Reasoning expand chevron: `text-[#9C9A93]`.
- Sidebar: keep current functionality; restyle background to `bg-paper`, border `border-rule`, hover row `hover:bg-paper-deep`, active row `bg-paper-deep`, conversation title in 14px ink, timestamp 12px ink-soft.
- Composer pinned: `sticky bottom-4` inside a centered column; same `rounded-composer` card as task 05; add a soft top fade `bg-gradient-to-t from-paper to-transparent` 24px above so the column visually fades into the composer.

## What to ship

### 1. Restyle `Message.svelte`
- Wrap each message in a `flex` row. If `role === 'user'`, justify-end; otherwise justify-start.
- Replace any existing bubble classes for user with the user-bubble token above.
- Remove any bubble for assistant; just render the prose body.
- For tool calls, keep the existing `Toolcall` and `ToolcallButton` components but ensure spacing matches (`my-3` between blocks).

### 2. Restyle conversation column in `App.svelte`
- The container that holds the message stream: `max-w-[760px] mx-auto px-6 pb-32`.
- Bottom padding 128px to leave room for the pinned composer.

### 3. Pinned composer
- Wrap the composer in `<div class="sticky bottom-4 max-w-[760px] mx-auto px-6 z-30">`.
- Add the gradient fade above: `<div class="pointer-events-none absolute -top-6 inset-x-0 h-6 bg-gradient-to-t from-paper to-transparent" />`.
- The composer itself shouldn't show the inline mode pill in active mode unless `$mode` is set. Default behavior is plain composer.

### 4. Sidebar
- Restyle to `bg-paper border-r border-rule w-[260px]` on `md+` screens; collapsible to 0 on small screens.
- Conversation list rows: `flex items-center px-3 h-9 rounded-md text-sm`, hover/active per tokens above.
- "New chat" button at the top: `manus-btn-primary` full width with leading `+` icon.

### 5. Mode pill behavior in active chat
- If `$mode` is set when the user lands on an active conversation, the inline mode pill stays visible inside the composer footer. Clicking the `x` on the pill clears `$mode`.

## Acceptance criteria
- Sending the first message smoothly transitions from empty state to active view (no jarring layout jump).
- Conversation reads as a centered single-column layout with right-aligned beige user bubbles and bubble-less assistant text.
- Composer is pinned to the bottom with a soft fade above it; remains usable while scrolling history.
- Sidebar is back, restyled, and shows the conversation list.
- All existing chat features (tool calls, attachments, model switch, agent picker) still work.

## Out of scope
- Building new tool UIs.
- Anything on the empty state (tasks 04–18).
