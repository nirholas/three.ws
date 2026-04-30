# Task 04 — Chat Integration: Wire Marketplace into Chat UI

## Goal
Replace the existing "Tool Packs" button/modal in the chat toolbar with the new Skills
Marketplace modal. Installed skills from the marketplace must surface as active tools in the
LLM conversation exactly like the current hardcoded tool packs.

## Prerequisites
Tasks 01, 02, and 03 must be complete.

## Context — what exists today

### ToolPackModal (current)
- `/chat/src/ToolPackModal.svelte` — simple modal that installs hardcoded packs from `tools.js`
  into the `toolSchema` store. It stays in the codebase (don't delete it) but is no longer
  the primary entry point.

### App.svelte (main chat component, ~63KB)
- Located at `/chat/src/App.svelte`
- Read the **entire file** before making any changes — it is large and dense.
- Find where `ToolPackModal` is imported and rendered.
- Find where the toolbar button that opens it is rendered.
- Find where `toolSchema` is consumed to build the tool list sent to the LLM.

### stores.js
- `toolSchema` — persisted writable, shape: `Array<{ name: string, schema: ToolDef[] }>`
- The new `SkillsMarketplaceModal` (Task 03) already writes to this store on install/uninstall.

## Changes to make

### 1. App.svelte — swap modal and button

Find the import of `ToolPackModal` and add an import for `SkillsMarketplaceModal`:
```js
import SkillsMarketplaceModal from './SkillsMarketplaceModal.svelte';
```

Find the state variable that controls the ToolPackModal's `open` prop (it will be something
like `let showToolPacks = false`). Add a parallel variable:
```js
let showSkillsMarketplace = false;
```

Find the toolbar button that opens ToolPackModal. Add a second button immediately after it:
```svelte
<button
  class="..."   <!-- match the style of the existing tool-packs button exactly -->
  on:click={() => (showSkillsMarketplace = true)}
  title="Skills Marketplace"
>
  <!-- Use an appropriate icon from feather.js — "grid" or "package" works -->
  <svelte:component this={Icon} name="grid" size={16} />
  <span class="hidden sm:inline">Skills</span>
</button>
```

Add the modal instance near the ToolPackModal instance:
```svelte
<SkillsMarketplaceModal bind:open={showSkillsMarketplace} />
```

### 2. Sync on open — pre-populate installed state
When `showSkillsMarketplace` becomes true, the modal should show which skills are already
installed (i.e. present in `toolSchema`). The `SkillsMarketplaceModal` already handles this by
comparing API results against `$toolSchema` on the Browse fetch — no extra wiring needed.

### 3. Verify toolSchema → LLM tools pipeline
Search `App.svelte` for where `toolSchema` is read to build the tool array sent to the LLM
provider (it likely maps over `$toolSchema` and flattens `.schema` arrays). Confirm it still
works correctly — the marketplace installs skills in the same format as the existing ToolPackModal
(`{ name, schema: ToolDef[] }`), so no change should be needed. If the pipeline looks different,
document exactly what you found and adjust accordingly.

### 4. Active skills indicator
Find where the toolbar shows the count of active tools (if any). Update it to include
marketplace-installed skills in the count. If no such indicator exists, add a simple badge
on the Skills button showing `$toolSchema.length` when > 0:
```svelte
{#if $toolSchema.length > 0}
  <span class="ml-1 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] text-white">
    {$toolSchema.length}
  </span>
{/if}
```

## Constraints
- **Surgical changes only.** Touch only the lines needed. Do not reformat, refactor, or clean up
  unrelated code in App.svelte.
- Do not remove or break the existing ToolPackModal — it should still work.
- Do not change `stores.js`, `tools.js`, `convo.js`, or `providers.js`.
- Match the exact class/style convention of the surrounding toolbar buttons.

## Verification
1. Run `cd /workspaces/3D-Agent/chat && npm run build` — must complete with no errors.
2. Read back the changed section of App.svelte and confirm the new button and modal binding are
   present and syntactically correct.
3. Confirm `ToolPackModal` is still imported and rendered (not removed).
4. Confirm `showSkillsMarketplace` is initialised to `false`.
