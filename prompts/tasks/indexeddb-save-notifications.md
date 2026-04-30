# Task: Surface IndexedDB save failures to the user

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` stores all conversations and messages in IndexedDB. When a transaction fails (disk full, browser storage quota exceeded, private browsing restrictions), the error is silently logged to the console:

```js
// ~line 163
transaction.onerror = () => {
    console.error('Message save failed', transaction.error);
};

// ~line 337
transaction.onerror = () => {
    console.error('Conversation save failed', transaction.error);
};

// ~line 378
transaction.onerror = () => {
    console.error('Message delete failed', transaction.error);
};
```

Users lose data with no indication anything went wrong.

## What to build

### 1. Add a toast/notification store

In `/workspaces/3D-Agent/chat/src/stores.js`, add:
```js
export const notifications = writable([]);

export function notify(message, type = 'error') {
    const id = Math.random().toString(36).slice(2);
    notifications.update(n => [...n, { id, message, type }]);
    setTimeout(() => notifications.update(n => n.filter(x => x.id !== id)), 5000);
}
```

### 2. Replace console.error calls with notify()

In `App.svelte`, import `notify` from `./stores.js` and replace all three `console.error` calls in IndexedDB `onerror` handlers with:
```js
transaction.onerror = () => {
    notify('Failed to save — your changes may be lost. Check browser storage settings.');
};
```

Keep a `console.error` alongside for debugging:
```js
transaction.onerror = () => {
    console.error('Message save failed', transaction.error);
    notify('Failed to save — your changes may be lost.');
};
```

### 3. Add a Notifications component

Create `/workspaces/3D-Agent/chat/src/Notifications.svelte`:
```svelte
<script>
    import { notifications } from './stores.js';
</script>

{#if $notifications.length > 0}
    <div class="fixed bottom-16 left-1/2 z-[200] flex -translate-x-1/2 flex-col gap-2">
        {#each $notifications as n (n.id)}
            <div class="rounded-lg px-4 py-2 text-sm text-white shadow-lg
                {n.type === 'error' ? 'bg-red-600' : 'bg-slate-800'}">
                {n.message}
            </div>
        {/each}
    </div>
{/if}
```

### 4. Mount it in App.svelte

Import and add `<Notifications />` just before the closing `</main>` tag in `App.svelte`.

## Files to edit
- `/workspaces/3D-Agent/chat/src/stores.js` — add `notifications` store and `notify()`
- `/workspaces/3D-Agent/chat/src/App.svelte` — import `notify`, update three `onerror` handlers, mount `<Notifications />`
- `/workspaces/3D-Agent/chat/src/Notifications.svelte` — create new file

## Verification
- Open the chat in a browser
- In devtools console, run: `indexedDB.open('threews-chat').onerror = () => {}`  
- A real way to test: open the app in Firefox private browsing (IndexedDB is restricted) — a red toast should appear at the bottom when trying to save a message
- Normal operation should show no toasts
