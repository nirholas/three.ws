# Feature: Complete Message Branching — Regenerate, Edit, Branch Navigation

## Goal
The version/branching skeleton already exists in the codebase (the `vid`, `saveVersion`, `shiftVersion` system). Complete it with proper UX: show a branch navigator on **assistant messages** (not just user messages), add a copy-to-clipboard button on all messages, make the version counter clearly visible, and add keyboard shortcut support (Alt+← / Alt+→) for navigating versions.

## Success criteria
1. After regenerating an assistant message (clicking ↻), the **user message** immediately before it shows a branch navigator (`← 1/2 →`) — this already works. Additionally, make the **assistant message** show its variant position when there are multiple versions.
2. Editing a user message (clicking ✏, changing text, submitting) creates a branch and shows the navigator — this already works. Verify it and fix any edge cases.
3. A copy button (clipboard icon) appears in the message action bar for all non-system messages. Clicking it copies `message.content` to the clipboard. Show a brief ✓ checkmark feedback for 1.5s.
4. The version navigator is visible enough — increase contrast or size if the current styling is too subtle.
5. Pressing `Alt+←` / `Alt+→` on the keyboard while focused in the chat navigates versions for the most recent branched message.
6. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**Key file: `src/Message.svelte`** — renders each message. Already has:
- `saveVersion(message, i)` — saves the pre-edit/pre-regen snapshot into `convo.versions[message.vid]`
- `shiftVersion(dir, message, i)` — navigates between saved versions
- A branch navigator rendered at the bottom of user messages when `convo.versions?.[message.vid]` exists (around line 433)
- A regenerate button (feRefreshCw icon) that creates branches (around line 496)
- An edit button (feEdit2) that triggers `editing: true` (around line 477)

**Version data structure** (in `src/App.svelte`):
```js
convo.versions = {
  [vid]: [
    null,                          // <-- null = active branch
    [message, ...subsequentMsgs],  // saved branch 1
    [message, ...subsequentMsgs],  // saved branch 2
    ...
  ]
}
```
The `null` entry marks which branch is currently active. Navigating shifts `null` to a different index.

**`message.vid`** — version group ID (UUID), shared across all versions of a message. Set when the first branch is created.

**Current branch navigator logic** (Message.svelte ~line 433):
```svelte
{#if message.role === 'user' && convo.versions?.[message.vid]}
  {@const versions = convo.versions[message.vid]}
  {@const versionIndex = versions.findIndex((v) => v === null)}
  <div class="flex items-center md:gap-x-1">
    <button disabled={versionIndex === 0} on:click={() => shiftVersion(-1, message, i)}>
      <Icon icon={feChevronLeft} ... />
    </button>
    <span class="text-xs tabular-nums">{versionIndex + 1} / {versions.length}</span>
    <button disabled={versionIndex === versions.length - 1} on:click={() => shiftVersion(1, message, i)}>
      <Icon icon={feChevronRight} ... />
    </button>
  </div>
{/if}
```

**Regenerate on assistant message** (Message.svelte ~line 512):
```js
// saves version on previousUserMessage (convo.messages[i - 1])
saveVersion(previousUserMessage, i - 1);
convo.messages = convo.messages.slice(0, i);
submitCompletion();
```
This means the assistant's alternatives are tracked under the **user message's** `vid` — which is correct. The navigator already appears on the user message. Keep this.

**`feather.js`** — check which icons are available. You'll need:
- Copy icon: look for `feCopy` or `feClipboard`
- Check icon: `feCheck` already imported in Message.svelte

## Implementation

### 1. Add assistant message branch indicator

After the user-message version navigator block, add a parallel block for assistant messages. The assistant message is at index `i`; the preceding user message is at `i - 1` (if it exists). The version data is stored on the user message's `vid`.

```svelte
{#if message.role === 'assistant' && i > 0}
  {@const prevMsg = convo.messages[i - 1]}
  {#if prevMsg?.vid && convo.versions?.[prevMsg.vid]}
    {@const versions = convo.versions[prevMsg.vid]}
    {@const versionIndex = versions.findIndex((v) => v === null)}
    {#if versions.length > 1}
      <div class="flex items-center gap-x-1 text-slate-400">
        <button
          class="group flex h-6 w-6 shrink-0 rounded-full"
          disabled={versionIndex === 0}
          on:click={() => shiftVersion(-1, prevMsg, i - 1)}
        >
          <Icon icon={feChevronLeft} class="m-auto h-3 w-3 group-disabled:opacity-30" />
        </button>
        <span class="text-[11px] tabular-nums">{versionIndex + 1}/{versions.length}</span>
        <button
          class="group flex h-6 w-6 shrink-0 rounded-full"
          disabled={versionIndex === versions.length - 1}
          on:click={() => shiftVersion(1, prevMsg, i - 1)}
        >
          <Icon icon={feChevronRight} class="m-auto h-3 w-3 group-disabled:opacity-30" />
        </button>
      </div>
    {/if}
  {/if}
{/if}
```

Place this in the same action bar row as the user-message navigator (the `absolute bottom-[-32px]` div), inside an `{:else if message.role === 'assistant'}` branch.

### 2. Copy-to-clipboard button

Add a copy button to the action bar (the `opacity-0 group-hover:opacity-100` row at the bottom right of each message):

```svelte
<script>
  let copied = false;
  async function copyContent() {
    await navigator.clipboard.writeText(message.content || '');
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<button
  class="group/actions flex h-7 w-7 shrink-0 rounded-lg hover:bg-gray-100"
  on:click={copyContent}
  title="Copy"
>
  {#if copied}
    <Icon icon={feCheck} strokeWidth={3} class="m-auto h-[12px] w-[12px] text-green-500" />
  {:else}
    <Icon icon={feCopy} strokeWidth={3} class="m-auto h-[12px] w-[12px] text-slate-600 group-hover/actions:text-slate-800" />
  {/if}
</button>
```

Check `src/feather.js` for the copy icon name. If `feCopy` doesn't exist, check for `feClipboard`. If neither exists, add an export to `feather.js` by copying the SVG path from Feather Icons (the `copy` icon). The SVG paths are small — just add the export inline.

### 3. Keyboard navigation for versions

In `src/App.svelte`, add a `keydown` handler (on `window` or on the chat container) that fires `Alt+←` / `Alt+→`:

```js
function handleKeydown(event) {
  if (!event.altKey) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  // find the last user message that has versions
  const branchedMessages = convo.messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.vid && convo.versions?.[m.vid]?.length > 1);
  if (branchedMessages.length === 0) return;
  const { m, i } = branchedMessages[branchedMessages.length - 1];
  const dir = event.key === 'ArrowLeft' ? -1 : 1;
  shiftVersion(dir, m, i);
  event.preventDefault();
}
```

Wire it: `<svelte:window on:keydown={handleKeydown} />` already exists in App.svelte or add it. Import `shiftVersion` into scope (it's defined in App.svelte, so this is already available).

### 4. Version counter styling

The current `text-xs tabular-nums` version counter is subtle. Change it to be slightly more visible:
- Add `font-medium` to the span
- On hover of the message group (already has `group` class), make it always visible rather than opacity-0

The existing action bar has `opacity-0 group-hover:opacity-100`. Move the version counter OUT of this opacity-0 div (it's already in a separate div at `bottom-[-32px]`) — make it always visible at low opacity (`opacity-50 group-hover:opacity-100`).

## Constraints
- Do not restructure the version data model — it's already stored and loading correctly.
- The regenerate and edit flows are already working — don't refactor them, only add the assistant navigator and copy button.
- `feather.js` additions: only add the `copy` icon SVG path if it's missing. Don't reorganize the file.
- Run `npm run build` (from `chat/`) and confirm it passes.
