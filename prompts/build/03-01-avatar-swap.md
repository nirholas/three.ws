---
mode: agent
description: "Swap an agent's avatar GLB without breaking identity, skills, memory, or onchain record"
---

# 03-01 · Swap avatar without losing identity

## Why it matters

Pillar 3: editing. The agent IS the identity — skills, memory, wallet, onchain registration. The avatar is the body. A user must be able to replace the body and keep the identity.

## Prerequisites

- 02-* shipped (at least one avatar exists).

## Read these first

- [api/agents.js](../../api/agents.js) — `PUT /api/agents/:id` already accepts `avatar_id`.
- [api/avatars/index.js](../../api/avatars/index.js) — avatar list.
- [public/agent/index.html](../../public/agent/index.html) — agent landing (where the edit action lives).

## Build this

1. **New page** `public/agent/edit.html` + accompanying JS. Route `/agent/:id/edit` in `vercel.json`.
2. **Layout**:
   - Left: current avatar in the viewer.
   - Right: three tabs — **Retake selfie** (links to `/selfie`) · **Choose from library** (user's existing avatars + a small curated public list) · **Upload GLB** (drag-drop).
   - Bottom: **Save changes** (disabled until something changed) and **Cancel**.
3. **Swap logic**:
   - Chosen avatar's `avatar_id` → `PUT /api/agents/:id` with `{ avatar_id }`.
   - Nothing else changes: `name`, `description`, `wallet_address`, `erc8004_agent_id`, `skills`, `meta` all preserved.
   - After save, redirect to `/agent/:id` with a toast "Avatar updated."
4. **History** — before saving, write the previous `avatar_id` into `agent_identities.meta.avatar_history` (array, capped at 5). Minimal — enough that a user can roll back if needed.
5. **Owner-only guard** — page JS hits `GET /api/agents/:id` and if `user_id !== currentUser.id`, redirect to the public `/agent/:id` view.

## Out of scope

- Live editing the avatar mesh (03-02).
- Uploading a selfie (02-*).
- Onchain consequences of the avatar change (06-* — the CID should change but that's not enforced here).
- Versioned avatar entities (the history list is lightweight meta, not a new table).

## Deliverables

- `public/agent/edit.html`
- `public/agent/edit.js`
- Route in `vercel.json`
- Link from `public/agent/index.html` → edit page (owner only).

## Acceptance

- Owner can swap avatar; identity, skills, memory untouched in DB.
- Non-owner visiting `/agent/:id/edit` is redirected.
- `meta.avatar_history` grows on each change (≤ 5).
- `npm run build` passes.
