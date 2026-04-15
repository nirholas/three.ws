# 03-01 — Implement the dashboard Edit tab

**Branch:** `feat/dashboard-edit-tab`
**Stack layer:** 3 (Edit avatar)
**Depends on:** 02-03 (avatars are bound to agents)
**Blocks:** 03-02 (regenerate/swap), 04-* (embed polish reveals editing gaps)

## Why it matters

[public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) declares `tabs.edit = renderEdit` but `renderEdit()` is undefined — the tab 404s. Users can create an avatar but can't rename, retag, or toggle visibility without hitting the API manually. This is the smallest unlock that makes the "edit" pillar exist.

## Read these first

| File | Why |
|:---|:---|
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Tab routing, state shape, existing tab renderers as templates (especially the avatar list renderer). |
| [api/avatars/[id].js](../../api/avatars/[id].js) | PATCH handler already supports `name`, `description`, `visibility`, `tags`. |
| [src/account.js](../../src/account.js) | Client helpers — extend, don't duplicate. |
| [style.css](../../style.css) | Existing form field styles. |

## Build this

### `renderEdit(avatarId)` in `dashboard.js`

Native DOM, same pattern as existing tab renderers. Fetch the avatar by id (`GET /api/avatars/:id`), then render a form:

- **Name** — text input, required, max 80.
- **Description** — textarea, max 500.
- **Visibility** — radio group: `public` / `unlisted` / `private`. Inline help: "Unlisted can be embedded anywhere via the direct URL. Private is only visible to you."
- **Tags** — comma-separated text input, trimmed + deduped on blur.
- **Thumbnail** — preview only (no reupload here — that's 03-02).
- **Save** / **Cancel** — Save PATCHes `/api/avatars/:id`; Cancel returns to list.
- **Delete** — destructive, requires type-to-confirm (the avatar's name). Calls `DELETE /api/avatars/:id`.

### Tab wiring

From the avatar list, each card gains an "Edit" button that routes to `?tab=edit&id=<avatar_id>`. Back-button restores list state.

### Success / error states

- Save success → toast "Saved", stay on the edit tab.
- Save error → inline field-level error if a known validation code, else a top-of-form banner.
- Delete success → redirect to list, toast "Deleted".

### Accessibility

All fields have `<label>` + programmatic focus on first field after mount. Escape key on the delete modal closes it.

## Out of scope

- Do not add avatar regeneration or GLB swap — that's 03-02.
- Do not add agent-identity editing (names, skills) — that's a separate layer.
- Do not build a bulk-edit view.

## Acceptance

- [ ] Clicking "Edit" on an avatar card opens the form populated with current values.
- [ ] Save persists and reloads cleanly; reopening shows the saved values.
- [ ] Visibility change from `public` → `private` removes the avatar from public `GET /api/avatars?visibility=public` results.
- [ ] Delete requires typing the exact name; mismatched input keeps the Delete button disabled.
- [ ] After delete, the avatar no longer appears in the list, and any agent previously bound has `avatar_id = NULL`.
- [ ] Keyboard-only navigation works.
- [ ] `npm run build` passes.
