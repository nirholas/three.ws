# Agent Marketplace — Completion

**Deliverable:** Fully complete `chat/src/AgentPicker.svelte` — add marketplace pagination, sort/category filters, a detail preview panel before selection, proper error/empty states, and library pagination.

**One PR. No scope creep.**

---

## Context

`AgentPicker.svelte` is a popover that lets users pick an agent to power their conversation. It has three sections: **My Agents**, **Marketplace**, and **Public Library**. The component is located at `chat/src/AgentPicker.svelte` and dispatches a `'pick'` event to `App.svelte`.

The marketplace section calls `GET /api/marketplace/agents?q=&sort=&category=&cursor=` — the API already supports pagination via `next_cursor` and all filter params. The component ignores them all today.

---

## Current code (read this before touching anything)

`chat/src/AgentPicker.svelte` — full file, ~326 lines. Key problems:

```
Line 75–86   searchMarket(q)   — fires one request, ignores cursor/sort/category
Line 107–118 filteredLibrary   — hard-caps at 60, no way to see more
Line 253–254 marketAgents empty — shows i18n key "noAgentsFound" with no network error context
Line 289–290 library empty     — "Library unavailable" even when it just means zero search results
Line 319–321 library overflow  — "showing 60 of X" with no Load More
```

---

## Exact changes required

### 1 — Marketplace: sort + category state + pagination

Add state vars near the top of `<script>`:

```js
let marketSort = 'popular';       // 'popular' | 'recent' | 'name'
let marketCategory = '';          // '' = all
let marketCursor = null;          // next_cursor from API
let marketHasMore = false;
let marketError = false;
```

Replace `searchMarket(q)` with:

```js
async function searchMarket(q, reset = true) {
    loadingMarket = true;
    marketError = false;
    if (reset) { marketCursor = null; marketAgents = []; }
    try {
        const p = new URLSearchParams();
        if (q) p.set('q', q);
        if (marketSort) p.set('sort', marketSort);
        if (marketCategory) p.set('category', marketCategory);
        if (!reset && marketCursor) p.set('cursor', marketCursor);
        const res = await fetch(`/api/marketplace/agents?${p}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const items = json.data?.items ?? [];
        marketAgents = reset ? items : [...marketAgents, ...items];
        marketCursor = json.data?.next_cursor ?? null;
        marketHasMore = !!marketCursor;
    } catch {
        marketError = true;
    }
    loadingMarket = false;
}
```

Update the `onInput` handler to reset when typing:

```js
function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchMarket(query, true), 300);
}
```

Add sort/category change handlers:

```js
function setMarketSort(s) { marketSort = s; searchMarket(query, true); }
function setMarketCategory(c) { marketCategory = c === marketCategory ? '' : c; searchMarket(query, true); }
function loadMoreMarket() { searchMarket(query, false); }
```

### 2 — Marketplace: detail preview before pick

Add state:

```js
let previewAgent = null;   // agent being previewed — null = grid view
let previewLoading = false;
```

Replace the card `on:click` in the Marketplace section from `() => pick(agent)` to:

```js
on:click={() => openPreview(agent)}
```

Add the `openPreview` function:

```js
async function openPreview(agent) {
    previewAgent = agent;
    previewLoading = true;
    try {
        // Try own agents first, then marketplace
        const urls = [
            `/api/agents/${agent.id}`,
            `/api/marketplace/agents/${agent.id}`,
        ];
        for (const url of urls) {
            try {
                const res = await fetch(url, { credentials: 'include' });
                if (res.ok) {
                    const json = await res.json();
                    previewAgent = json.agent ?? json.data?.agent ?? agent;
                    break;
                }
            } catch {}
        }
    } finally {
        previewLoading = false;
    }
}
```

### 3 — Library: proper empty state + load-more

Change the library slice from `.slice(0, 60)` to `.slice(0, libraryLimit)` and add:

```js
let libraryLimit = 60;
function loadMoreLibrary() { libraryLimit += 60; }
```

Change the empty-state message:

```
Before: query ? 'No matches in library' : 'Library unavailable'
After:  libraryError ? 'Library unavailable' : query ? 'No matches' : 'No agents'
```

Track `libraryError`:

```js
let libraryError = false;

async function loadLibrary() {
    loadingLibrary = true;
    libraryError = false;
    try {
        const base = $agentLibraryUrl?.replace(/\/+$/, '') || '';
        if (!base) { libraryError = true; return; }
        const res = await fetch(`${base}/index.en-US.json`);
        if (res.ok) {
            const json = await res.json();
            libraryAgents = (json.agents || []).map(normalizeLibraryAgent);
        } else {
            libraryError = true;
        }
    } catch {
        libraryError = true;
    }
    loadingLibrary = false;
}
```

### 4 — Template changes

**Marketplace section** — replace the entire `<!-- Marketplace -->` `<div>` block with:

```svelte
<div>
    <div class="flex items-center justify-between mb-1.5">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{$t('marketplace')}</p>
        <div class="flex items-center gap-1.5">
            <select
                class="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-slate-600 outline-none"
                bind:value={marketSort}
                on:change={() => searchMarket(query, true)}
            >
                <option value="popular">Popular</option>
                <option value="recent">Recent</option>
                <option value="name">A–Z</option>
            </select>
        </div>
    </div>

    {#if loadingMarket && marketAgents.length === 0}
        <p class="text-center text-[12px] text-slate-400 py-3">{$t('loading')}</p>
    {:else if marketError}
        <p class="text-[12px] text-slate-400 py-2">
            Failed to load — <button class="underline" on:click={() => searchMarket(query, true)}>retry</button>
        </p>
    {:else if marketAgents.length === 0}
        <p class="text-[12px] text-slate-400 py-2">{$t('noAgentsFound')}</p>
    {:else if previewAgent}
        <!-- Detail preview panel -->
        <div class="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <button class="mb-2 text-[11px] text-slate-400 hover:text-slate-600" on:click={() => previewAgent = null}>
                ← Back
            </button>
            <div class="flex items-start gap-3">
                {#if previewAgent.thumbnail_url}
                    <img src={previewAgent.thumbnail_url} alt={previewAgent.name} class="h-16 w-16 rounded-xl object-cover shrink-0" />
                {:else}
                    <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-[18px] font-bold text-white" style="background:{color(previewAgent.id)}">{initials(previewAgent.name)}</div>
                {/if}
                <div class="min-w-0 flex-1">
                    <p class="text-[13px] font-semibold text-slate-800 leading-tight">{previewAgent.name}</p>
                    {#if previewAgent.category}
                        <p class="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{previewAgent.category}</p>
                    {/if}
                    <p class="mt-1 text-[12px] text-slate-600 leading-snug line-clamp-3">{previewAgent.description || ''}</p>
                    {#if previewAgent.tags?.length}
                        <div class="mt-1.5 flex flex-wrap gap-1">
                            {#each previewAgent.tags.slice(0, 4) as tag}
                                <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{tag}</span>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
            {#if previewLoading}
                <p class="mt-2 text-[11px] text-slate-400 animate-pulse">Loading details…</p>
            {/if}
            <button
                class="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-indigo-700"
                on:click={() => pick(previewAgent)}
            >
                Use this agent
            </button>
        </div>
    {:else}
        <div class="grid grid-cols-3 gap-2">
            {#each marketAgents as agent}
                <button
                    class="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition hover:bg-gray-50
                        {$localAgentId === agent.id ? 'bg-indigo-50 ring-2 ring-indigo-300' : 'ring-1 ring-gray-100'}"
                    on:click={() => openPreview(agent)}
                    title={agent.description || agent.name}
                >
                    {#if agent.thumbnail_url}
                        <img src={agent.thumbnail_url} alt={agent.name} class="h-14 w-14 rounded-lg object-cover" loading="lazy" />
                    {:else}
                        <div class="flex h-14 w-14 items-center justify-center rounded-lg text-[14px] font-bold text-white" style="background:{color(agent.id)}">{initials(agent.name)}</div>
                    {/if}
                    <p class="w-full truncate text-[11px] font-medium text-slate-700 leading-tight">{agent.name}</p>
                </button>
            {/each}
        </div>
        {#if marketHasMore}
            <button
                class="mt-2 w-full rounded-lg border border-slate-200 py-1.5 text-[12px] text-slate-500 hover:bg-gray-50"
                disabled={loadingMarket}
                on:click={loadMoreMarket}
            >
                {loadingMarket ? 'Loading…' : 'Load more'}
            </button>
        {/if}
    {/if}
</div>
```

**Library section** — replace the overflow count line and fix the empty state:

```svelte
<!-- Change empty state line -->
{:else if filteredLibrary.length === 0}
    <p class="text-[12px] text-slate-400 py-2">
        {libraryError ? 'Library unavailable' : query ? 'No matches in library' : 'No agents'}
    </p>

<!-- Replace overflow footer -->
{#if !query && libraryAgents.length > filteredLibrary.length}
    <button
        class="mt-1.5 w-full rounded-lg border border-slate-200 py-1.5 text-[12px] text-slate-500 hover:bg-gray-50"
        on:click={loadMoreLibrary}
    >
        Show more ({libraryAgents.length - filteredLibrary.length} hidden)
    </button>
{/if}
```

---

## What not to touch

- `loadMine()` and My Agents section — already complete
- `pick()`, `clear()`, `initials()`, `color()`, `normalizeLibraryAgent()`, `loadLibraryAgentDetail()` — keep as-is
- `App.svelte` — no changes needed; the `on:pick` dispatch interface is unchanged

---

## Test plan

1. Open the agent picker — My Agents loads, Marketplace loads, Library loads
2. Type in search box — debounce fires, marketplace re-queries, library filters client-side
3. Change marketplace sort dropdown — grid reloads with new sort
4. If marketplace returns >24 results, "Load more" button appears and appends next page
5. Click a marketplace agent card → detail panel slides in with description and tags
6. Click "Use this agent" → agent loads into conversation, popover closes
7. Click ← Back → returns to grid
8. If `agentLibraryUrl` is unreachable → shows "Library unavailable" not a blank panel
9. If library has >60 agents and no query → "Show more" button appears

---

## Reporting block

At the end of your work, output:

```
SHIPPED:
- [ ] Marketplace sort dropdown
- [ ] Marketplace pagination / Load more
- [ ] Agent detail preview panel
- [ ] Library error state
- [ ] Library Load more

SKIPPED: (list anything deferred and why)

BROKEN: (anything that regressed)

NOTICED: (unrelated bugs seen but not fixed)
```
