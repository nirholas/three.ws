# Agent memory and learning

Your agents can remember what you tell them, keep a short profile of you, and draft reusable skills from work they have done. Everything they keep is yours: listed, editable and deletable at [/settings/memory](/settings/memory).

## What is stored

| Layer | What it holds | Who writes it | Where it shows up |
|---|---|---|---|
| About you | Short lines grouped as who you are, goals, preferences, communication, expertise, constraints, current context. | The agent as it learns, or you. | Read by every agent on your account before it answers. |
| Saved memories | Facts, preferences and procedures an agent chose to keep. | The agent. | The agent's prompt, ranked by relevance and recency. |
| Learned skills | A skill drafted after a run that used several different tools. | The agent, as a disabled draft. | Only after you enable it. |

## Facts over time

A memory is true over an interval. Every row carries `valid_from` (when the fact became true), `valid_to` (null while current), `source_ref` (where it came from, such as `message:4812`) and `superseded_by`. When a fact changes, the agent saves the new one with `supersedes: [old id]` and the old version's interval closes at the new `valid_from`; it stays searchable as history.

- `memory_save` takes `supersedes`, `valid_from` and `source_ref`. Superseding an already-closed memory returns `already_superseded` with the id that replaced it.
- `memory_search` returns current facts by default, `as_of` (ISO 8601) for what was true then, and `include_history` for superseded versions with the current one first.
- The prompt section only ever includes current facts.
- `POST /api/agent-memory` accepts `entry.validFrom`, `entry.sourceRef` and `entry.supersedes`; `GET`/`POST /api/memory/search` accept `as_of` and `include_history`.
- Migration: `api/_lib/migrations/20261105020000_agent_memory_temporal_facts.sql` (backfills `valid_from = created_at`). Apply it before deploying the code that reads the columns.
- Quality is tracked on LoCoMo and LongMemEval: [research/memory-bench-results.md](research/memory-bench-results.md), reproduce with `node --env-file=.env scripts/memory-bench.mjs --subset 50`.

## Controls

- **Let my agents learn** is the master switch. Off means no new memories, no profile lines and no skill drafts, and nothing saved is added to prompts. Existing data stays until you delete it, and you can still edit or delete it. While it is off the agent is told that memory is off, so if you ask it to remember something it says so and points you here instead of promising to remember (`MEMORY_OFF_NOTE` in `api/_lib/agent-learning/runtime.js`).
- **Draft skills from experience** turns skill drafting off on its own.
- **Review cadence** (2 to 50 turns) sets how often an agent stops to decide what is worth remembering.
- Deleting a line or memory is permanent after a six second undo window. Clearing the whole profile needs a confirmation.
- A learned skill never runs until you enable it. Edits are versioned; rolling back restores old text as a new version, so a rollback can itself be rolled back.

## Privacy

Memories belong to your account. They are not part of a marketplace sale (a transfer deletes the agent's memories, experience-drafted skills and session summaries, and never moves your profile or settings), and learned skills are never exported to the community skills registry. These guarantees are pinned by `tests/agent-learning-privacy.test.js`.

## API

Session cookie, or a bearer credential with `memory:read` (GET) or `memory:write` (everything else). Another account's ids answer `404`. Errors use `{ "error", "error_description" }`.

| Route | Purpose |
|---|---|
| `GET`, `PATCH /api/memory/settings` | Read or change `enabled`, `skill_drafts_enabled`, `nudge_every_turns`. Unknown keys are rejected. |
| `GET /api/memory/items?agent_id=&kind=&q=&before=` | Memories newest first with per-kind `counts`; page with `next_before`. |
| `DELETE /api/memory/items/:id` | Forget one memory. |
| `GET`, `POST /api/memory/user-model` | Read the profile grouped by section, or add a line `{ section, content }`. |
| `PATCH`, `DELETE /api/memory/user-model/:id` | Rewrite, move or remove a line. |
| `DELETE /api/memory/user-model?confirm=true` | Clear the profile. Without `confirm=true` it answers `400`. |
| `GET /api/memory/skills?agent_id=` | Learned skills, drafts first. |
| `GET /api/memory/skills/:id/versions?agent_id=` | Version history. |
| `PATCH /api/memory/skills/:id` | Owner edit, recorded as a new patch version. |
| `POST /api/memory/skills/:id/review` | `{ agent_id, enable }` turn a draft on or off. |
| `POST /api/memory/skills/:id/rollback` | `{ agent_id, version }` restore a recorded version. |

Source: [api/memory/[action].js](../api/memory/[action].js) over the library in [api/_lib/agent-learning/](../api/_lib/agent-learning). Page: [pages/settings-memory.html](../pages/settings-memory.html) and [src/settings-memory.js](../src/settings-memory.js). Tests: `tests/agent-learning-*.test.js`, `tests/api/memory-owner-routes.test.js`.
