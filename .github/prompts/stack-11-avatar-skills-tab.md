---
mode: agent
description: "Skills tab — attach/detach skills to an avatar from a catalog"
---

# Stack Layer 3: Skills Tab

## Problem

An avatar's capabilities are defined by which skills are attached. Today skills are hard-coded per agent in [src/nich-agent.js](src/nich-agent.js). We need a UI to attach/detach skills from a catalog per avatar, persisted to the DB.

## Implementation

### Catalog source

Skills live in [src/skills/](src/skills/). Add a manifest at [specs/schema/skills.json](specs/schema/skills.json) (or read the directory) that exposes:
```json
[
  { "id": "greet", "name": "Greet", "description": "Say hello with presence", "tags": ["default"] },
  { "id": "validate-model", "name": "Validate glTF", "tags": ["3d"] }
]
```

Expose via `GET /api/skills/catalog` (public, cached).

### DB

`avatar_skills` table: `avatar_id` (fk), `skill_id` (text), `config` (jsonb, nullable), `enabled` (bool, default true), `created_at`. Unique on (avatar_id, skill_id).

### UI

Two columns:
- **Attached** (left): skills currently on this avatar. Each row has a toggle (enable/disable), a config button (if skill has settings), and a remove.
- **Available** (right): catalog minus attached. "Attach" button per row.

Drag-and-drop optional; start with buttons.

### API

- `GET /api/avatars/:id/skills`
- `POST /api/avatars/:id/skills` body `{ skillId, config? }`
- `PATCH /api/avatars/:id/skills/:skillId` body `{ enabled?, config? }`
- `DELETE /api/avatars/:id/skills/:skillId`

All owner-only.

### Config schemas

Each skill in the catalog can declare a `configSchema` (zod-like JSON schema). Render a simple form from it (text fields and booleans only for v1).

### Live update

On save, emit a `skills.updated` event on the agent protocol so the preview pane re-hydrates its skill set.

## Validation

- Attach `validate-model` → preview pane can now trigger glTF validation.
- Detach `greet` → preview agent no longer greets.
- Edit skill config (e.g., greeting text) → persists and reflects live.
- Reordering (if implemented) persists.
- `npm run build` passes.

## Do not do this

- Do NOT invent new skills here — catalog is a mirror of [src/skills/](src/skills/).
- Do NOT allow attaching skills not in the catalog (server must validate).
