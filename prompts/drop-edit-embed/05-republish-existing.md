# Task 05 — Re-publish: Update existing widget vs Create new

## Why this exists

Once a user has published their first widget, they'll reload it (e.g. via `#widget=wdgt_abc123`), edit more, and want to publish again. Two possible semantics: overwrite the existing widget (same URL → same embed in every host it was pasted into) or spawn a new widget (original stays stable, the tweak becomes a sibling). Users need the choice — default should be Update, escape-hatch should be Create new.

## Shared context

- The viewer already accepts `#widget=wdgt_abc123` as a hash param (per README and [src/app.js](../../src/app.js) — verify the exact key and the fetch path it uses).
- A loaded widget gives us:
  - `widget.id`
  - `widget.avatar_id`
  - `widget.name`
  - `widget.config`
- `PATCH /api/widgets/:id` exists in [api/widgets/\[id\].js](../../api/widgets/[id].js). Verify its accepted body shape — expect `{ name?, config?, is_public?, avatar_id? }`. Do not assume; read the file.
- **Avatar swap vs edit-in-place:** the edited GLB is always a new avatar (different bytes, different `storage_key`). Re-publish = upload new avatar, then either:
  - (A) Update the widget to point at the new `avatar_id`, or
  - (B) Mint a fresh widget.
- Option A preserves the `/w/<id>` URL — critical for links already pasted elsewhere.

## What to build

### 1. Detect the loaded-widget context

Wherever the app already loads from `#widget=…` (find it in [src/app.js](../../src/app.js)), expose the raw widget record on `this.loadedWidget`. If no widget context (plain drag-drop or `#model=url`), `this.loadedWidget = null`.

Pass this through to the editor via a new `Editor.setContext({ widget })` method, or thread it through `onContentChanged`'s `name` param — whichever is cleaner for your read of the file. Do not add a global.

### 2. Publish modal branching

In [src/editor/publish-modal.js](../../src/editor/publish-modal.js) (task 03) `open()` state, if a widget context exists, show a two-choice row **before** starting the publish:

```
┌─────────────────────────────────────────┐
│ Publish ✓                          [×]  │
├─────────────────────────────────────────┤
│ You're editing widget wdgt_abc123.      │
│                                         │
│ (●) Update this widget  (preserves URL) │
│ ( ) Create a new widget                 │
│                                         │
│                       [ Cancel ] [ Go ] │
└─────────────────────────────────────────┘
```

If no widget context, skip this step and run the existing flow directly (task 03 behavior).

`Go` calls either:

- **Update:** a new `updateWidget()` function in [src/editor/publish.js](../../src/editor/publish.js) (task 02). Steps:
  1. `exportEditedGLB(session)` → bytes
  2. Upload → register new avatar (same as first-publish)
  3. `PATCH /api/widgets/:id` with `{ avatar_id: newAvatar.id }`
  4. Resolves `{ widget: updated, avatar: new, urls }` — same shape as `publishEditedGLB`.
- **Create new:** the existing `publishEditedGLB(session, …)` — unchanged.

Result modal shows:

- On Update: header "Updated ✓" + a note "Paste hosts already showing wdgt_abc123 will pick up the new version on next load." Same three snippets (URL/iframe/component) — they're unchanged.
- On Create new: header "Published ✓" + three snippets for the new id.

### 3. Widget-not-yours guard

A user can load any public widget (`#widget=<id>` works anonymously). If they try to Update a widget they don't own, `PATCH /api/widgets/:id` will 403. Catch that in `updateWidget()` and:

- Show a friendly error in the modal: "You don't own this widget. Switching to 'Create new'."
- Automatically flip the radio and keep the modal open so one click of `Go` publishes as a fresh widget.

Do not auto-submit — give the user the chance to cancel.

### 4. Tests / acceptance detail

- Load `/#widget=<one you own>`, edit, click Publish → modal offers both radios → Update keeps the same id, the new avatar appears on next reload.
- Same flow with Create new → new id, old widget untouched.
- Load `/#widget=<someone else's public widget>`, edit, click Publish → try Update → error → radio flips to Create new → Go mints a fresh widget.
- Plain `http://localhost:3000` drop → no radio shown, publish runs directly (no regression).

## Files you own

- Edit: [src/editor/publish.js](../../src/editor/publish.js) — add `updateWidget(session, widgetId, opts)` alongside the existing `publishEditedGLB`. Factor the upload+register steps into a private `uploadEditedAvatar(session, opts)` helper both call.
- Edit: [src/editor/publish-modal.js](../../src/editor/publish-modal.js) — add pre-publish choice state.
- Edit: [src/editor/index.js](../../src/editor/index.js) — add `Editor.setContext({ widget })` + plumb into `_openPublishModal()`.
- Edit: [src/app.js](../../src/app.js) — on widget-loaded, call `editor.setContext({ widget })`.

## Files off-limits

- `api/widgets/*` — endpoints are stable.
- `src/editor/edit-persistence.js` (task 04) — no need to touch; the stash carries nothing widget-specific.
- `src/editor/glb-export.js`, `src/editor/session.js`, `src/editor/material-editor.js`, etc. — not in scope.

## Acceptance

- All three manual tests above pass.
- `PATCH /api/widgets/:id` is called with exactly `{ avatar_id }` on Update — nothing else, to avoid clobbering a user's later config tweak from Studio.
- `node --check` all modified files.
- `npm run verify` passes.

## Reporting

Use the template in [00-README.md](./00-README.md). Call out any place in `api/widgets/[id].js` you had to read to confirm the body schema — include the line numbers.
