# Task: Fix deleted messages not syncing in the sync pull flow

## Context

`/workspaces/3D-Agent/chat/src/App.svelte` has a sync system that pulls conversations and messages from a remote server. Around line 280 there is an incomplete TODO:

```js
// TODO: Delete messages.
// for (const message of deletedMessages) {
//     const conversationId = con
//     convosMap
// }
```

This is inside a function that processes sync results. When another device deletes a message, that deletion is never applied locally — the message stays visible forever on the receiving device.

The `deleteMessage` function at ~line 365 already works correctly for local deletes (removes from IndexedDB and optionally syncs to server). The gap is only in the pull direction: when `syncPull` returns deleted messages, they aren't removed from `convos`.

## What to fix

### 1. Understand the data shape

Look at what `syncPull` returns. In `App.svelte` around line 245-285, the pull result destructures something like:
```js
const { newConversations, deletedConversations, newMessages, deletedMessages } = await syncPull(...)
```

Find the exact variable names by reading the sync pull code at `/workspaces/3D-Agent/chat/src/sync.js`.

### 2. Complete the TODO

Replace the commented-out block with working code. The goal: for each deleted message ID in `deletedMessages`, find which conversation in `convosMap` contains it and remove it.

Pattern to implement:
```js
for (const deletedMsg of deletedMessages) {
    for (const convo of Object.values(convosMap)) {
        const idx = convo.messages.findIndex(m =>
            (typeof m === 'string' ? m : m.id) === deletedMsg.id
        );
        if (idx !== -1) {
            convo.messages.splice(idx, 1);
            break;
        }
    }
}
```

After splicing, trigger reactivity by reassigning: `convos = convosMap`.

### 3. Verify the shape of deletedMessages items

Before implementing, read `/workspaces/3D-Agent/chat/src/sync.js` to confirm:
- What shape objects in `deletedMessages` have (do they have `.id` or are they raw ID strings?)
- Whether the array is named `deletedMessages` or something else in the destructuring

Adjust the implementation to match.

## Files to edit
- `/workspaces/3D-Agent/chat/src/App.svelte` — replace the TODO comment block (~line 280)

## Verification
- Set up two browser tabs with the same sync token and password in Settings
- Send a message in tab 1, confirm it appears in tab 2 after sync
- Delete the message in tab 1
- Trigger a sync pull in tab 2 — the message should disappear
- No console errors should appear
