# Task 02: Rewrite `/create` as 3-card picker

## Context

[create.html](../../create.html) currently boots the selfie-capture flow ([src/selfie-capture.js](../../src/selfie-capture.js), template at [create.html:308-368](../../create.html#L308-L368)). That pipeline depends on Avaturn's session API which is not reliably working. We are stepping back to a 3-option picker where selfie becomes "Coming Soon" and the other two paths (default-editor iframe, GLB upload) are the active ones.

**Depends on task 03** ([03-avaturn-iframe-rewire.md](./03-avaturn-iframe-rewire.md)) being merged first — this task consumes the `openDefaultEditor()` entry point that task 03 adds.

See [00-README.md](./00-README.md) for the overall plan.

## Goal

Rewrite the `/create` page body as a 3-card picker. Each card represents an avatar-acquisition path. Clicking a card triggers the associated flow. Selfie card is disabled and shows "Coming Soon".

## The 3 cards

### Card 1 — "Use default avatar"
- Icon/visual: default avatar thumbnail or abstract avatar illustration
- Title: **Use default avatar**
- Subtitle: *Edit a ready-made avatar in our web editor. No download required.*
- CTA: **Open editor**
- Action: calls `AvatarCreator.openDefaultEditor()` (added in task 03). On export → upload GLB via [src/account.js](../../src/account.js) flow → redirect to `/agent/:id`.

### Card 2 — "Upload your own GLB"
- Icon/visual: upload arrow or 3D cube illustration
- Title: **Upload your own GLB**
- Subtitle: *Drop a `.glb` file. Works with any glTF 2.0 model.*
- CTA: **Choose file**
- Action: opens hidden `<input type="file" accept=".glb,model/gltf-binary">`. On select → validate (ext + magic bytes `glTF`) → upload via presign → redirect to `/agent/:id`.
- **Tooltip** (render as `<small>` under the CTA): *Need a model? Try [Avaturn](https://avaturn.me) or [Mixamo](https://mixamo.com).* Links should open in new tabs with `rel="noopener"`.

### Card 3 — "From a selfie" (disabled)
- Icon/visual: camera illustration with a faded/greyscale treatment
- Title: **From a selfie**
- Subtitle: *Turn a photo into a rigged avatar.*
- Badge: **Coming Soon** (top-right corner of card)
- Action: no click handler. Card has `aria-disabled="true"` and does not receive keyboard focus.

## Deliverable

1. **Rewrite [create.html](../../create.html)**:
   - Replace the current selfie-capture template ([create.html:308-368](../../create.html#L308-L368) and any surrounding method-selection HTML) with a `<section class="create-picker">` containing three `<button class="create-card">` elements (or `<div>` for the disabled one).
   - Keep the existing `<header>` and overall page chrome.
   - Do **not** delete [src/selfie-capture.js](../../src/selfie-capture.js) or [src/selfie-pipeline.js](../../src/selfie-pipeline.js). Just unroute them.

2. **New file: `src/create.js`** (the page controller). Wires the three cards:
   - Card 1 → instantiates `AvatarCreator` with an `onExport` callback that POSTs the Blob through the presign + upload + `/api/agents/me` create flow (mirror what [src/account.js](../../src/account.js) does in the save path — factor a shared helper if clean).
   - Card 2 → file input handler, validates, uploads, creates agent.
   - Card 3 → no handler.
   - On successful avatar save: `window.location.href = '/agent/' + agentId`.
   - Use [src/account.js](../../src/account.js) `readAuthHint()` to check auth; if unauthed, redirect to `/login?next=/create`.

3. **CSS** — add minimal styles to [style.css](../../style.css) (or a new `create.css` if you prefer — match the existing pattern in the repo). Cards should be equal-width on desktop, stacked on mobile. Use existing CSS variables from the homepage so the visual language matches.

4. **Vite wiring** — `/create` is already served; check [vite.config.js](../../vite.config.js) `vercel-rewrites` plugin. If [create.html](../../create.html) loads [src/create.js](../../src/create.js) as a module, Vite should bundle it. Confirm with `npm run build`.

## Constraints

- **Do not** create the selfie-to-GLB feature. Card 3 is a placeholder.
- **Do not** delete the existing selfie files. They get unrouted, not removed.
- **Do not** add new runtime deps.
- **Do not** add TypeScript.
- **Do not** bypass the presign flow — GLBs must go R2 → `headObject` verified → `agent_identities` row (per the avatar-verification invariant in [CLAUDE.md](../../CLAUDE.md)).
- Prettier: tabs, 4-wide, single quotes. `npx prettier --write` before done.

## Verification

- [ ] `npm run build` passes
- [ ] `node --check create.html` — actually, HTML doesn't need `node --check`; just ensure `src/create.js` parses: `node --check src/create.js`
- [ ] `localhost:3000/create`:
  - Three cards visible, equal width on desktop
  - Card 1 opens the Avaturn iframe modal (via task 03's `openDefaultEditor`)
  - Card 2 opens a file picker; uploading a valid GLB redirects to `/agent/:id`
  - Card 3 shows "Coming Soon" badge, doesn't open anything when clicked
- [ ] Unauthed user visiting `/create` redirects to `/login?next=/create`
- [ ] Authenticated user after export lands on `/agent/:id` with the correct avatar loaded

## Reporting

- List files created / modified
- Confirm `src/selfie-capture.js` and `src/selfie-pipeline.js` still exist but are no longer imported from `create.html` / `src/create.js`
- Any files off-limits issues (check prompts/ subdirs for conflicting tasks)
- Describe what happens in each of the 3 cards on click
