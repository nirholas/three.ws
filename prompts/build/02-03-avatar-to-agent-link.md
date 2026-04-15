# 02-02 — Auto-link new avatar → agent_identity on save

**Branch:** `feat/avatar-agent-link`
**Stack layer:** 2 (Selfie → agent creation)
**Depends on:** 02-01
**Blocks:** 03-* (edit), 04-* (embed assumes every avatar has an agent)

## Why it matters

Today the database has `avatars` and `agent_identities` but nothing binds them on creation. A user finishes the selfie flow and has a 3D mesh — but no *agent*, which is the actual product. This prompt makes "avatar" and "agent" inseparable from the first save.

## Read these first

| File | Why |
|:---|:---|
| [api/avatars/index.js](../../api/avatars/index.js) | Where a new avatar record is written. This is the hook point. |
| [api/agents.js](../../api/agents.js) | Agent creation + `/api/agents/me` + default-agent logic. |
| [src/agent-identity.js](../../src/agent-identity.js) | Client-side identity model. |
| [api/_lib/](../../api/_lib/) migrations | Confirm the `agent_identities` schema (avatar_id column exists or needs adding). |

## Build this

1. **Schema check.** Confirm `agent_identities.avatar_id` exists and is nullable with a FK to `avatars(id) on delete set null`. If missing, add a migration `003_agent_avatar_fk.sql` (or next free number — verify with `ls api/_lib/migrations/`).
2. **Server-side link on first avatar.** In [api/avatars/index.js](../../api/avatars/index.js) `POST` handler, after the avatar row is created:
   - If the user has no agent yet, create one inside the same transaction with `avatar_id = newAvatar.id` and a sensible default name (derive from avatar name or user handle).
   - If the user has exactly one agent and that agent has `avatar_id IS NULL`, bind the new avatar to it.
   - If the user has ≥2 agents or their sole agent already has an avatar, do nothing — leave the avatar unbound and return it normally.
3. **Return shape.** The POST response gains an optional `agent` field: `{ id, name, slug }` if a link happened, absent otherwise.
4. **Client.** In [src/account.js](../../src/account.js), surface the `agent` field from the POST response. Dashboard's success state shows "Avatar saved and bound to agent <name>".

## Out of scope

- Do not add multi-agent UI.
- Do not migrate existing orphan avatars — just fix the creation path. A separate one-off script is fine as a follow-up prompt.
- Do not touch onchain identity yet — that's 06-*.

## Acceptance

- [ ] New user's first avatar creates and binds to their default agent atomically.
- [ ] POST response includes the `agent` field when a link happened.
- [ ] Two concurrent avatar POSTs for a first-time user do not create two agents.
- [ ] `select count(*) from agent_identities where avatar_id is null and user_id in (active users)` trends to zero for new signups.
- [ ] Existing users with avatars and agents are untouched.
