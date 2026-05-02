# Plugin / Skills Marketplace — Completion

**Deliverable:** Fully complete `chat/src/SkillsMarketplaceModal.svelte` — fix per-plugin error feedback, add library retry, clear publish error on tab change, harden library install-state detection, and clean up minor UI inconsistencies.

**One PR. No scope creep.**

---

## Context

`chat/src/SkillsMarketplaceModal.svelte` is a ~530-line Svelte component (plus template) that provides three tabs: **Browse** (skills marketplace), **Library** (LobeHub-compatible plugin registry), and **Publish** (form to publish a new skill). The file is at `chat/src/SkillsMarketplaceModal.svelte`.

Most of the component is complete and working. This prompt fixes the remaining gaps: silent manifest failures, no retry on library load errors, stale publish errors across tab switches, and an install-state check that can silently mismatch.

---

## Current code (read before touching)

Key lines to understand:

```
Line 6–8    view = 'browse' | 'library' | 'publish'
Line 57     publishError — set on publish failure, NEVER cleared on tab change
Line 421–445 loadPluginLibrary() — no retry, no per-plugin error tracking
Line 459    isLibraryPluginInstalled() — checks g.id === 'lib:${identifier}' but no fallback
Line 463–498 installLibraryPlugin() — throws, notifies, but no per-plugin error UI
Line 500–501 libraryLoaded, lazy-load trigger — once loaded, never retried
Line 493    catch block — catch {} eats the error silently before notify() fires
```

---

## Exact changes required

### 1 — Clear `publishError` on tab change

Find the `view` declaration at line 8. Below it, add a reactive statement:

```js
$: if (view !== 'publish') publishError = null;
```

This ensures the stale error from a previous publish attempt is gone when the user switches away and back.

---

### 2 — Library: retry button on load failure

Add a `libraryError` flag alongside `libraryLoaded`:

```js
let libraryLoaded = false;
let libraryError = false;
```

In `loadPluginLibrary()`, set `libraryError` on failure and clear it at the start:

```js
async function loadPluginLibrary() {
    loadingLibrary = true;
    libraryError = false;
    try {
        const base = $pluginLibraryUrl?.replace(/\/+$/, '');
        const res = await fetch(`${base}/index.en-US.json`);
        if (res.ok) {
            const json = await res.json();
            libraryPlugins = (json.plugins || []).map((p) => ({
                identifier: p.identifier,
                name: p.meta?.title || p.identifier,
                description: p.meta?.description || '',
                avatar: p.meta?.avatar || '🔧',
                tags: p.meta?.tags || [],
                category: p.meta?.category || '',
                manifestUrl: p.manifest || `${base}/${p.identifier}.json`,
            }));
        } else {
            libraryError = true;
        }
    } catch (err) {
        console.warn('[plugin-library] failed to load registry index:', err);
        libraryError = true;
    }
    loadingLibrary = false;
    libraryLoaded = true;
}
```

Change the lazy-load trigger so a retry is possible (allow re-loading when `libraryError` is true):

```js
// Before:
$: if (view === 'library' && !libraryLoaded && !loadingLibrary) loadPluginLibrary();

// After:
$: if (view === 'library' && !loadingLibrary && (!libraryLoaded || libraryError)) loadPluginLibrary();
```

Wait — this would re-fire every time the user switches to the library tab after an error, which is the desired retry behavior. But it would also re-fire on success if `libraryError` stays true. Make sure `libraryError = false` is cleared at the start of `loadPluginLibrary()` (already done above) so on success the trigger won't re-fire.

---

### 3 — Per-plugin error state in the install button

Add a `libraryFailed` map to track which plugins had a manifest fetch error:

```js
let libraryFailed = {};
```

In `installLibraryPlugin()`, set/clear it:

```js
async function installLibraryPlugin(plugin) {
    libraryInstalling = { ...libraryInstalling, [plugin.identifier]: true };
    libraryFailed = { ...libraryFailed, [plugin.identifier]: false };
    try {
        const base = $pluginLibraryUrl?.replace(/\/+$/, '');
        const url = plugin.manifestUrl || `${base}/${plugin.identifier}.json`;
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[plugin-library] manifest fetch failed for ${plugin.identifier}: HTTP ${res.status} ${url}`);
            throw new Error(`fetch failed (${res.status})`);
        }
        const data = await res.json();
        const api = data.manifest?.api || [];
        if (api.length === 0) {
            notify('Plugin has no callable functions', 'error');
            return;
        }
        const group = {
            id: `lib:${plugin.identifier}`,
            name: plugin.name,
            schema: api.map((fn) => ({
                type: 'function',
                function: {
                    name: fn.name,
                    description: fn.description || '',
                    parameters: fn.parameters || { type: 'object', properties: {} },
                },
            })),
        };
        toolSchema.update((groups) => [...groups.filter((g) => g.id !== group.id), group]);
        notify(`${plugin.name} installed`, 'success');
    } catch (err) {
        libraryFailed = { ...libraryFailed, [plugin.identifier]: true };
        notify(`Failed to install ${plugin.name}`, 'error');
    } finally {
        libraryInstalling = { ...libraryInstalling, [plugin.identifier]: false };
    }
}
```

---

### 4 — Harden `isLibraryPluginInstalled`

Add a fallback that matches by name if the `id` field is missing (covers older schema entries that were installed before the `id` field was added):

```js
function isLibraryPluginInstalled(identifier) {
    return $toolSchema.some(
        (g) => g.id === `lib:${identifier}` || (!g.id && g.name === identifier)
    );
}
```

---

### 5 — Template: wire up library error state and per-plugin error badge

**Library error banner** — in the Library tab template, right below the `loadingLibrary` spinner block, add:

```svelte
{#if libraryError && !loadingLibrary}
    <div class="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-700">
        <span>Failed to load plugin registry</span>
        <button
            class="ml-3 underline hover:text-red-900"
            on:click={() => { libraryLoaded = false; loadPluginLibrary(); }}
        >
            Retry
        </button>
    </div>
{/if}
```

**Per-plugin failed badge** — in the plugin card Install button area, show a small error indicator when `libraryFailed[plugin.identifier]` is true. Find the install button in the Library tab template (it calls `installLibraryPlugin(plugin)`) and wrap it like:

```svelte
<div class="flex flex-col items-end gap-0.5">
    <button
        class="rounded-full px-2.5 py-1 text-[11px] font-medium transition
            {isLibraryPluginInstalled(plugin.identifier)
                ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600'
                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}
            disabled:opacity-50"
        disabled={!!libraryInstalling[plugin.identifier]}
        on:click={() =>
            isLibraryPluginInstalled(plugin.identifier)
                ? toolSchema.update((g) => g.filter((x) => x.id !== `lib:${plugin.identifier}`))
                : installLibraryPlugin(plugin)}
    >
        {#if libraryInstalling[plugin.identifier]}
            Installing…
        {:else if isLibraryPluginInstalled(plugin.identifier)}
            Remove
        {:else}
            Install
        {/if}
    </button>
    {#if libraryFailed[plugin.identifier]}
        <span class="text-[10px] text-red-500">Install failed — retry?</span>
    {/if}
</div>
```

Note: the exact current button markup in the Library tab must be found and replaced. Search the template for `installLibraryPlugin` and wrap that button's parent.

---

### 6 — Minor: clear `publishError` reactively (belt + suspenders)

In the Publish tab template, also clear `publishError` when the form inputs change, so an old error doesn't linger while the user is actively editing:

```svelte
<!-- On the name input in the Publish form -->
on:input={(e) => { handleNameInput(e); publishError = null; }}
```

Apply the same `publishError = null` inline to the description, schema, and slug inputs in the publish form.

---

## What not to touch

- **Browse tab** — `loadSkills`, `toggleInstall`, `toggleExpand`, `submitRating`, `copySlug` are all working correctly. Do not refactor them.
- **Publish tab logic** — `publishSkill()`, `validateSchema()`, `nameToSlug()` are correct. Only add the reactive clear and the inline input clears.
- **Modal.svelte** — no changes needed.
- **stores.js** — no changes needed.

---

## Test plan

1. Open Skills Marketplace → Browse tab loads, categories load
2. Switch to **Library** tab:
   - Plugins load from `pluginLibraryUrl`
   - If URL is wrong/unreachable: red banner with "Retry" button appears (not a blank page)
   - Clicking Retry re-fires the fetch
3. Click **Install** on a plugin with a valid manifest → "installed" toast, button changes to "Remove"
4. Click **Install** on a plugin with a broken/404 manifest → error toast + "Install failed — retry?" text under the button
5. Click **Remove** on an installed library plugin → removed from toolSchema immediately (no API call)
6. Open **Publish** tab, fill form, hit Publish, get error → error message shows
7. Switch to Browse → switch back to Publish → **error is gone**
8. Fill form, trigger validation error → error shows. Start typing in name field → error clears

---

## Reporting block

At the end of your work, output:

```
SHIPPED:
- [ ] publishError cleared on tab change
- [ ] Library load failure + retry banner
- [ ] Per-plugin install error badge
- [ ] isLibraryPluginInstalled hardened with name fallback
- [ ] publishError clears on form input
- [ ] libraryFailed tracked per plugin

SKIPPED: (list anything deferred and why)

BROKEN: (anything that regressed)

NOTICED: (unrelated bugs seen but not fixed)
```
