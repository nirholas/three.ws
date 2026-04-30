# Task 05 — Composer input component

## Goal
Replace the existing chat input with a Manus-style composer: a large white rounded card containing a multi-line textarea, a "+" attach button at the bottom-left, an optional row of inline mode pills (e.g. "Slides", "Website", "Design"), and a circular send button at the bottom-right that flips from disabled gray to solid black once the textarea is non-empty.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- Existing input bar lives inside `chat/src/App.svelte`. The current send handler is `complete()` (imported from `convo.js`); the current textarea is bound via `bind:value={input}` (variable name may differ — search for `placeholder=` in `App.svelte`).
- Existing attachment plumbing uses `readFileAsDataURL` from `chat/src/util.js` and a `feather` paperclip icon — re-use this for the "+" button.
- Icons: import from `chat/src/feather.js` (already exports `feArrowUp`, `fePaperclip`, etc.).

## Design tokens
- Card: `bg-white border border-[#E5E3DC] rounded-[20px] shadow-composer` (composer shadow defined in task 01 — fallback: `shadow-[0_1px_2px_rgba(20,20,20,0.04),0_8px_32px_-16px_rgba(20,20,20,0.10)]`).
- Card padding: `pt-5 px-5 pb-3`.
- Min height: 140px; textarea auto-grows to 320px max then scrolls.
- Textarea: transparent bg, no border, no focus ring; placeholder color `#9C9A93`, font Inter 16px, `text-ink` (`#1A1A1A`).
- Footer row: flex items-center justify-between, mt-3.
- "+" button: 36px circle, `border border-[#E5E3DC] bg-white text-[#1A1A1A] hover:bg-[#F0EEE6]`.
- Inline mode pills (between "+" and the right send button): `manus-chip` style; the currently selected mode uses `manus-chip-selected`.
- Send button: 36px circle. Disabled state `bg-[#E7E5DD] text-[#9C9A93]`. Enabled state `bg-black text-white hover:bg-[#1A1A1A]`. Icon `feArrowUp` size 16px.
- Keyboard: Enter sends; Shift+Enter inserts newline; Esc clears focus.

## What to ship

### Component: `chat/src/manus/Composer.svelte`
Props:
```ts
{
  value: string;                          // bind:value
  placeholder?: string;                   // default: 'Assign a task or ask anything'
  mode?: string | null;                   // current mode chip, e.g. 'slides'
  modes?: Array<{ id: string; label: string; icon?: any; color?: string }>; // inline mode pills
  attachments?: Array<{ name: string; url: string }>;
  disabled?: boolean;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onModeClear: () => void;
}
```

Behavior:
- Auto-grow textarea: bind to a CSS variable or use `field-sizing: content` plus a `max-h-[320px]`.
- Show selected mode as an inline pill on the left of the footer, right of the "+". The pill has the mode's icon + label and an "x" to clear (calls `onModeClear`).
- Above the footer row, render attachment chips (`FilePill.svelte` already exists — reuse it).
- The send button is disabled when `value.trim() === ''` AND no attachments; otherwise enabled and triggers `onSend`.

### Wire into `App.svelte`
- Replace the existing input markup with `<Composer ... />`.
- Bind `value` to the existing input variable.
- `onSend` calls the existing `complete()` flow.
- `onAttach` calls the existing attachment handler.
- For the empty-state view (task 04), render the composer in the slot it provides. For the active-conversation view, render it pinned to the bottom as today (task 19 will refine this).

### Existing controls
- The model selector, agent picker, and tool dropdown that currently sit near the input must NOT disappear. Move them to a small icon row just below the composer card on the empty state, with smaller styling (`text-xs text-ink-soft`), or into the "+" menu. Pick whichever is the smallest change.

## Acceptance criteria
- Composer renders as a tall white rounded card matching the Manus screenshots.
- Typing enables the send button (color flips to black); empty disables it.
- Enter sends, Shift+Enter newlines.
- Attachments still work end-to-end (verify with at least one image attach + send).
- Existing model/agent selectors are still reachable.
- The same component is used on the empty state and (when task 19 lands) at the bottom of an active conversation.

## Out of scope
- The chip rows below the composer (task 06).
- The flow-specific UI inside the card when a mode is selected (tasks 14–18).
