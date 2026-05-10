---
name: glb-viewer
description: Load, display, and control glTF/GLB 3D models in the three.ws viewer — scene settings, animation playback, camera control, environment presets, screenshot export, and AR.
allowed-tools: Read, Edit, Write
---

# glb-viewer

The three.ws `Viewer` class renders any glTF/GLB model with Three.js. It handles IPFS URIs, Draco compression, Mixamo animation retargeting, post-processing (bloom + vignette), and AR export. The same viewer powers every `<agent-3d>` embed.

## Basic usage

```js
import { Viewer } from 'https://cdn.three.ws/viewer.js';

const container = document.getElementById('viewer');
const viewer = new Viewer(container, { kiosk: false });

await viewer.load('https://example.com/model.glb');
```

## Constructor options

```js
new Viewer(el, {
  preset: 'default',          // initial scene preset
  kiosk: false,               // hides GUI panels
  cameraPosition: [0, 1, 3],  // optional initial camera [x, y, z]
  maxPixelRatio: 2,            // caps device pixel ratio (performance)
})
```

## Loading

### From URL

```js
await viewer.load('https://example.com/model.glb');
await viewer.load('ipfs://Qm.../model.glb');       // IPFS supported
await viewer.load('./local-model.glb');             // relative paths
```

### Setting content directly

```js
// After you've loaded a GLTF yourself (e.g. with GLTFLoader):
viewer.setContent(gltf.scene, gltf.animations);
```

### Clearing

```js
viewer.clear();     // unload model, reset scene
viewer.dispose();   // full cleanup — stops render loop, removes listeners
```

## State object

All persistent settings live in `viewer.state`. Change a value and call `viewer.invalidate()` to re-render.

```js
viewer.state.environment      // string — active environment preset name
viewer.state.background       // boolean — show env as visible background
viewer.state.autoRotate       // boolean — slow Y-axis rotation
viewer.state.exposure         // number  — tone-map exposure (default 1.0)
viewer.state.playbackSpeed    // number  — animation multiplier (default 1.0)
viewer.state.wireframe        // boolean — wireframe overlay
viewer.state.skeleton         // boolean — show bone skeleton
viewer.state.grid             // boolean — show ground grid
viewer.state.bgColor          // CSS color string — canvas clear color
viewer.state.transparentBg    // boolean — transparent canvas
viewer.state.ambientIntensity // number  — ambient light strength
viewer.state.directIntensity  // number  — directional light strength
viewer.state.toneMapping      // 'Linear' | 'ACES Filmic'
```

Example:

```js
viewer.state.autoRotate = true;
viewer.state.environment = 'city';
viewer.state.exposure = 1.3;
viewer.invalidate();  // trigger immediate re-render
```

## Environment presets

Pass any of these strings to `viewer.state.environment`:

```
neutral    city    dawn    forest    lobby
night      park    studio  sunset    warehouse
```

Or pass any HDRI URL for a custom environment:

```js
viewer.state.environment = 'https://cdn.polyhaven.com/asset_img/renders/small_empty_room/small_empty_room.webp';
viewer.updateEnvironment();
```

## Animation

```js
viewer.clips           // AnimationClip[] — all clips in the loaded GLB
viewer.mixer           // three.AnimationMixer — direct access if needed

// Play a named gesture / clip
await viewer.onGesture({ name: 'wave', duration: 1.5 });

// Play all clips in sequence
viewer.playAllClips();

// Toggle play / pause
viewer.toggleAnimationPlayback();

// Change playback speed
viewer.state.playbackSpeed = 0.5;  // slow motion
viewer.state.playbackSpeed = 2.0;  // double speed
```

## Camera

```js
// Switch to a named camera from the GLB
viewer.setCamera('Camera.Action');

// Lock the camera look-at on a bone
viewer.setCameraTarget('Head');

// Auto-fit the model to the viewport
await viewer.frameContent({ animate: true, durationMs: 800 });

// Get the pixel position of the model's head bone (useful for UI anchors)
const { x, y } = viewer.getHeadScreenPosition();
```

`viewer.controls` is an `OrbitControls` instance — you can read or set `.target`, `.minDistance`, `.maxDistance`, etc. directly.

## Scene control methods

```js
viewer.setBackgroundColor('#1a1a2e');  // CSS color or 'transparent'
viewer.updateEnvironment();            // reapply current env setting
viewer.updateLights();                 // recalculate lights
viewer.updateDisplay();                // refresh wireframe / skeleton / grid
viewer.resize();                       // recalculate canvas size after layout change
viewer.render();                       // force a single render frame
viewer.invalidate();                   // schedule next frame
```

## Scene graph

```js
viewer.scene       // three.Scene — root of the scene graph
viewer.content     // three.Object3D — the loaded model
viewer.renderer    // three.WebGLRenderer
viewer.defaultCamera   // three.PerspectiveCamera
viewer.activeCamera    // currently active camera
```

Traverse the model:

```js
viewer.content.traverse((node) => {
  if (node.isMesh) {
    console.log(node.name, node.geometry.attributes.position.count);
  }
});
```

## Screenshot and export

```js
viewer.takeScreenshot();    // copies to clipboard
viewer.captureScreenshot(); // downloads as PNG file
```

## AR export

```js
// Set the GLB + optional USDZ for iOS Quick Look
viewer.setARTarget('model.glb', 'model.usdz');
```

AR launches via WebXR (Android), Scene Viewer (Android fallback), or Quick Look (iOS). Requires the `ar` attribute on the `<agent-3d>` embed or manual AR session setup.

## State persistence

Bind viewer state to an agent ID so settings survive page reload:

```js
viewer.attachScenePrefs('a_abc123');   // loads + saves state to localStorage
viewer.notifyScenePrefChange();         // call after state changes to persist
```

## Post-processing

The viewer runs bloom + vignette by default. Access the effect composer:

```js
viewer._composer   // EffectComposer
viewer._effectPass // EffectPass (bloom + vignette)
```

## Lighting

```js
viewer.lights             // three.Light[] — all scene lights
viewer.pmremGenerator     // PMREMGenerator — IBL generation
viewer.neutralEnvironment // Texture — default neutral env

// Fine-tune via state:
viewer.state.ambientIntensity  = 0.8;
viewer.state.ambientColor      = '#ffffff';
viewer.state.directIntensity   = 1.5;
viewer.state.directColor       = '#fff4e0';
viewer.updateLights();
```

## Common patterns

### Auto-rotate with custom environment

```js
const viewer = new Viewer(el);
await viewer.load(glbUrl);

viewer.state.autoRotate = true;
viewer.state.environment = 'sunset';
viewer.state.exposure = 1.2;
viewer.state.transparentBg = true;
viewer.invalidate();
```

### Responsive resize on container change

```js
const ro = new ResizeObserver(() => viewer.resize());
ro.observe(el);
```

### Model info overlay

```js
// Show triangle count, texture memory, extension list
viewer.state.showInfo = true;
viewer.updateModelInfo(viewer.content, viewer.clips);
```

### Play a specific clip on load

```js
await viewer.load(url);
const clip = viewer.clips.find((c) => c.name === 'Walk');
if (clip) {
  const action = viewer.mixer.clipAction(clip);
  action.reset().play();
}
```

### Wireframe debug mode

```js
viewer.state.wireframe = true;
viewer.updateDisplay();
```
