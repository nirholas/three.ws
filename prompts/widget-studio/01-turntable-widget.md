# Prompt 01 — Turntable Showcase Widget

**Branch:** `feat/widget-turntable`
**Depends on:** `feat/studio-foundation` (Prompt 00) merged.
**Parallel with:** 02, 03, 04, 05.

## Goal

Ship the Turntable Showcase widget end-to-end: it is the simplest and the one that has to work flawlessly because it proves the Studio → Save → Public embed loop. A hero banner for sites: auto-rotating model, branded background, no UI clutter, optional caption overlay, optional "click to pause" interaction, and a poster image fallback for slow networks.

This is the "look-at-my-cool-model" widget. It must feel polished. If it feels like a demo, we failed.

## Prerequisites

- Prompt 00 merged. You have:
    - `/studio` route with avatar picker, type picker, live preview, config save/load.
    - `src/widget-types.js` with `turntable` marked `status: 'ready'`.
    - `src/widgets.js` client.
    - `api/widgets/*` endpoints.
    - Public `#widget=<id>` resolution in `src/app.js`.

Read the PR that shipped Prompt 00 before starting so you know the exact contract.

## Read these first

| File                                                                   | Why                                                                                                                                                                          |
| :--------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/viewer.js](../../src/viewer.js)                                   | Find the existing auto-rotate support (OrbitControls `autoRotate`) and the background color implementation. Find how the camera is framed. Find how env presets are applied. |
| [src/app.js](../../src/app.js) — `hash.widget` handling from Prompt 00 | You will branch on `widget.type === 'turntable'` in the public flow.                                                                                                         |
| [src/widget-types.js](../../src/widget-types.js)                       | You will extend the turntable schema here.                                                                                                                                   |
| [public/studio/studio.js](../../public/studio/studio.js)               | You will add the turntable-specific form fields.                                                                                                                             |
| [src/ipfs.js](../../src/ipfs.js)                                       | Resolve IPFS/Arweave URIs if the avatar uses them.                                                                                                                           |
| The existing `features.html` hero                                      | Match visual polish level.                                                                                                                                                   |

## Build this

### 1. Extend the turntable config schema

In `src/widget-types.js`, add turntable-specific fields on top of `BRAND_DEFAULTS`:

```js
const TURNTABLE_DEFAULTS = {
	rotationSpeed: 1.0, // OrbitControls autoRotateSpeed (1.0 = ~30s/rev)
	rotationAxis: 'y', // 'x' | 'y' | 'z'
	clickToPause: true,
	loopDirection: 'cw', // 'cw' | 'ccw'
	posterUrl: null, // optional poster image (shown before load)
	captionPosition: 'bottom', // 'top' | 'bottom' | 'none'
	captionStyle: 'pill', // 'pill' | 'bar' | 'none'
	startFrame: null, // optional [x,y,z] camera start if different from cameraPosition
	fogColor: null, // optional radial fog for vignette feel
	shadow: 'contact', // 'contact' | 'ground' | 'none' — ground contact shadow
};
```

Validate with zod. Clamp `rotationSpeed` to `[0.1, 10]`. `captionStyle` values map to CSS classes you define in the runtime.

### 2. Add Studio form controls

In the Studio config column (Prompt 00 built this skeleton), when `state.type === 'turntable'` render these controls in a "Turntable options" fieldset:

- **Rotation speed** — range 0.1–10, step 0.1.
- **Axis** — radio: Y (default), X, Z.
- **Direction** — toggle cw / ccw.
- **Click to pause** — checkbox.
- **Caption position** — radio: bottom / top / none. Disable if brand `caption` is empty.
- **Caption style** — radio: pill / bar. Preview applies live.
- **Contact shadow** — select: contact / ground / none.
- **Poster image** — URL field + "Use current frame" button that screenshots the preview canvas and uploads it via the existing R2 presign flow (`/api/avatars/presign` — check if it supports a generic `kind: 'poster'` or if you need to extend it).

All changes live-update the preview via the postMessage bridge from Prompt 00.

### 3. Widget runtime

Create `src/widgets/turntable.js`. This is the module that runs inside the viewer when `#widget=<id>` resolves to a turntable-type widget.

```js
export function mountTurntable(viewer, config, container) {
	// 1. Apply brand config (already done by Prompt 00's resolver, but verify idempotence).
	// 2. Set OrbitControls.autoRotate = true, autoRotateSpeed = direction * speed.
	// 3. Lock controls based on config.clickToPause:
	//    - If true: render invisible click target; pause/resume on click.
	//    - If false: disable all user input (viewer.controls.enabled = false).
	// 4. Hide dat.gui, validator bar, drop zone, footer — anything not the canvas.
	// 5. Render caption overlay if config.caption && captionPosition !== 'none'.
	// 6. Apply rotationAxis by swapping OrbitControls target offset (y default is already correct; x/z require tweaking camera up vector + orbit target).
	// 7. If config.shadow !== 'none', add a ContactShadows plane under the model (use three.js ContactShadows or a simple shadow-catching plane).
	// 8. If config.posterUrl, render an <img> overlay that fades out on gltf load.
	// 9. Return { destroy, pause, resume } for cleanup.
}
```

### 4. Wire the runtime into `src/app.js`

After the widget fetch in `hash.widget` resolution:

```js
if (window.VIEWER.widget?.type === 'turntable') {
	const { mountTurntable } = await import('./widgets/turntable.js');
	// Wait for viewer.load() to complete, then mount:
	this.view(resolvedModel, '', new Map()).then(() => {
		this._widgetRuntime = mountTurntable(this.viewer, window.VIEWER.widget.config, this.el);
	});
}
```

Dynamic import keeps the main bundle small when the viewer isn't acting as a widget runtime.

### 5. Poster image capture

The Studio needs a "Use current frame" button. Implementation:

```js
// In studio.js, when user clicks the button:
const iframe = document.getElementById('preview-iframe');
const canvas = iframe.contentDocument.querySelector('canvas');
canvas.toBlob(
	async (blob) => {
		const { url, upload_url } = await api.presign({
			kind: 'poster',
			content_type: 'image/png',
		});
		await fetch(upload_url, { method: 'PUT', body: blob });
		updateConfig({ posterUrl: url });
	},
	'image/png',
	0.92,
);
```

If `/api/avatars/presign` only supports GLBs today, extend it to accept `kind: 'poster' | 'thumbnail' | 'glb'` with separate R2 prefixes.

### 6. Caption overlay CSS

Define caption styles in `style.css` under a `.widget-caption` scope:

- `.widget-caption--pill` — rounded, semi-transparent accent-tinted background, centered horizontally.
- `.widget-caption--bar` — full-width bar, respects accent color.

Both use `font-size: clamp(14px, 1.6vmin, 20px)` so they scale with embed size.

### 7. Touch + mobile

- Click-to-pause must work on touch (`pointerdown`, not `click`, to feel responsive).
- On mobile, disable auto-rotate when the widget is not visible (use `IntersectionObserver` — pauses off-screen to save battery).
- Support `prefers-reduced-motion: reduce` — if true, disable auto-rotate and keep the model static on its start frame.

### 8. Analytics (lightweight)

When the widget successfully mounts, POST `/api/widgets/:id/ping` once. The endpoint just bumps `view_count` (Prompt 00's GET already does this — decide whether ping is redundant; if so, skip this section).

## Do not do this

- Do not build animation playback UI — that's Prompt 02's Animation Gallery.
- Do not build chat or MCP integration — that's Prompt 03.
- Do not add a second camera; the existing orbit camera is fine.
- Do not ship a "logo upload" feature. Caption text + accent color is enough branding for v1.
- Do not introduce threejs addons that aren't already in the project. Check `node_modules/three/examples/jsm/` for what's available (ContactShadows should be there).
- Do not break the `clickToPause: true` + `autoRotate` interaction — pausing must not lose the current rotation position.

## Deliverables

**New:**

- `src/widgets/turntable.js` — runtime module.
- CSS additions (either `style.css` or new `src/widgets/widgets.css` imported by the runtime modules).

**Modified:**

- `src/widget-types.js` — add turntable schema and defaults.
- `src/app.js` — dispatch to `mountTurntable` when widget type matches.
- `public/studio/studio.js` — turntable-specific form fieldset.
- Possibly `api/avatars/presign.js` if you extend it for posters.
- `src/viewer.js` — minimal additions only if required (e.g. a `setAutoRotate()` public method if the existing logic isn't exposed cleanly).

## Acceptance criteria

- [ ] A signed-in user can create a turntable widget in Studio, save it, and share the resulting URL.
- [ ] The public widget URL, loaded cold in an incognito window:
    - [ ] Shows no dat.gui, no validator bar, no drop UI, no footer.
    - [ ] Auto-rotates at the configured speed in the configured direction.
    - [ ] Respects background color, accent color, caption, caption position/style.
    - [ ] Starts at the saved camera position.
    - [ ] Pauses on tap/click when `clickToPause: true`; resumes on second tap.
    - [ ] Is fully responsive — works at 300x300 and 1920x1080.
- [ ] On a device with `prefers-reduced-motion: reduce`, auto-rotate is disabled.
- [ ] Off-screen widgets pause via IntersectionObserver.
- [ ] Poster image (if set) appears before the GLB loads and fades out smoothly.
- [ ] "Use current frame" captures a PNG, uploads it to R2, and the widget picks it up.
- [ ] No console errors on load.
- [ ] `npm run build` succeeds; bundle gzip size increase is < 15 KB.

## Test plan

1. `npm run dev`. Sign in. Go to `/studio`. Create a Turntable widget using an existing avatar with a clear silhouette.
2. Tweak every config option. Preview updates live.
3. Save and generate embed.
4. Open the widget URL in Chrome (desktop), Safari iOS (via DevTools emulation or a real device if possible), and a Lighthouse mobile run.
5. Paste the `<iframe>` snippet into a scratch HTML file and open it — embed must work when cross-origin.
6. Verify `prefers-reduced-motion` by setting `Emulate CSS media: prefers-reduced-motion: reduce` in Chrome DevTools. Rotation should stop.
7. Scroll the widget off-screen (in the scratch HTML); rotation should pause. Scroll back; it should resume.
8. Try an IPFS-hosted avatar (any `ipfs://CID` model). It should resolve and render.
9. Try an ERC-8004-registered agent's avatar. It should render the same way.
10. Run Lighthouse on the public widget URL — accessibility ≥ 95, performance ≥ 80.

## When you finish

- PR with a video recording of the Studio flow + the embedded widget on a white background.
- Flip `status: 'ready'` is already set — do not change it.
- Confirm the foundation tests (Prompt 00 acceptance) still pass.
