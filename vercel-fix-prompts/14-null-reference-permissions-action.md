# Fix: Null Reference Crash in /api/permissions/[action]

## Problem

250+ instances of process crashes with exit status 1:

```
Node.js process exited with exit status: 1
TypeError: Cannot read properties of null (reading 'topicHash')
at /var/task/api/permissions/[action].js:912
```

The code at line 912 of the permissions handler accesses `.topicHash` on a value that is `null`, causing an unhandled exception that crashes the entire Node.js process (not just the request).

## What to investigate

1. Open `api/permissions/[action].js` (or `.ts`) and find the code around line 912.
2. Identify what variable holds the null value — it's likely the result of a log lookup, event filter, or ABI decode operation.
3. Determine when this value can legitimately be null — is it an optional event, a missing log entry, or a misconfigured filter?

## Expected fix

Add a null check before accessing `.topicHash`:

```js
// Line ~912 — before the fix:
const hash = event.topicHash; // crashes if event is null

// After the fix:
if (!event) continue; // or return, or log and skip
const hash = event.topicHash;
```

The specific fix depends on the context:
- If iterating over a list: filter out nulls before the loop, or use `event?.topicHash` with a guard.
- If it's a single lookup: check for null and return an appropriate error response instead of crashing.

**Critical:** This crashes the Node.js process (not just the request), which means concurrent requests on the same instance also fail. Fix this immediately and add a top-level `try/catch` around the handler to prevent process crashes from unhandled errors.
