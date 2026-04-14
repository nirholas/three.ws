---
mode: agent
description: "Add WebXR AR Quick Look support for viewing models in augmented reality"
---

# AR Quick Look / WebXR

## Context

The README roadmap lists **"AR Quick Look — launch your model in WebXR on supported devices"**. WebXR is the standard for immersive web experiences.

## Implementation

### 1. WebXR AR Session (`src/ar-viewer.js`)

Use the WebXR Device API for AR:

```js
const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.getElementById('ar-overlay') }
});
```

- Detect WebXR support: `navigator.xr.isSessionSupported('immersive-ar')`
- On supported devices, show "View in AR" button
- Place the model on detected surfaces using hit-test
- Allow pinch-to-scale and rotate gestures
- DOM overlay for UI controls during AR session

### 2. iOS Quick Look Fallback

For iOS Safari (no WebXR):
- Generate USDZ file from the GLB using a client-side converter
- Or provide a `<a rel="ar">` link with the GLB → iOS handles natively
- Apple's AR Quick Look supports GLB directly since iOS 15

```html
<a rel="ar" href="model.glb">
    <img src="ar-icon.png">
</a>
```

### 3. Android Scene Viewer Fallback

For Android Chrome without WebXR:
- Use Google's Scene Viewer intent:
```
intent://arvr.google.com/scene-viewer/1.0?file=MODEL_URL#Intent;scheme=https;package=com.google.android.googlequicksearchbox;end;
```

### 4. AR UI Overlay

During AR session:
- Crosshair reticle for surface detection
- "Place Model" tap handler
- Scale/rotate gesture indicators
- "Exit AR" button
- Model info badge (name, triangles)

### 5. Platform Detection & Button

```
Desktop (no XR)     → Button hidden or shows "AR not supported"
Android + WebXR     → "View in AR" → WebXR immersive-ar
Android - WebXR     → "View in AR" → Scene Viewer intent
iOS                 → "View in AR" → Quick Look / USDZ
VR Headset          → "View in VR" → immersive-vr session
```

### 6. GUI Integration

- Add "View in AR" button to the header bar (next to "Create Avatar")
- Show device compatibility badge
- Settings in dat.gui: scale factor, shadow enabled, lighting mode

## File Structure

```
src/
├── ar-viewer.js       # WebXR session, hit-test, placement
├── ar-fallbacks.js    # iOS Quick Look, Android Scene Viewer
```

## Validation

- On Android Chrome with ARCore → WebXR session starts, model placed on surface
- On iOS Safari → Quick Look opens with the model
- On desktop → button hidden or shows "Not supported on this device"
- Model scale and orientation are correct in AR
- Pinch-to-scale and rotate work smoothly
