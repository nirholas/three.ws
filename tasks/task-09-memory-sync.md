# Task: Multi-Device Memory Sync

## Context

This is the `three.ws` 3D agent platform. Agents have a runtime memory store (`src/agent-memory.js`) that persists to `localStorage` and syncs to a backend API (`api/agent-memory.js`). The sync is one-directional: writes go from the browser to the backend. If a user opens the same agent on a second device or browser, that device has an empty memory — it never pulls from the backend.

## Goal

Make memory sync bidirectional so agents have consistent memory across devices. When an `<agent-3d>` element loads (or becomes active), it should pull the agent's memories from the backend and merge them into the local store.

## Files to Read First

- `src/agent-memory.js` (260 lines) — `AgentMemory` class: `add()`, `query()`, `_scheduleSync()`, localStorage structure
- `api/agent-memory.js` (188 lines) — `GET /api/agent-memory?agent_id=<id>` returns the agent's entries
- `src/element.js` — `<agent-3d>` custom element; find `connectedCallback()` or wherever the memory module is initialized

## What to Build

### Changes to `src/agent-memory.js`

Add a `pull()` method:

```js
async pull(agentId, authToken) {
  // Fetch all non-deleted entries from GET /api/agent-memory?agent_id=<agentId>
  // For each remote entry:
  //   - If not in local store: add it (skip _scheduleSync to avoid re-uploading)
  //   - If in local store and remote updatedAt > local updatedAt: overwrite local
  //   - If in local store and local is newer: keep local (it will sync up on next push)
  // Persist merged state to localStorage
}
```

Conflict resolution: **last-write-wins by `updatedAt` timestamp**. This is simple and correct for the use case (personal agent memory, single user).

Also:
- Ensure every entry has an `updatedAt` field set on `add()` and updated on any modification
- The `_scheduleSync()` push should send `updatedAt` in the request body so the backend stores it

### Changes to `api/agent-memory.js`

- `GET /api/agent-memory` response should include `updated_at` per entry (check if the DB column exists; if not, use `created_at` as fallback)
- `POST /api/agent-memory` should accept and store `updated_at` from the client
- `PUT /api/agent-memory` should update `updated_at`

### Changes to `src/element.js`

In the element's init sequence (after auth is resolved and `agentId` is known), call:

```js
await memory.pull(agentId, authToken)
```

This should happen **before** the first LLM turn, so the agent has its full memory on the first message.

## Constraints

- `pull()` must be idempotent — calling it twice should not duplicate entries
- Do not pull on every message — only on init (when the element connects)
- The pull should be a best-effort background operation: if the network is unavailable, silently skip and use local state
- Do not change the localStorage key structure

## Success Criteria

- Open an agent on Device A, have a conversation (agent remembers the user's name via `remember` tool)
- Open the same agent on Device B — on first load, memory is pulled and the agent knows the user's name
- No duplicate entries after pulling (idempotent)
- Offline devices degrade gracefully (no error thrown, uses cached localStorage)
