---
mode: agent
description: "Inline editing of name, description, and skill list for an agent"
---

# 03-03 · Edit agent metadata

## Why it matters

The agent is not just the avatar — name, description, and the skill list define what the agent *is* and *does*. Users need a place to change these without opening a DB client.

## Prerequisites

- 01-* (auth), 03-01 (edit page scaffold).

## Read these first

- [api/agents.js](../../api/agents.js) — `PUT /api/agents/:id` handler.
- [src/agent-skills.js](../../src/agent-skills.js) — canonical skill names.

## Build this

1. **On `/agent/:id/edit`**, add a "Details" tab with:
   - Name (text input, 1–100 chars).
   - Description (textarea, 0–500 chars).
   - Skills — checkbox list of canonical skills (`greet`, `present-model`, `validate-model`, `remember`, `think`, `sign-action`). No custom skills in this prompt.
2. **Persist** via `PUT /api/agents/:id`. Use optimistic UI: update locally, revert on failure.
3. **Validation** on the server side — `api/agents.js` already truncates; add zod validation matching the limits above via [api/_lib/validate.js](../../api/_lib/validate.js). Don't hand-roll.
4. **Home URL** — if the user filled `home_url`, show it on the agent page as the "official home" link. Accept empty / `null` / a full URL.

## Out of scope

- Adding new skills (custom skill DSL is a separate initiative).
- Markdown in descriptions.
- Avatar changes (03-01).
- Wallet linking (06-*).

## Deliverables

- "Details" tab in `public/agent/edit.js`.
- zod schema for the update body in `api/_lib/validate.js`.

## Acceptance

- Changing name + saving reflects on `/agent/:id` after reload.
- Empty description saves as null.
- Non-canonical skill submitted via API returns 400 `validation_error`.
- `npm run build` passes.
