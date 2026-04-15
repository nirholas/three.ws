---
mode: agent
description: "Identity tab of avatar editor — edit name, bio, visibility; delete avatar"
---

# Stack Layer 3: Identity Tab

## Problem

Users need to edit an avatar's public identity after creation: name, bio, visibility (public/unlisted), and delete it entirely.

## Implementation

### Form fields

- `name` — required, 2–64 chars.
- `bio` — optional, max 280 chars, live count.
- `visibility` — radio: `public`, `unlisted`. (No `private` — all avatars are at least unlisted.)
- `slug` — read-only for v1, with a note "Slug is permanent."

### Save

`PATCH /api/avatars/:id`:
```json
{ "name": "...", "bio": "...", "visibility": "public" }
```

Use `zod` to validate on the server. Reject unknowns. Only owner can edit.

### Delete

"Delete avatar" button with a confirm-text input ("type the slug to confirm").

`DELETE /api/avatars/:id`:
- Soft-delete first: mark `deleted_at`. Keep the row 30 days for recovery.
- Remove from public lookups (`GET /api/avatars/by-slug/:slug` returns 404 for soft-deleted).
- Remove GLB from R2 only after 30d via a cron.

### Visibility semantics

- `public`: listed in `/api/avatars/public`, OG-scraped, etc.
- `unlisted`: direct URL works, not in public listings, no search indexing (`noindex` robots meta on `/agent/:slug`).

### DB changes

`avatars` table: add `visibility` (enum: 'public', 'unlisted', default 'unlisted'), `deleted_at` (nullable timestamp).

## Validation

- Edit name and bio → Save → refresh → persists.
- Change visibility to unlisted → removed from `/api/avatars/public`, direct URL still works.
- Delete with correct slug confirmation → soft-deleted, 404 on public lookup.
- Attempt to edit someone else's avatar via API → 403.
- `npm run build` passes.

## Do not do this

- Do NOT hard-delete on first click. Soft-delete.
- Do NOT allow slug changes in v1.
