# 20 — Camera framing: center avatar in the anchor window

## Status
Gap — the Three.js camera is set to frame the full avatar body against the full canvas. With the new layout, the avatar anchor is roughly the center 40-60% of the canvas height. The camera should be adjusted so the avatar's upper body / head fills the anchor window, not the full canvas.

## Files
`src/viewer.js` — camera setup, `fitCameraToModel()`
`src/element.js` — post-boot camera adjustment

## Background

The viewer places the camera using `fitCameraToModel()` which centers the bounding box of the loaded model and sets distance to fit it. With the chrome taking top and bottom space, the avatar is framed against the full canvas but visible only through the anchor in the middle.

## Approach

After the model loads and the `agent:ready` event fires in element.js, offset the camera vertically to push the avatar into the visible anchor window.

### Option A — Camera target offset (preferred)

In element.js, after boot completes, adjust the camera's target to be slightly above center (toward the head), effectively panning the view to center the avatar in the anchor:

```js
// After this._viewer is set up and model is loaded:
const moveCamera = () => {
    const v = this._viewer;
    if (!v?.camera || !v?.controls) return;
    // Shift camera target upward by ~15% of the scene height
    // so the avatar's upper body fills the anchor window
    const box = new THREE.Box3().setFromObject(v.content);
    const h = box.max.y - box.min.y;
    const mid = (box.max.y + box.min.y) / 2;
    v.controls.target.set(0, mid + h * 0.12, 0);
    v.controls.update();
};

// Subscribe to load-end on the protocol bus to trigger after model loads
protocol.on(ACTION_TYPES.LOAD_END, moveCamera);
```

Import THREE.Box3 from 'three' at the top of element.js (or use `this._viewer.scene` to access it).

### Option B — CSS anchor positioning

A simpler but less precise alternative: adjust the `top` percentage of `.avatar-anchor` and `min-height` so the window aligns better with where the avatar's upper body lands naturally.

Try first with the CSS of `.avatar-anchor`:
```css
.avatar-anchor {
    flex: 1;
    position: relative;
    pointer-events: none;
    min-height: 100px;
    /* Pull down slightly so avatar upper body is visible */
    margin-top: 8px;
}
```

And adjust the thought bubble `top` from `12%` to `8%`.

Use Option A for production — Option B is a quick preview.

## Verification
Load a humanoid avatar. The avatar's head and shoulders should be visible and centered in the avatar anchor window (the space between chat and input). The feet may be cropped — that is acceptable and intentional.
