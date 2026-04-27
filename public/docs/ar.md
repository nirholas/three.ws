# AR & WebXR

three.ws supports three AR methods, each targeting a different platform:

| Method | Platform | Mechanism |
|--------|----------|-----------|
| iOS QuickLook | iPhone/iPad (Safari) | Native AR viewer via `<a rel="ar">` |
| Android Scene Viewer | Android (Chrome) | Google's ARCore via intent URL |
| WebXR | Any WebXR-capable browser | Immersive AR session in-page |

The right method is selected automatically based on the device. On iOS, tapping the AR button launches QuickLook. On Android, it launches Scene Viewer. On WebXR-capable devices (Chrome/Android with ARCore, Safari 15.4+ with WebXR), it starts an immersive-ar session.

---

## Enabling AR

Add the `ar` attribute to `<agent-3d>`:

```html
<agent-3d model="./product.glb" ar></agent-3d>
```

The AR button is only shown when:

- The `ar` attribute is present
- The device/browser supports at least one AR method
- The model has finished loading

On desktop, the button is hidden — no desktop browser has functional `immersive-ar` support.

---

## iOS QuickLook

Safari on iOS intercepts clicks on `<a rel="ar">` elements and opens the native QuickLook AR viewer. The implementation in `src/ar/quick-look.js` does exactly this:

```js
// quick-look.js (simplified)
function openQuickLook(usdzURI) {
  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = usdzURI;
  a.appendChild(document.createElement('img')); // required for programmatic click
  a.click();
}
```

The child `<img>` element is required — without it, Safari won't intercept the programmatic `.click()` as a QuickLook trigger.

**iOS 13+** accepts GLB files directly via the `href`; no server-side USDZ conversion is needed.

**Requirements:**
- iOS 13+ with Safari (not Chrome/Firefox on iOS — they use WebKit but lack QuickLook integration)
- Model served over HTTPS with CORS headers
- No DRM-protected assets

**Limitations:**
- Animations are not supported — the model displays in a static pose
- No agent conversation in QuickLook (it's a native OS viewer, outside the browser)

---

## Android Scene Viewer

Google's Scene Viewer is launched via an intent URL. `src/ar/scene-viewer.js` constructs the URL and navigates to it:

```js
// scene-viewer.js (simplified)
function openSceneViewer(glbURL, { title = '', link = '' } = {}) {
  const params = new URLSearchParams({ file: glbURL, mode: 'ar_preferred' });
  if (title) params.set('title', title);
  if (link) params.set('link', link);

  const fallback = encodeURIComponent(location.href);
  const intentURL =
    `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}` +
    `#Intent;scheme=https;package=com.google.ar.core;` +
    `action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${fallback};end;`;

  location.href = intentURL;
}
```

The `S.browser_fallback_url` parameter is important: if ARCore isn't installed, Chrome redirects back to your page instead of showing an error screen.

**Parameters passed to Scene Viewer:**
- `file` — GLB URL (must be HTTPS)
- `title` — shown in the AR viewer's title bar
- `link` — "View in browser" button target
- `mode=ar_preferred` — tries AR first, falls back to 3D view if unsupported

**Requirements:**
- Android 7.0+ with Google Play Services
- Chrome 67+ (or Chrome-based browser)
- GLB served over HTTPS with CORS

**What works in Scene Viewer:**
- GLB animations play
- Basic lighting and shadows
- No agent conversation (external viewer)

---

## WebXR

WebXR is the only AR method that keeps the agent running inside the browser. The `src/ar/webxr.js` module manages an `immersive-ar` session using Three.js's built-in XR support.

**How it works:**

1. `WebXRSession.isSupported()` checks `navigator.xr.isSessionSupported('immersive-ar')`
2. On activation, requests a session with the `hit-test` feature enabled
3. Three.js XR mode is enabled on the existing renderer — no new canvas needed
4. The scene background is set to `null` so the camera feed shows through
5. Hit-test results track real surfaces in the environment
6. Before the first tap, the agent follows the detected surface in real-time
7. First tap anchors the agent at that position
8. The agent's full runtime continues: animations play, conversation works

**Session lifecycle:**
```
requestSession('immersive-ar', { requiredFeatures: ['hit-test'] })
  → renderer.xr.setSession(session)
  → requestReferenceSpace('local') + requestHitTestSource({ space: viewer })
  → render loop handed to XR system via renderer.setAnimationLoop()
  → session 'end' event → restore background, re-enable controls, resume RAF
```

**On exit**, the module restores the scene background, the agent's position/rotation, and the standard requestAnimationFrame loop. State is cleanly preserved.

**Requirements:**
- Chrome on Android 8.0+ with ARCore installed
- Safari on iOS 15.4+ with WebXR AR module enabled
- HTTPS (mandatory — `navigator.xr` is undefined on insecure origins)

**What works in WebXR:**
- Full animations
- Agent conversation (microphone, chat)
- `lookAt('user')` — the agent tracks the XR camera position as the user's head
- All runtime tools and skills

---

## Programmatic API

```js
const el = document.querySelector('agent-3d');

// Check if the current device supports any AR method
if (el.canActivateAR) {
  await el.activateAR();
}
```

`canActivateAR` returns `true` if the model is loaded and at least one of QuickLook, Scene Viewer, or WebXR is available. `activateAR()` picks the best available method automatically.

---

## HTTPS Requirement

All three AR methods require HTTPS. `navigator.xr` is undefined on insecure origins; QuickLook and Scene Viewer require the model URL to be HTTPS regardless of how the page is served.

**Local development:**

```bash
# Use ngrok to tunnel localhost over HTTPS
ngrok http 5173
# Open the ngrok URL on your mobile device
```

Alternatively, deploy to Vercel or Netlify — both provide instant HTTPS on preview deployments.

---

## Model Size and Compatibility

- **Large models (>20 MB):** QuickLook and Scene Viewer download the full GLB before displaying. Expect noticeable load time on mobile networks.
- **Draco compression:** Draco-compressed GLBs may need to be decompressed before transfer to QuickLook or Scene Viewer, which don't load the Three.js Draco decoder. WebXR is unaffected — it uses the same Three.js loader as the regular viewer.
- **Animations:** Only WebXR and Scene Viewer support animations. QuickLook shows a static pose.
- **Textures:** All three methods support standard PBR materials (baseColor, normal, roughness/metallic).

---

## Quick Reference

| | QuickLook | Scene Viewer | WebXR |
|---|---|---|---|
| Platform | iOS Safari | Android Chrome | Any WebXR browser |
| Animations | No | Yes | Yes |
| Agent conversation | No | No | Yes |
| HTTPS required | Yes (model URL) | Yes (model URL) | Yes (page) |
| Draco GLBs | May fail | May fail | Yes |
| Max practical model size | ~15 MB | ~20 MB | No hard limit |
