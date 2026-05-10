# glb-viewer

Load, display, and control any glTF/GLB 3D model in the [three.ws](https://three.ws) viewer. Covers scene settings, animation playback, camera control, environment presets (10 built-in), screenshot export, and AR. The same viewer powers every `<agent-3d>` embed.

| Property      | Value                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| name          | glb-viewer                                                                                    |
| description   | Load and control glTF/GLB 3D models — scene, animations, environment, camera, screenshot, AR  |
| allowed-tools | Read, Edit, Write                                                                             |

## Install

```
openclaw skills install glb-viewer
```

Or via direct URL:

```
Install the skill https://raw.githubusercontent.com/nirholas/3D-Agent/main/clawhub-skills/glb-viewer/SKILL.md
```

## Quick start

```js
import { Viewer } from 'https://cdn.three.ws/viewer.js';

const viewer = new Viewer(document.getElementById('viewer'));
await viewer.load('https://example.com/model.glb');

viewer.state.autoRotate = true;
viewer.state.environment = 'city';
viewer.state.exposure = 1.2;
viewer.invalidate();
```

## Core workflow

```
1. Instantiate       →  new Viewer(containerEl, opts)
2. Load model        →  await viewer.load(url)
3. Configure scene   →  viewer.state.* = ...  + viewer.invalidate()
4. Control camera    →  viewer.frameContent() / viewer.setCamera()
5. Play animations   →  viewer.onGesture() / viewer.playAllClips()
6. Export            →  viewer.captureScreenshot() / viewer.setARTarget()
```

## Loading models

```js
// HTTPS
await viewer.load('https://example.com/character.glb');

// IPFS (resolved automatically)
await viewer.load('ipfs://Qm.../character.glb');

// Relative path
await viewer.load('./models/character.glb');
```

Supports: GLB, GLTF, VRM. Draco compression handled automatically.

## Scene state reference

All persistent settings live in `viewer.state`. Mutate and call `viewer.invalidate()` to apply.

| Property           | Type    | Default     | Description                          |
| ------------------ | ------- | ----------- | ------------------------------------ |
| `environment`      | string  | `neutral`   | Environment preset name or HDRI URL  |
| `background`       | boolean | false       | Show environment as visible skybox   |
| `autoRotate`       | boolean | false       | Slow Y-axis rotation                 |
| `exposure`         | number  | 1.0         | Tone-map exposure                    |
| `playbackSpeed`    | number  | 1.0         | Animation speed multiplier           |
| `wireframe`        | boolean | false       | Wireframe overlay                    |
| `skeleton`         | boolean | false       | Show bone skeleton                   |
| `grid`             | boolean | false       | Show ground grid                     |
| `bgColor`          | string  | transparent | Canvas clear colour                  |
| `transparentBg`    | boolean | false       | Transparent canvas                   |
| `ambientIntensity` | number  | 0.5         | Ambient light strength               |
| `directIntensity`  | number  | 0.8         | Directional light strength           |
| `toneMapping`      | string  | `Linear`    | `Linear` or `ACES Filmic`            |

## Environment presets

```
neutral    city    dawn    forest    lobby
night      park    studio  sunset    warehouse
```

```js
viewer.state.environment = 'sunset';
viewer.state.background  = true;   // show env as skybox, not just IBL
viewer.invalidate();
```

Custom HDRI:

```js
viewer.state.environment = 'https://cdn.polyhaven.com/.../env.exr';
viewer.updateEnvironment();
```

## Animation

```js
viewer.clips          // AnimationClip[] from the loaded GLB
viewer.mixer          // three.AnimationMixer

// Play by gesture name
await viewer.onGesture({ name: 'wave', duration: 1.5 });

// Play all clips
viewer.playAllClips();

// Toggle play/pause
viewer.toggleAnimationPlayback();

// Slow motion / fast forward
viewer.state.playbackSpeed = 0.5;
viewer.state.playbackSpeed = 2.0;

// Play a specific clip manually
const clip = viewer.clips.find((c) => c.name === 'Run');
viewer.mixer.clipAction(clip).reset().play();
```

## Camera

```js
// Auto-fit model to view (smooth animation)
await viewer.frameContent({ animate: true, durationMs: 800 });

// Switch to a named camera from the GLB
viewer.setCamera('Camera.Action');

// Lock look-at to a bone
viewer.setCameraTarget('Head');

// Get head bone screen position (for UI overlays)
const { x, y } = viewer.getHeadScreenPosition();

// Orbit controls
viewer.controls.minDistance = 1;
viewer.controls.maxDistance = 10;
viewer.controls.autoRotate  = true;
```

## Screenshot and export

```js
viewer.takeScreenshot();     // copies rendered frame to clipboard
viewer.captureScreenshot();  // downloads as PNG
```

## AR

```js
// Provide GLB + optional USDZ for iOS Quick Look
viewer.setARTarget('character.glb', 'character.usdz');
```

AR launches WebXR on Android, Scene Viewer as fallback, and Quick Look on iOS. Requires the `ar` attribute on `<agent-3d>` or a manual AR session.

## Scene graph

```js
viewer.scene      // three.Scene — root
viewer.content    // three.Object3D — loaded model
viewer.renderer   // three.WebGLRenderer
viewer.defaultCamera  // three.PerspectiveCamera

// Traverse all meshes
viewer.content.traverse((node) => {
  if (node.isMesh) console.log(node.name);
});
```

## Responsive layout

```js
// Recalculate canvas size whenever the container changes
const ro = new ResizeObserver(() => viewer.resize());
ro.observe(containerEl);
```

## State persistence

Tie viewer settings to an agent ID so they survive page reload:

```js
viewer.attachScenePrefs('a_abc123');   // load from + auto-save to localStorage
viewer.notifyScenePrefChange();         // call after manual state changes
```

## Common patterns

### Auto-rotating showcase

```js
const viewer = new Viewer(el, { kiosk: true });
await viewer.load(glbUrl);
viewer.state.autoRotate  = true;
viewer.state.environment = 'studio';
viewer.state.exposure    = 1.4;
viewer.state.transparentBg = true;
await viewer.frameContent({ animate: false });
viewer.invalidate();
```

### Debug mode

```js
viewer.state.wireframe = true;
viewer.state.skeleton  = true;
viewer.state.grid      = true;
viewer.updateDisplay();
```

### Warm cinematic look

```js
viewer.state.environment      = 'sunset';
viewer.state.toneMapping      = 'ACES Filmic';
viewer.state.exposure         = 0.9;
viewer.state.ambientIntensity = 0.3;
viewer.state.directIntensity  = 1.8;
viewer.state.directColor      = '#fff4cc';
viewer.updateLights();
viewer.invalidate();
```

### Night scene

```js
viewer.state.environment      = 'night';
viewer.state.bgColor          = '#000011';
viewer.state.ambientIntensity = 0.1;
viewer.state.directIntensity  = 0.4;
viewer.updateLights();
viewer.invalidate();
```

## Source

Viewer: [`src/viewer.js`](https://github.com/nirholas/3D-Agent/blob/main/src/viewer.js)

Embed spec: [`specs/EMBED_SPEC.md`](https://github.com/nirholas/3D-Agent/blob/main/specs/EMBED_SPEC.md)
