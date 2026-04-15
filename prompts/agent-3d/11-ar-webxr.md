# Task 11 — AR / WebXR / Quick Look

## Context

Per [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) the element exposes an `ar` boolean attribute. It's currently a no-op. `<model-viewer>` solved this for a flat GLB preview; we extend their trick for an embodied agent — spawn the body in the user's space, voice continues through the device, agent uses gaze/look-at tools tied to the user's head pose.

Three AR paths need support:
- **WebXR immersive-ar** (Chrome Android, modern Meta Quest browser).
- **Quick Look** on iOS via a USDZ export of the GLB (or a pre-pinned USDZ companion).
- **Scene Viewer** on Android as a fallback when WebXR isn't present.

## Goal

Implement the `ar` attribute end-to-end: tap the AR button → AR session launches on the user's device → agent renders in the real world → voice + tool-use work.

## Deliverable

1. **`src/ar/webxr.js`** (new file):
	 - Detect capability via `navigator.xr?.isSessionSupported("immersive-ar")`.
	 - Start a hit-test-enabled session, reuse the element's Three.js renderer with XR mode, anchor the agent body on tap.
	 - Maintain a `user` target Vector3 tracked to the XR camera so `lookAt("user")` actually looks at the wearer.
	 - End the session cleanly when user exits; return to non-AR mode without re-mounting.
2. **`src/ar/scene-viewer.js`**:
	 - Detect Android (UA sniffing is acceptable for Intent URLs).
	 - Build an Android Intent URL: `intent://arvr.google.com/scene-viewer/1.2?file={glbURL}&mode=ar_preferred#Intent;...`.
3. **`src/ar/quick-look.js`**:
	 - If iOS and a USDZ companion URL is present in the manifest (`body.usdzURI`), open it with `<a rel="ar" href="{usdz}"><img></a>` sugar.
	 - If no USDZ, offer to convert on the fly via a server endpoint (placeholder) or display a graceful "AR unavailable on this device" message.
4. **Element wiring** — [src/element.js](../../src/element.js):
	 - Render a slotted `<button slot="ar-button">View in your space</button>` by default.
	 - Click handler selects the best AR path for the device in order: WebXR → Scene Viewer → Quick Look → fail.
	 - Emit `ar:start` / `ar:end` events.
5. **Manifest** — [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md):
	 - Add optional `body.usdzURI` and `body.arPreferred` fields.

## Audit checklist

- [ ] Chrome Android on an ARCore-supported phone: tap button → WebXR session starts → agent appears on tap → exits cleanly.
- [ ] Android fallback: if WebXR fails, Scene Viewer intent launches.
- [ ] iOS Safari: Quick Look opens if USDZ is provided; otherwise a clear unavailability message.
- [ ] Voice continues in AR mode (TTS audio routes through the device; STT mic access persists).
- [ ] `lookAt("user")` actually tracks the wearer in WebXR — confirm by moving around the agent.
- [ ] Agent orientation (up-axis) is correct — no sideways avatars.
- [ ] Exit from WebXR returns the element to its pre-AR layout and mode.
- [ ] AR button is keyboard-operable + `aria-label`-ed.

## Constraints

- No new dependencies (Three.js already includes WebXRManager).
- Do not pre-load a USDZ build pipeline in this task. Document the manifest field; conversion is a separate backend task.
- Do not override the element's core render loop — swap it to XR-aware on session start, restore on end.
- Preserve existing behavior when `ar` is off.

## Verification

1. `npm run build:lib` passes.
2. Manual AR test on at least Android Chrome + iOS Safari (developer's devices).
3. DevTools: confirm no Three.js disposal errors when ending and restarting an AR session.
4. Test on a non-AR desktop browser — the button should be hidden or display "AR unavailable".

## Scope boundaries — do NOT do these

- Do not attempt AR passthrough on Vision Pro / visionOS natively — WebXR only.
- Do not implement hand tracking or controller input.
- Do not add plane detection visualization or a reticle beyond the default hit-test cursor.
- Do not add multi-user AR (shared space). Single-user only.

## Reporting

- List of devices tested and their outcomes.
- Any Three.js XR quirks you worked around.
- USDZ conversion strategy recommendation for the future backend task.
- Performance observations in AR (fps, draw calls).
