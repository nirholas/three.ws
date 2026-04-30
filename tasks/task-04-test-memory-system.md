# Task: Write Tests for the Memory System

## Context

This is the `three.ws` 3D agent platform. Agents have a two-layer memory system:

1. **Runtime store** (`src/agent-memory.js`, 260 lines) — in-memory with localStorage sync and async backend sync. Supports 4 entry types (`USER`, `FEEDBACK`, `PROJECT`, `REFERENCE`), salience × recency scoring, expiration, and fire-and-forget sync to the backend API.
2. **Backend API** (`api/agent-memory.js`, 188 lines) — CRUD endpoints storing to `agent_memories` Postgres table.

Both have **zero test coverage**.

## Goal

Write vitest test suites:
- `tests/src/agent-memory.test.js` for the runtime store
- `tests/api/agent-memory.test.js` for the backend API

## Files to Read First

- `src/agent-memory.js` — `AgentMemory` class: `add()`, `query()`, `_scheduleSync()`, localStorage integration, expiration
- `api/agent-memory.js` — GET (list), POST (create), PUT (update), DELETE (soft-delete) handlers
- `tests/src/manifest.test.js` — example of how to test a src/ module
- `tests/api/agents.test.js` — example of how to mock API handler tests

## What to Test

### Runtime store (`src/agent-memory.js`)

1. `add(entry)` stores entry in memory and returns an id
2. `query({ type: 'USER' })` returns only USER-type entries
3. `query({ tags: ['foo'] })` returns only entries with matching tags
4. `query({ limit: 2 })` returns at most 2 results
5. `query({ since: timestamp })` excludes entries older than the timestamp
6. Expired entries (where `expiresAt` is in the past) are excluded from `query()` results
7. Entries are sorted by salience × recency score (higher salience appears first)
8. `add()` schedules a backend sync (assert `_scheduleSync` was called or that fetch was queued)
9. On init, existing entries are loaded from localStorage if present
10. `add()` persists entry to localStorage immediately

### Backend API (`api/agent-memory.js`)

11. `GET /api/agent-memory?agent_id=<id>` returns entries for that agent (mock DB)
12. `GET /api/agent-memory` without auth returns 401
13. `POST /api/agent-memory` creates a new memory entry and returns it with an `id`
14. `POST /api/agent-memory` with missing required fields returns 400
15. `PUT /api/agent-memory?id=<id>` updates the entry content/salience
16. `DELETE /api/agent-memory?id=<id>` soft-deletes (sets `deleted_at`, not a hard row delete)
17. Agent can only read/write their own memories (cross-agent access returns 403)

## Approach

- For runtime tests: mock `localStorage` with `vi.stubGlobal('localStorage', ...)` and mock `fetch` with `vi.stubGlobal('fetch', ...)`
- For API tests: mock the Neon DB client; use the same req/res mock pattern as `tests/api/agents.test.js`
- Use `vi.useFakeTimers()` for testing expiration and scheduling behavior

## Success Criteria

- `npm test tests/src/agent-memory.test.js tests/api/agent-memory.test.js` passes
- No real localStorage, network, or DB calls
- Expiration, scoring, and cross-agent isolation all explicitly covered
