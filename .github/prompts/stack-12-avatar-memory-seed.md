---
mode: agent
description: "Memory tab — seed initial facts/feedback/references into an avatar's memory store"
---

# Stack Layer 3: Memory Tab

## Problem

Per [specs/MEMORY_SPEC.md](specs/MEMORY_SPEC.md) and [src/agent-memory.js](src/agent-memory.js), agent memory has four canonical types: `user`, `feedback`, `project`, `reference`. Today memories are only written by the agent at runtime. We need a UI to *seed* memories during avatar setup so the agent boots with meaningful context.

## Implementation

### Existing backend

[api/agent-memory.js](api/agent-memory.js) likely already handles read/write. Verify the endpoints match:
- `GET /api/agents/:id/memories?type=...`
- `POST /api/agents/:id/memories` body `{ type, name, description, body }`
- `DELETE /api/agents/:id/memories/:memoryId`

Note: memory is keyed to *agent* not *avatar* — confirm agent_identity ↔ avatar relationship in [api/agents/](api/agents/). If an avatar doesn't yet have an agent_identity row, create one on first memory write.

### UI

Four subsections, one per memory type, in collapsible cards:
1. **User** — "Who is this agent for?"
2. **Feedback** — "How should it behave?"
3. **Project** — "What is it working on?"
4. **Reference** — "External resources it should know about"

Each subsection:
- List of existing memories (name + one-line description).
- "Add memory" → modal with `name`, `description`, `body` textarea.
- Edit / delete per row.

### Import from template

"Import starter pack" button — loads a preset bundle (e.g., "Customer support agent starter" with 5 pre-written memories of each type). Templates live at [specs/schema/memory-templates/](specs/schema/memory-templates/) as JSON files.

### Validation

Server-side zod schema:
```js
{
  type: z.enum(['user', 'feedback', 'project', 'reference']),
  name: z.string().min(2).max(100),
  description: z.string().max(200),
  body: z.string().min(1).max(10000)
}
```

### Live preview

On memory add/edit, emit a `memory.updated` event on the agent protocol. The avatar preview can log "memory updated" in its timeline ([src/agent-home.js](src/agent-home.js)).

## Validation

- Add a memory of each of the 4 types → persists and reloads.
- Delete a memory → gone.
- Try to create a 5th type → rejected.
- Import starter pack → ~5 memories added in one shot.
- `npm run build` passes.

## Do not do this

- Do NOT invent new memory types. Four canonical types only.
- Do NOT expose another user's memories on `/agent/:slug`. Memory reads for the public page must strip private content (see [specs/MEMORY_SPEC.md](specs/MEMORY_SPEC.md)).
