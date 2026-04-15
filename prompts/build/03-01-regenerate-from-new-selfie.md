# 03-01 — Regenerate an existing avatar from a new selfie

## Why it matters

Users will generate an avatar, dislike the result, and want to try again without losing their agent identity, wallet links, or memories. "Regenerate from photo" keeps the agent, swaps only the 3D body.

## Context

- Agent → avatar link: `agent_identities.avatar_id` references `avatars.id` ([api/_lib/schema.sql](../../api/_lib/schema.sql)).
- Existing selfie pipeline: `/api/avatars/from-selfie` (`02-02`).
- Selfie capture UI: `/dashboard/selfie` (`02-01`).
- Agent API: [api/agents.js](../../api/agents.js) and [api/agents/[id].js](../../api/agents/[id].js).

## What to build

### Endpoint — extend `api/avatars/from-selfie.js`

Accept an optional form field `replace_avatar_id` (UUID). When present:

- Assert ownership: the avatar belongs to the caller.
- After generating the new GLB and creating the new `avatars` row (same as the normal flow):
  - If the caller's `agent_identities.avatar_id` equals `replace_avatar_id`, update it to point at the new avatar.
  - Soft-delete the old avatar (`deleted_at = now()`).
  - Keep the R2 object for 7 days (don't hard-delete immediately).
- Return `{ avatar: <new_row>, replaced: <old_id> }`.

No change to the normal path (no `replace_avatar_id`).

### UI — regenerate button on the agent/avatar view

On the agent page [public/agent/index.html](../../public/agent/index.html), when the viewer is the avatar owner, show a "Regenerate from photo" button near the existing edit controls. Clicking navigates to `/dashboard/selfie?replace=<avatar_id>`.

On `/dashboard/selfie`, read `?replace=` from the URL and include it as `replace_avatar_id` in the form submission.

### UX guardrails

- Before submission, show a confirmation: "This will replace your current avatar. Agent identity, memories, and wallet links are preserved."
- After success, navigate to the agent page, not the dashboard.

## Out of scope

- Keeping both the old and new avatar side-by-side for A/B comparison.
- Multi-version history of avatars per agent (`avatars.version` exists but we won't use it here).
- Restoring a deleted avatar.

## Acceptance

1. Create an avatar via selfie. Note the agent id.
2. Visit the agent page, click "Regenerate from photo."
3. Capture a new selfie, submit.
4. On completion, the agent page shows the new avatar. Agent id, name, and memory are unchanged.
5. `agent_identities.avatar_id` in DB points to the new avatar. Old avatar row has `deleted_at` set.
6. A non-owner cannot trigger regeneration for another user's avatar (403).
