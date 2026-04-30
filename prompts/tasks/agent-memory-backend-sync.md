# Task: Wire AgentMemory backend sync to the API

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `src/agent-memory.js` — In-browser memory store for agents. Stores to `localStorage` immediately. Has a `backendSync` option that defaults to `false`. When `backendSync = true`, the constructor calls `this._scheduleSync()` but the sync implementation is incomplete — it calls a backend endpoint that may not exist.

  Look at `_scheduleSync()` and `_flushToBackend()` (or similar methods) in the file to understand what's currently there vs. what's missing.

- `api/agents/[id]/` — Agent CRUD API. There is likely a `/memories` endpoint structure, but check if `api/agents/[id]/memories.js` (or similar) actually exists and handles read/write.

- `api/_lib/schema.sql` — Has an `agent_memories` table:
  ```sql
  -- agent_memories: id, agent_id, type, content, tags, salience, expires_at, created_at
  ```

- `src/runtime/index.js` — The LLM brain loop. Creates `AgentMemory` (likely with `backendSync: false` currently) and uses `memory.query()` to inject context before LLM calls.

- `src/agent-identity.js` — Records events to the backend (uses `POST /api/agent-actions`). The memory sync should follow a similar pattern.

**The problem:** Agent memories are lost on page refresh because `localStorage` is unreliable and `backendSync` is disabled. The `agent_memories` DB table exists but nothing writes to it from the frontend.

**The goal:** Complete the `AgentMemory` backend sync so that:
1. When a memory is added (`memory.add()`), it's synced to `/api/agents/:id/memories`
2. On initialization, existing memories are hydrated from the backend
3. On page refresh, memories persist across sessions

---

## Backend: memory CRUD endpoint

Check if `api/agents/[id]/memories.js` exists. If not, create it.

**`GET /api/agents/:id/memories`**

Returns all non-expired memories for the agent:
```js
const rows = await sql`
  SELECT id, type, content, tags, salience, expires_at, created_at
  FROM agent_memories
  WHERE agent_id = ${agentId}
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 200
`;
return json(res, 200, { data: rows });
```

Auth: session or bearer. Agent must belong to the authenticated user.

**`POST /api/agents/:id/memories`**

Saves one memory entry:
```
Body: { type, content, tags?, salience?, expiresAt? }
```

```js
const row = await sql`
  INSERT INTO agent_memories (id, agent_id, type, content, tags, salience, expires_at)
  VALUES (gen_random_uuid(), ${agentId}, ${type}, ${content}, ${tags}, ${salience}, ${expiresAt})
  RETURNING id
`;
return json(res, 201, { id: row[0].id });
```

Rate limit: max 100 writes per minute per agent.

**`DELETE /api/agents/:id/memories/:memoryId`**

Soft delete or hard delete — check how the rest of the API handles deletions.

---

## Changes to src/agent-memory.js

### constructor

When `backendSync = true` and an `agentId` is provided, hydrate from backend on startup:

```js
constructor(agentId, { backendSync = false } = {}) {
  this.agentId = agentId;
  this.backendSync = backendSync;
  this._entries = [];
  this._hydrate(); // from localStorage, as before
  
  if (backendSync && agentId) {
    this._hydrateFromBackend(); // async, fire-and-forget
  }
}

async _hydrateFromBackend() {
  try {
    const res = await fetch(`/api/agents/${this.agentId}/memories`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const { data } = await res.json();
    for (const row of data) {
      // Only add if not already in _entries (avoid duplicates with localStorage)
      if (!this._entries.find(e => e.id === row.id)) {
        this._entries.push({
          id: row.id,
          type: row.type,
          content: row.content,
          tags: row.tags || [],
          context: {},
          salience: row.salience || 0.5,
          createdAt: new Date(row.created_at).getTime(),
          expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
        });
      }
    }
  } catch {
    // Backend unavailable — localStorage data is the fallback
  }
}
```

### _scheduleSync (update or implement)

Currently either a no-op or incomplete. Complete it to POST new entries:

```js
_scheduleSync(entry) {
  this._persist(); // localStorage, as before
  
  if (!this.backendSync || !this.agentId) return;
  
  // Fire-and-forget — don't block add()
  fetch(`/api/agents/${this.agentId}/memories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: entry.type,
      content: entry.content,
      tags: entry.tags,
      salience: entry.salience,
      expiresAt: entry.expiresAt,
    }),
    credentials: 'include',
  }).catch(() => {}); // silently ignore — localStorage is the source of truth
}
```

### Enabling sync in the runtime

In `src/runtime/index.js`, when creating `AgentMemory`, pass `backendSync: true` if the agent is authenticated:

```js
const memory = new AgentMemory(agentId, {
  backendSync: !!sessionUser, // only sync if authenticated
});
```

How to know if authenticated: check if `element.js` passes session context to the runtime, or call `GET /api/auth/me` once at runtime init.

---

## Files to create/edit

**Create (if doesn't exist):**
- `api/agents/[id]/memories.js`

**Edit:**
- `src/agent-memory.js` — complete `_hydrateFromBackend()` and `_scheduleSync()`
- `src/runtime/index.js` — enable `backendSync: true` for authenticated agents

**Do not touch:**
- `src/memory/index.js` (the file-based memory variant — separate concern)
- `agent_memories` table schema — it already exists

---

## Acceptance criteria

1. Boot the element with an authenticated session. Add a memory via the agent's `remember` skill. Refresh the page — the memory is still there (loaded from backend).
2. Without authentication (`backendSync: false`), memories still work from localStorage — no regression.
3. `GET /api/agents/:id/memories` returns the stored memories as JSON.
4. `POST /api/agents/:id/memories` returns `{ id: "..." }`.
5. An unauthenticated request to the memories endpoint returns `401`.
6. Memory hydration failure (backend down) does not crash the agent — localStorage memories still load.
7. `npx vite build` passes. `node --check api/agents/[id]/memories.js` passes.

## Constraints

- Backend sync is fire-and-forget — never block `add()` on a network round-trip.
- localStorage remains the source of truth for reads. Backend is the persistence layer.
- ESM only in `src/`. API endpoints use `wrap(...)` pattern from `api/CLAUDE.md`.
- Max 200 memories returned from `GET` endpoint (already in the query above).
- No new npm dependencies.
