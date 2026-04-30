# Task: Complete message deletion in sync

## Context

This is the `chat/` Svelte app at `/workspaces/3D-Agent/chat/src/`. There is a sync system (`chat/src/sync.js`) that pushes/pulls conversations and messages. Message deletion is partially wired — the sync pull handler receives `deletedMessages` from the server but doesn't apply them.

## The gap

In `chat/src/App.svelte` around line 280:

```js
// TODO: Delete messages.
// for (const message of deletedMessages) {
// 	const conversationId = con
// 	delete convosMap
// }
```

The deleted messages arrive from sync but are dropped on the floor. `deletedMessages` is already destructured from the sync pull result — the code just needs to find which conversation each deleted message belongs to and remove it.

## What needs to change

### `chat/src/App.svelte`

Replace the TODO comment block with working deletion logic. The `convosMap` is a `{ [convoId]: convo }` object. Each convo has a `messages` array of message objects with an `id` field.

The deleted messages from sync are message objects (or at minimum have an `id`). You need to:
1. Iterate `deletedMessages`
2. For each, find the convo that contains a message with that id
3. Remove the message from that convo's messages array

```js
for (const deletedMsg of deletedMessages) {
    for (const convoId of Object.keys(convosMap)) {
        const idx = convosMap[convoId].messages.findIndex(m => m.id === deletedMsg.id);
        if (idx !== -1) {
            convosMap[convoId].messages.splice(idx, 1);
            break;
        }
    }
}
```

Read the surrounding code carefully before changing anything — confirm the exact variable names (`deletedMessages`, `convosMap`) by checking the destructuring above the TODO comment and the loop that handles `deletedConversations` just above it (that pattern is the model to follow).

### `chat/src/sync.js`

Check whether `deleteSingleItem` for a message type is implemented. Search for `deleteSingleItem` in `sync.js` and `App.svelte`. If it's exported from `sync.js` and callable for message items, no changes needed there. If it only handles conversations, extend it to handle messages using the same pattern.

Also check: when a user deletes a message locally (look for any delete/trash button on messages in `Message.svelte` or `App.svelte`), is `deleteSingleItem` called? If a delete button exists but doesn't call `deleteSingleItem`, wire it up.

## Success criteria

1. `deletedMessages` from sync pull are removed from `convosMap` (and thus from the rendered conversation)
2. Local message deletion (if the UI exists) calls `deleteSingleItem` so it propagates via sync
3. No regression on normal message flow
4. `cd chat && npx vite build` passes

## House rules

- Read `chat/src/sync.js` and the full sync pull block in `App.svelte` before making changes
- Follow the existing pattern for `deletedConversations` — message deletion should mirror it
- Do not redesign the sync protocol
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
