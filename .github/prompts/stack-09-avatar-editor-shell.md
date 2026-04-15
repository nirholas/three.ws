---
mode: agent
description: "Edit-avatar page shell — auth-gated, tabbed, lives at /edit/:slug"
---

# Stack Layer 3: Avatar Editor Shell

## Problem

Users need a page to edit an avatar after creation. Today there is no edit surface. This prompt creates the page shell — tabs, routing, auth — so subsequent prompts can fill in each tab.

## Implementation

### Route

`/edit/:slug` — Vercel rewrite → `/edit/index.html?slug=:slug` (add to [vercel.json](vercel.json)).

### Auth + ownership

- Require session. Redirect to `/login.html?next=/edit/<slug>` if not.
- Fetch `/api/avatars/by-slug/:slug` client-side.
- Fetch `/api/auth/me` — if `user.id !== avatar.user_id`, show "Not your avatar" and link to the public view.

### Page

`public/edit/index.html` — native DOM, plain CSS.

Layout:
- Left (40%): live 3D preview via [src/viewer.js](src/viewer.js), auto-rotating.
- Right (60%): tabbed editor.

Tabs (each filled by a separate prompt):
1. **Identity** — name, bio, slug lock, delete (stack-10)
2. **Skills** — attach/detach (stack-11)
3. **Memory** — seed initial facts (stack-12)
4. **Animation** — default idle, swap rig (stack-13)
5. **Mesh** — replace underlying GLB (stack-14)

### Tab state

Hash-based: `/edit/satoshi#skills`. Clicking a tab updates the hash, back/forward works.

### Save flow

Each tab has its own Save button → its own `PATCH /api/avatars/:id` endpoint slice. Unsaved changes banner if the user clicks away.

### Bridge to viewer

Use the existing event bus in [src/agent-protocol.js](src/agent-protocol.js) to push edits to the preview pane live (e.g., identity name change → avatar home updates in preview).

## Validation

- Visit `/edit/satoshi` while logged out → redirected to login.
- Log in as someone else → "Not your avatar".
- Log in as owner → all 5 tabs render, preview loads the avatar.
- Tab hash routing works across refresh + back button.
- `npm run build` passes.

## Do not do this

- Do NOT build the tab internals here — each is a separate prompt. Just stub them with a placeholder + save button.
- Do NOT duplicate the viewer — reuse [src/viewer.js](src/viewer.js) in a smaller canvas.
