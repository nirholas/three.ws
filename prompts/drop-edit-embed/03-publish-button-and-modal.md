# Task 03 — "📤 Publish as embed" button + share modal

## Why this exists

Tasks 01–02 built the plumbing. This one ships the user-visible piece: a button in the editor that turns the current scene into a shareable widget, and a modal with copy-ready snippets. After this lands, the "drop → edit → embed" loop is complete for signed-in users on the happy path.

## Shared context

- The editor's control folder is built in [src/editor/index.js](../../src/editor/index.js) `_addExportFolder()` — it currently adds `💾 download GLB`, `🗂 scene panel [T]`, `↺ revert all edits`. You add one more control here: `📤 publish as embed`.
- [src/editor/publish.js](../../src/editor/publish.js) exists after task 02. It exports `publishEditedGLB(session, opts)` returning `{ widget, avatar, urls }` and a set of typed errors.
- The modal should match the look of [src/avatar-creator.js](../../src/avatar-creator.js) (CSS class `.avatar-creator-overlay` / `.avatar-creator-modal` in [style.css](../../style.css)) — reuse that shell visually so this doesn't feel like a new design system. Copy the DOM structure; add a new class (`.publish-modal-*`) to avoid CSS collisions.
- Progress UI: use the `onStep` callback from `publishEditedGLB` — render a 4-step row (`Export → Upload → Register → Widget`) with checkmarks and a spinner on the in-flight step.

## What to build

### 1. Add the control

In [src/editor/index.js](../../src/editor/index.js) `_addExportFolder()`, after the `💾 download GLB` row, add:

```js
folder
	.add({ publish: () => this._openPublishModal() }, 'publish')
	.name('📤 publish as embed');
```

Store a reference (`this._publishCtrl = …`) so you can disable it while a publish is in-flight.

Make `_openPublishModal()` a method on `Editor` that:

1. Dynamic-imports `./publish.js` (keeps the main bundle lean).
2. Constructs a `PublishModal` instance (new class, see below).
3. Calls `publishEditedGLB(this.session, { onStep: modal.onStep })`.
4. On resolve: `modal.showResult(result.urls)`.
5. On `AuthRequiredError`: `modal.showAuthRequired()` — the UX is "Sign in to publish" with a button that goes to `/login?next=…`. Task 04 fills in `next=…` with edit-pending state; for now just go to `/login?next=${encodeURIComponent(location.href)}`.
6. On `SizeTooLargeError`, `ExportFailedError`, `PublishError`: `modal.showError(err)`.

Re-enable the publish control in a `finally`.

### 2. New file: `src/editor/publish-modal.js`

```js
/**
 * PublishModal — post-publish share UI.
 *
 * DOM structure mirrors avatar-creator.js:
 *   <div class="publish-overlay">
 *     <div class="publish-modal">
 *       <div class="publish-header"><span class="publish-title">…</span><button class="publish-close">×</button></div>
 *       <div class="publish-body">
 *         <!-- one of three states: "working" | "result" | "error" -->
 *       </div>
 *     </div>
 *   </div>
 */
export class PublishModal {
	constructor(containerEl) { … }
	open()  { … }    // mounts, shows "working" state
	close() { … }    // unmounts, removes listeners

	/** progress callback compatible with publish.js */
	onStep = ({ step, pct }) => { … }  // update checkmarks/spinner in the "working" state

	showResult(urls)         { … }     // renders the three snippets + copy buttons + QR-less link + "Open" button
	showAuthRequired()       { … }     // renders a "Sign in" CTA
	showError(err)           { … }     // renders the error name + .message + a Retry button
}
```

Result state layout:

```
┌───────────────────────────────────────┐
│ Published ✓                      [×]  │
├───────────────────────────────────────┤
│ Share link                            │
│ [ https://…/w/wdgt_xxxxx  ][ Copy ][Open]
│                                       │
│ Iframe snippet                        │
│ [ <iframe src="…" … >…</iframe>  ][ Copy ]
│                                       │
│ Web component snippet                 │
│ [ <script …><agent-3d …>… ][ Copy ]   │
│                                       │
│                              [ Done ] │
└───────────────────────────────────────┘
```

- Each "Copy" button: `navigator.clipboard.writeText(value)`. Flash the button text to "Copied ✓" for ~1.2 s, then revert.
- "Open" button on the link row: `window.open(urls.page, '_blank', 'noopener')`.
- ESC closes the modal. Click-outside the inner `.publish-modal` closes.
- Focus trap: on open, focus the first Copy button; on ESC restore focus to the publish control in the editor folder.

### 3. Styles

Add to [style.css](../../style.css) at the end — a single scoped block keyed to `.publish-overlay`, `.publish-modal`, `.publish-body`, `.publish-snippet`, `.publish-copy-btn`, `.publish-step`, `.publish-step--done`, `.publish-step--active`, `.publish-step--pending`. Match the existing dark-theme colors (see `.avatar-creator-*` rules for the palette).

Do not introduce new CSS variables. Match the existing `--accent` / `--panel-bg` if present; otherwise use the same hex values the avatar-creator modal uses.

### 4. Accessibility

- Root `<div class="publish-overlay">` gets `role="dialog"`, `aria-modal="true"`, `aria-labelledby="publish-title"`.
- The "Working" state has `aria-live="polite"` on the progress row so screen readers hear step changes.
- All three snippet `<pre>` blocks are `tabindex="0"` so keyboard users can select+copy manually.

## Files you own

- Edit: [src/editor/index.js](../../src/editor/index.js) — add control, add `_openPublishModal()` method (~30 LOC).
- Create: `src/editor/publish-modal.js` (~220 LOC target — keep it tight).
- Edit: [style.css](../../style.css) — append one new block at EOF.

## Files off-limits

- `src/editor/publish.js` — owned by task 02 (stable after 02 ships).
- `src/editor/session.js`, `src/editor/glb-export.js`, `src/editor/material-editor.js`, `src/editor/texture-inspector.js`, `src/editor/scene-explorer.js` — not in this task.
- `src/app.js` — task 01 territory.
- Any `api/*` file.
- `public/studio/*`, `public/widgets-gallery/*` — separate surfaces.

## Acceptance

- While signed in: drop a GLB → tweak one material → click `📤 publish as embed` → modal shows 4-step progress → lands on a result with three working snippets → Copy+Open on `.page` opens the widget correctly in a new tab.
- While signed out: click publish → modal shows "Sign in to publish" state with a CTA going to `/login?next=<current URL>`.
- Oversize (>25 MB exported): modal shows the `SizeTooLargeError` with a human-readable message including the actual size and limit. Task 06 will improve this copy later.
- Keyboard: Tab through all three Copy buttons, ESC closes, focus returns to the editor folder.

## Reporting

Use the template in [00-README.md](./00-README.md). Include a screenshot of the result modal (paste into the PR description; your report can just say "attached").
