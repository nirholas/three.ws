---
mode: agent
description: "Add multi-format import support for FBX, OBJ, and USDZ files"
---

# File Format Expansion

## Context

The README roadmap lists **"File Format Expansion — .fbx, .obj, .usdz import support"**. Currently only glTF/GLB is supported. Adding more formats makes the viewer useful for a wider audience.

## Implementation

### 1. FBX Import

Three.js has `FBXLoader` built-in:

```js
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
```

- Detect `.fbx` files by extension
- Load with `FBXLoader`
- Apply the same scene setup (center, scale, lighting) as glTF
- FBX animations → `AnimationMixer` (same as glTF)
- Note: FBX textures may be embedded or reference external files

### 2. OBJ Import

Three.js has `OBJLoader` and `MTLLoader`:

```js
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
```

- Detect `.obj` files by extension
- If `.mtl` file is present (drag-and-drop with companion files), load materials first
- Apply materials to OBJ geometry
- Center and scale the model

### 3. USDZ Import

More complex — Three.js has `USDZLoader` (experimental):

```js
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
```

- Detect `.usdz` / `.usda` / `.usdc` files
- Load with `USDZLoader`
- Note: USDZ support in Three.js is limited — document known limitations

### 4. STL Import

Common for 3D printing:

```js
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
```

- Returns `BufferGeometry` only (no materials/textures)
- Apply default material (MeshStandardMaterial, neutral gray)
- Useful for engineering/3D printing workflows

### 5. PLY Import

Common for photogrammetry and point clouds:

```js
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
```

- May contain vertex colors
- Support both mesh and point cloud rendering

### 6. Format Detection

In `src/app.js`, detect file format by extension:

```js
function getLoader(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
        case 'gltf': case 'glb': return 'gltf';
        case 'fbx': return 'fbx';
        case 'obj': return 'obj';
        case 'usdz': case 'usda': case 'usdc': return 'usdz';
        case 'stl': return 'stl';
        case 'ply': return 'ply';
        default: return 'gltf'; // fallback
    }
}
```

### 7. Validation Behavior

- glTF validation only runs for `.gltf` / `.glb` files
- For other formats, show "Validation not available for {format}" in the validation panel
- Model info overlay still works (vertex/triangle counts from Three.js geometry)

### 8. Drag-and-Drop Updates

Update `SimpleDropzone` in `src/app.js` to accept new extensions:
- `.fbx`, `.obj`, `.mtl`, `.usdz`, `.usda`, `.usdc`, `.stl`, `.ply`
- Handle companion files (`.mtl` with `.obj`, texture files with `.fbx`)

## File Structure

```
src/
├── loaders.js  # Format detection, loader registry, format-specific setup
```

## Validation

- Drag-and-drop an FBX file → loads and renders correctly
- Drag-and-drop OBJ + MTL → materials applied
- UI correctly shows "Validation not available" for non-glTF formats
- Animations work for FBX files with animation data
- File picker accepts all supported extensions
