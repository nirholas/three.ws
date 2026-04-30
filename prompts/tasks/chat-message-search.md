# Task: Add conversation search to the chat history sidebar

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` has a history sidebar that shows past conversations grouped by date (today, yesterday, this week, etc.). There is no way to search across conversation history.

The conversations are stored in the `convos` object (a map of id → convo) loaded from IndexedDB. Each `convo.messages` is an array of message objects with `role` and `content` fields.

## What to build

### 1. Add a search input to the history sidebar

Find where the history sidebar renders in `App.svelte` (search for `historyBuckets` — that's where conversations are listed). Add a search input above the conversation list:

```svelte
<script>
    let searchQuery = '';
    $: filteredConvos = searchQuery.trim()
        ? Object.values(convos).filter(c =>
            c.messages.some(m =>
                typeof m.content === 'string' &&
                m.content.toLowerCase().includes(searchQuery.toLowerCase())
            ) ||
            (c.title || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
        : null; // null = show normal historyBuckets
</script>

<input
    type="search"
    placeholder="Search conversations..."
    bind:value={searchQuery}
    class="mx-2 my-2 w-[calc(100%-16px)] rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
/>
```

### 2. Show flat search results when searching

When `filteredConvos` is non-null (user is typing), render a flat list instead of `historyBuckets`:

```svelte
{#if filteredConvos}
    {#if filteredConvos.length === 0}
        <p class="px-3 py-4 text-center text-sm text-slate-400">No conversations found</p>
    {:else}
        {#each filteredConvos.sort((a, b) => b.time - a.time) as c}
            <!-- render same conversation item as the normal list -->
        {/each}
    {/if}
{:else}
    <!-- existing historyBuckets rendering -->
{/if}
```

Find the existing conversation item rendering (the `<button>` or `<a>` that loads a conversation on click) and reuse the same component/markup for search results.

### 3. Clear search when a conversation is selected

When the user clicks a conversation from search results, clear `searchQuery = ''` so the sidebar returns to normal view.

### 4. Highlight the matching snippet (optional but nice)

For each search result, show a short excerpt of the matching message content under the title:

```svelte
{@const matchingMsg = c.messages.find(m =>
    typeof m.content === 'string' &&
    m.content.toLowerCase().includes(searchQuery.toLowerCase())
)}
{#if matchingMsg}
    <p class="truncate text-xs text-slate-400">
        ...{matchingMsg.content.slice(
            Math.max(0, matchingMsg.content.toLowerCase().indexOf(searchQuery.toLowerCase()) - 20),
            matchingMsg.content.toLowerCase().indexOf(searchQuery.toLowerCase()) + 60
        )}...
    </p>
{/if}
```

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte` — add search state, input, and conditional rendering

## Verification
- Open the chat with several past conversations
- Type a word that appears in an old message — matching conversations appear
- Clicking a result loads that conversation and clears the search
- Typing a word with no matches shows "No conversations found"
- Clearing the search input restores the normal date-bucketed view
