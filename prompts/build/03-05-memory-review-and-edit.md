# 03-05 — Memory inspector: review, edit, delete agent memories

**Pillar 3 — Edit avatar / agent.**

## Why it matters

The agent accumulates memories of 4 types (user / feedback / project / reference) silently. Owners can't see what their agent has remembered, which is both a trust problem and a correctness problem (wrong memories → confident-wrong agent behavior). Every major personal AI product exposes memory controls — we should too, and it's cheap given we already have `agent_memories` tables and a memory skill.

## What to build

A **Memory** tab on the agent edit page:

1. List rows from `agent_memories` grouped by type, sorted by `created_at` desc.
2. Each row: type badge, content (truncate > 160 chars), tags, salience (0–1), created, expires.
3. Actions per row: Edit (opens textarea), Delete (soft-delete).
4. "Add memory" form at the top (type + content + tags, optional expires date).
5. "Clear all memories of type X" with a confirm dialog (red button; consequential action).

## Read these first

| File | Why |
|:---|:---|
| [src/agent-memory.js](../../src/agent-memory.js) | In-memory 4-type store. |
| [api/agent-memory.js](../../api/agent-memory.js) | Server CRUD. If this file is thin today, extend rather than replace. |
| [api/_lib/schema.sql](../../api/_lib/schema.sql) | `agent_memories` columns: `agent_id, type, content, tags, context, salience, expires_at`. |
| [src/memory/index.js](../../src/memory/index.js) | File-based memory variant — you don't touch this for this task, but understand the shared type vocabulary. |

## Build this

### 1. Server

Extend [api/agent-memory.js](../../api/agent-memory.js):

- `GET /api/agent-memory?agent_id=<id>` — list memories for the agent. Owner-only (verify via session).
- `POST /api/agent-memory` — create.
- `PATCH /api/agent-memory/:id` — edit content/tags/salience/expires.
- `DELETE /api/agent-memory/:id` — soft-delete (add `deleted_at` column if missing — ask first for the migration).

All writes verify the session user owns the parent agent.

Zod schema for the body (4 types only; `salience` 0–1; `content` 1..4000; `tags` ≤ 16 strings).

### 2. Memory tab UI

`public/agent/edit-memory.html` + `edit-memory.js`.

Type colors (reuse from agent-home if already defined):
- `user` — indigo
- `feedback` — amber
- `project` — green
- `reference` — teal

Empty state: "Your agent hasn't remembered anything yet. It will as it works — or add a seed memory here."

### 3. Inline edit

Click Edit → row expands into a textarea + tags field + save/cancel. Salience is a 0–1 slider. Expires is an optional date picker.

### 4. Search / filter

Simple substring search box. `?q=` query param for bookmarking.

### 5. Export

"Download JSON" button exports all memories for the agent. Useful for the user to inspect + for future migration to chain-pinned memory.

### 6. Zero in on the Empathy Layer connection

Memories of type `feedback` with high salience should influence future emotion blends. Out of scope for this prompt; log a TODO in the PR body so a future prompt can wire it.

## Out of scope

- Do not build memory embeddings / semantic search.
- Do not build cross-agent memory sharing.
- Do not expose memories to the public agent page — this is owner-only.
- Do not rewrite [src/agent-memory.js](../../src/agent-memory.js).

## Deliverables

**New:**
- `public/agent/edit-memory.html`
- `public/agent/edit-memory.js`

**Modified:**
- [api/agent-memory.js](../../api/agent-memory.js) — full CRUD + auth.
- [api/_lib/schema.sql](../../api/_lib/schema.sql) — add `deleted_at` column (ask first).
- [src/agent-memory.js](../../src/agent-memory.js) — respect `deleted_at` in reads.

## Acceptance

- [ ] Owner visits Memory tab → sees all their agent's memories grouped by type.
- [ ] Edit a memory → content changes persist on refresh.
- [ ] Delete a memory → disappears from the list and from agent recall.
- [ ] Clear all of type X → all rows of that type are soft-deleted; other types untouched.
- [ ] Non-owner hitting `GET /api/agent-memory?agent_id=<not-theirs>` → 403.
- [ ] `npm run build` passes.

## Test plan

1. Chat with your agent → trigger `remember` skill → memory gets created.
2. Go to Memory tab → see it. Edit it. Refresh — edit persisted.
3. Ask the agent to recall it — it surfaces the edited content.
4. Delete it — agent can no longer recall it.
5. Export JSON → has every current memory row with valid types and salience ranges.
