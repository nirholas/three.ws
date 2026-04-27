# Agent Task: Write "3D Viewer" Documentation

## Output file
`public/docs/viewer.md`

## Target audience
Developers using the viewer component directly — loading models, controlling animations, inspecting materials, taking screenshots. Also useful for understanding the viewer layer before diving into the agent layer.

## Word count
1500–2500 words

## What this document must cover

### 1. Overview
The viewer is the rendering layer of three.ws — a full-featured three.js WebGL scene manager. Key capabilities:
- Load glTF 2.0 and GLB files (including Draco-compressed meshes and KTX2 textures)
- Interactive orbit camera (drag to rotate, scroll to zoom, right-click to pan)
- Full animation playback with speed control
- HDR environment maps for realistic lighting
- Material and texture inspection
- Morph target (blend shape) control
- Bone/skeleton visualization
- Screenshot capture
- Stats panel (FPS, memory)
- Wireframe and axes helpers

### 2. Loading a model
Explain the `model` attribute on `<agent-3d>` or the `loadGLB()` method:
- Accepts HTTPS URLs, blob URLs, data URIs
- Draco decoder auto-loaded when compressed meshes detected
- KTX2 decoder auto-loaded when compressed textures detected
- Progress events fired (`load-start`, `load-end`)

Show example:
```html
<agent-3d model="https://example.com/avatar.glb"></agent-3d>
```

And programmatic loading:
```js
const el = document.querySelector('agent-3d');
await el.loadGLB('https://example.com/new-model.glb');
```

### 3. Camera and navigation
- **Orbit** — left mouse drag / one-finger touch
- **Pan** — right mouse drag / two-finger touch
- **Zoom** — scroll wheel / pinch
- **Reset** — double-click on model
- Camera position can be set via URL hash: `#cameraPosition=0,1,2`
- Presets via `#preset=<name>`

### 4. Animation playback
Describe the animation controls panel:
- Lists all animation clips in the loaded GLB
- Play/pause per clip
- Play All — sequences all clips
- Speed slider (0.1x to 3x)
- Loop toggle

Programmatic control via the SceneController bridge (when using agent):
```js
// Agent tool: play_clip
await agent.playClipByName('wave');
```

Explain the AnimationMixer and how clips blend.

### 5. Environment and lighting
Three built-in HDR environments:
- **Venice Sunset** — warm golden hour
- **Footprint Court** — neutral studio
- **Neutral Room** — soft indoor

Controls (via GUI panel):
- Environment intensity slider
- Show/hide environment background
- Ambient light intensity
- Directional light intensity and direction

### 6. Material and texture inspection
The dat.gui panel lets you inspect:
- Per-mesh material properties (metalness, roughness, color)
- Texture maps (baseColor, normal, metalness, roughness, emissive, occlusion)
- Transparency, double-sided, wireframe mode

Note: inspection is read-only in viewer mode; editing requires the Editor.

### 7. Morph targets (blend shapes)
If the GLB includes morph targets:
- Each morph target gets a slider in the GUI panel (0.0–1.0)
- Agent avatar uses morph targets for facial expressions (smile, frown, brow raise, etc.)
- Useful for: facial animation preview, custom expression testing

Show the morph targets the emotion system drives:
- mouthSmile, mouthFrown, mouthOpen, cheekPuff
- browInnerUp, browOuterUp, noseSneer
- eyeSquint, eyesClosed

### 8. Skeleton visualization
- Toggle bone overlay in the GUI panel
- Shows the armature/skeleton as colored lines
- Useful for debugging animation rigs
- Head/Neck bones are auto-detected by the avatar emotion system for head tilt/lean

### 9. Screenshots
```js
const dataUrl = viewer.screenshot();
// returns a PNG as a data URL
```
Or via the UI — screenshot button in the viewer toolbar saves PNG to downloads.

### 10. Stats panel
Toggle the stats overlay (FPS / render time / memory):
- Press `S` or toggle in GUI
- Three panels: FPS, MS per frame, MB allocated
- Useful for performance profiling large scenes

### 11. URL hash routing
Deep-link to specific viewer states:
- `#model=<url>` — auto-load this GLB on page load
- `#preset=<name>` — apply environment preset
- `#cameraPosition=x,y,z` — set camera position
- `#register` — open registration modal immediately

### 12. Supported file formats
| Format | Support |
|--------|---------|
| GLB (binary glTF 2.0) | Full |
| glTF 2.0 (JSON) | Full |
| Draco compressed meshes | Full (auto-decode) |
| KTX2 compressed textures | Full (auto-decode) |
| glTF 1.0 | Not supported |
| FBX | Convert to GLB first (see scripts/convert-fbx-to-glb.py) |
| OBJ | Not supported directly |

### 13. Performance tips
- Use Draco compression for meshes (reduces file size 5–10x)
- Use KTX2 for textures (GPU-native, no CPU decompression)
- Keep polygon count under 100k for smooth mobile performance
- Use LOD if targeting mobile WebXR
- Disable stats panel in production embeds

## Tone
Reference-style documentation with clear examples. Developers will use this to understand what the viewer can and cannot do. Be specific about what's in the GUI vs what's programmatic.

## Files to read for accuracy
- `/src/viewer.js` — main viewer class (1414 lines)
- `/src/viewer/animation.js` — clip playback
- `/src/viewer/environment.js` — HDR maps
- `/src/viewer/lights.js` — lighting
- `/src/viewer/screenshot.js` — capture
- `/src/viewer/internal.js` — presets, decoders
- `/src/runtime/scene.js` — SceneController (agent bridge)
- `/src/element.js` — web component attributes
