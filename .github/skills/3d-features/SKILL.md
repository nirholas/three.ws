---
name: 3d-features
description: 'Add or modify Three.js 3D features in the viewer. Use when: adding rendering features, new GUI controls, camera behavior, loaders, post-processing, environment maps, animation features, display toggles, materials, or extending the Viewer class.'
argument-hint: 'Describe the 3D feature to add or change'
---

# 3D Feature Development

## When to Use

- Adding new rendering capabilities (post-processing, shadows, new material types)
- Adding or modifying dat.gui control panels
- Changing camera behavior or adding camera modes
- Adding new loaders or asset format support
- Modifying lighting, environment maps, or tone mapping
- Adding display toggles (wireframe, skeleton, grid, etc.)
- Animation playback features or morph target controls

## Key File: `src/viewer.js`

The `Viewer` class manages all Three.js rendering. Key sections:

### State Object

All GUI-controllable state lives in `this.state` (defined in constructor). To add a new toggle:

1. Add default value to `this.state`
2. Add GUI control in the appropriate `addGUI()` subfolder
3. Add the handler method on the `Viewer` class

### GUI Folders

dat.gui controls are organized into folders created in `addGUI()`:

- **Lights** — Ambient/directional intensity, punctual lights, exposure, tone mapping
- **Display** — Wireframe, skeleton, grid, axes, auto-rotate, background
- **Animation** — Playback speed, individual clip controls, morph targets
- **Cameras** — Default + scene cameras

### Loaders

| Loader           | Purpose              | CDN Path                          |
| ---------------- | -------------------- | --------------------------------- |
| `GLTFLoader`     | glTF/GLB models      | Built-in Three.js                 |
| `DRACOLoader`    | Compressed geometry  | `unpkg.com/three@.../draco/gltf/` |
| `KTX2Loader`     | Basis textures       | `unpkg.com/three@.../basis/`      |
| `MeshoptDecoder` | Meshopt geometry     | Built-in Three.js                 |
| `EXRLoader`      | HDR environment maps | Built-in Three.js                 |

### Environment Maps

Defined in `src/environments.js` as an array of `{ id, name, path, format }` objects. To add a new environment:

1. Add entry to the array in `environments.js`
2. The viewer auto-discovers it via the `environments` import

## Procedure

1. Identify which section of `src/viewer.js` to modify
2. For new GUI controls: add state → add GUI control → add handler
3. For new loaders: import from `three/addons/`, configure in constructor
4. For new environments: add to `src/environments.js`
5. Test with `npm run dev` at `http://localhost:3000`
6. Test with various glTF models (drag-and-drop or `?model=` param)

## Three.js Patterns Used

- `PMREMGenerator` for environment map preprocessing
- `AnimationMixer` for animation playback with `clipAction()`
- `OrbitControls` for camera interaction
- `Box3` for model bounding box / auto-framing
- `traverse()` for material/mesh iteration
- `LoadingManager` for coordinated asset loading
