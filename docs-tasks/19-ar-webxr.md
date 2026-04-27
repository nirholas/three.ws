# Agent Task: Write "AR & WebXR" Documentation

## Output file
`public/docs/ar.md`

## Target audience
Developers who want to add AR (Augmented Reality) viewing to their three.ws embeds. Brief and practical — covers all three AR methods.

## Word count
1000–1500 words

## What this document must cover

### 1. AR overview
three.ws supports three AR methods:
| Method | Platform | How it works |
|--------|----------|-------------|
| iOS QuickLook | iPhone/iPad (Safari) | Opens native AR viewer via `.usdz` or `.reality` |
| Android Scene Viewer | Android (Chrome) | Opens Google's Scene Viewer via intent URL |
| WebXR | Any device with WebXR support | Inline AR in the browser (immersive-ar session) |

### 2. Enabling AR
Add the `ar` attribute to `<agent-3d>`:
```html
<agent-3d model="./product.glb" ar></agent-3d>
```
An AR button appears when the device supports AR. On iOS, tapping launches QuickLook. On Android, tapping launches Scene Viewer. On WebXR devices, starts an immersive AR session.

### 3. iOS QuickLook
Safari on iOS supports native AR through the QuickLook framework. The GLB is automatically converted to USDZ for display.

How `quick-look.js` works:
- Creates an `<a>` element with `rel="ar"` and `href` pointing to the model URL
- iOS Safari intercepts the click and opens the native QuickLook AR viewer
- Users can place the 3D object in their real environment
- No server-side conversion needed — Safari handles GLB directly on iOS 13+

Requirements:
- iOS 13+ with Safari
- GLB must be accessible via HTTPS (same-origin or CORS-enabled)
- No DRM/protected assets

### 4. Android Scene Viewer
Google's Scene Viewer AR is launched via a custom intent URL.

How `scene-viewer.js` works:
- Constructs an intent URL: `intent://arvr.google.com/scene-viewer/1.0?...`
- Includes the model URL, title, and link parameters
- Chrome on Android intercepts and launches Scene Viewer
- Falls back to a web page if Scene Viewer not installed

Parameters passed to Scene Viewer:
- `file` — GLB URL (HTTPS required)
- `title` — displayed in the AR viewer
- `link` — "View in browser" link

Requirements:
- Android 7.0+ with Google Play Services
- Google Chrome (or Chrome-based browser)
- GLB served over HTTPS with CORS

### 5. WebXR
WebXR is the web standard for immersive AR/VR. The `webxr.js` module manages an `immersive-ar` session:

How it works:
1. Check `navigator.xr.isSessionSupported('immersive-ar')`
2. Request session with `hit-test` feature (for surface detection)
3. Start the render loop in AR mode
4. Three.js renders overlaid on the camera feed
5. Hit-test results used to place the model on real surfaces
6. Tap to place / drag to move

Requirements:
- Chrome on Android 8.0+ with ARCore
- Safari on iOS 15.4+ with WebXR AR module
- HTTPS required

### 6. Limitations
- AR requires HTTPS — won't work on `http://localhost` (use ngrok or similar for local dev)
- QuickLook doesn't support animations (static pose only)
- Scene Viewer supports animations
- WebXR supports full interactivity (animations, agent conversation)
- Large models (>20MB) may take time to load into AR viewers
- Some GLB features (Draco compression) may need decompression before AR transfer

### 7. Testing AR locally
```bash
# Use ngrok to get an HTTPS tunnel to localhost
ngrok http 5173
# Then open the ngrok URL on your mobile device
```

Or deploy to Vercel/Netlify for instant HTTPS.

### 8. AR button behavior
The AR button only appears when:
- The `ar` attribute is set on `<agent-3d>`
- The current device/browser supports at least one AR method
- The model has loaded successfully

On desktop, the button is hidden (no AR support).

### 9. Programmatic AR trigger
```js
const el = document.querySelector('agent-3d');
// Check if AR is available
if (el.canActivateAR) {
  await el.activateAR();
}
```

## Tone
Concise. Developers want to know what works where and what the gotchas are. Keep the code examples minimal and focused.

## Files to read for accuracy
- `/src/ar/quick-look.js`
- `/src/ar/scene-viewer.js`
- `/src/ar/webxr.js`
- `/src/element.js` — `ar` attribute handling
