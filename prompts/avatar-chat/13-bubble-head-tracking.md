# 13 — Thought bubble position tracks avatar's head in 3D space

## Status
Enhancement — the thought bubble is currently positioned at `top: 12%` of the avatar anchor, which is a fixed guess. When the avatar is framed differently (different camera angle, different model height), the bubble drifts away from the head.

## Files
`src/element.js` — `_renderShell()`, new `_updateBubblePosition()` method
`src/runtime/scene.js` or `src/viewer.js` — expose head world position

## Approach

Use Three.js `Vector3.project()` to convert the head bone's world position to NDC, then to CSS coordinates on the canvas.

### Step 1 — Expose head screen position from viewer

In `src/viewer.js` (or `src/runtime/scene.js`), add a method:
```js
getHeadScreenPosition() {
    // Find the head bone (same search used by agent-avatar.js)
    let headBone = null;
    this.content?.traverse((obj) => {
        if (!headBone && obj.isBone && /^head$/i.test(obj.name)) headBone = obj;
    });
    if (!headBone || !this.camera || !this.renderer) return null;

    const pos = new THREE.Vector3();
    headBone.getWorldPosition(pos);
    pos.project(this.camera);

    const canvas = this.renderer.domElement;
    const x = (pos.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-pos.y * 0.5 + 0.5) * canvas.clientHeight;
    return { x, y }; // pixels from top-left of canvas
}
```

### Step 2 — Update bubble position on every frame

In `element.js`, add a method:
```js
_updateBubblePosition() {
    if (!this._thoughtBubbleEl || !this._viewer) return;
    const pos = this._viewer.getHeadScreenPosition?.();
    if (!pos) return;
    // Offset bubble ~60px above the head
    const anchorRect = this._avatarAnchorEl?.getBoundingClientRect();
    const stageRect = this._stageEl?.getBoundingClientRect();
    if (!anchorRect || !stageRect) return;
    const relY = pos.y - (anchorRect.top - stageRect.top) - 60;
    const relX = pos.x;
    this._thoughtBubbleEl.style.top = `${Math.max(8, relY)}px`;
    this._thoughtBubbleEl.style.left = `${relX}px`;
    this._thoughtBubbleEl.style.transform = 'translateX(-50%) scale(var(--bubble-scale, 1))';
}
```

Store `this._avatarAnchorEl = avatarAnchor` in `_renderShell()`.

Hook `_updateBubblePosition()` into the viewer's render loop via `_afterAnimateHooks` (same pattern as agent-avatar.js):
```js
// After viewer is created in _boot():
this._viewer._afterAnimateHooks = this._viewer._afterAnimateHooks || [];
this._viewer._afterAnimateHooks.push(() => this._updateBubblePosition());
```

### Step 3 — Remove fixed CSS top

In `BASE_STYLE`, change `.thought-bubble`:
```css
.thought-bubble {
    position: absolute;
    /* Remove: top: 12%; */
    top: 0; /* JS will override */
    left: 50%; /* JS will override */
    ...
}
```

## Fallback
If `getHeadScreenPosition()` returns null (model not loaded, no head bone), the bubble stays at `top: 0` with `left: 50%` — acceptable degraded state.

## Verification
Load a model. Trigger the thought bubble. It should appear just above the avatar's head. Orbit the camera — the bubble should follow the head as it moves on screen.
