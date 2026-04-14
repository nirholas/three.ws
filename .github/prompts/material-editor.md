---
mode: agent
description: "Build a live material editor with PBR parameter tweaking and GLB export"
---

# Material Editor

## Context

The README roadmap lists **"Material Editor — tweak PBR params (roughness, metalness, colors) live in the viewport"** as a planned feature. The viewer currently renders materials read-only. This is the most impactful editor feature for a 3D model tool.

## Dependencies

Install `@gltf-transform/core` and `@gltf-transform/extensions` for GLB re-serialization:

```bash
npm install @gltf-transform/core @gltf-transform/extensions
```

These libraries let you read a GLB, modify material properties programmatically, and write it back to a valid GLB — enabling "edit and export" workflows.

## Implementation

### 1. Material Inspector Panel (`src/material-editor.js`)

Create a new module that:
- Traverses the loaded `content` (Three.js scene graph) to find all `MeshStandardMaterial` / `MeshPhysicalMaterial` instances
- Groups materials by name (deduplicating shared materials)
- For each material, exposes editable PBR properties:

| Property | Type | Control |
|----------|------|---------|
| `color` (baseColor) | Color | dat.gui color picker |
| `metalness` | Float 0-1 | Slider |
| `roughness` | Float 0-1 | Slider |
| `emissive` | Color | Color picker |
| `emissiveIntensity` | Float | Slider |
| `opacity` | Float 0-1 | Slider |
| `transparent` | Boolean | Checkbox |
| `alphaTest` | Float 0-1 | Slider |
| `side` | Enum | Dropdown (Front/Back/Double) |
| `flatShading` | Boolean | Checkbox |
| `wireframe` | Boolean | Checkbox |
| `envMapIntensity` | Float | Slider |
| `normalScale` | Vector2 | Two sliders |
| `aoMapIntensity` | Float 0-1 | Slider |

### 2. Texture Viewer

For each material, show thumbnail previews of assigned textures:
- `map` (baseColor texture)
- `normalMap`
- `roughnessMap` / `metalnessMap`
- `aoMap`
- `emissiveMap`
- `envMap`

Click a texture thumbnail to view it full-size in a lightbox.

### 3. Live Preview

All material property changes apply immediately to the Three.js material via `material.needsUpdate = true`. The viewport reflects changes in real-time.

### 4. GLB Export with Edits

Using glTF-Transform:
1. Read the original GLB bytes
2. Apply material property changes to the glTF-Transform document
3. Write modified GLB
4. Trigger browser download of the edited file

```js
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

async function exportEditedGLB(originalBuffer, materialEdits) {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.readBinary(new Uint8Array(originalBuffer));

    for (const [materialName, edits] of Object.entries(materialEdits)) {
        const mat = doc.getRoot().listMaterials()
            .find(m => m.getName() === materialName);
        if (!mat) continue;

        if (edits.baseColor) mat.setBaseColorFactor(edits.baseColor);
        if (edits.metalness !== undefined) mat.setMetallicFactor(edits.metalness);
        if (edits.roughness !== undefined) mat.setRoughnessFactor(edits.roughness);
        if (edits.emissive) mat.setEmissiveFactor(edits.emissive);
        // ... etc
    }

    return io.writeBinary(doc);
}
```

### 5. Integration with Viewer

- Add a "Materials" folder to the dat.gui panel in `src/viewer.js`
- When a model loads, populate subfolders per material
- Add an "Export GLB" button that saves the modified model
- Store original GLB buffer reference for export

### 6. UI Design

- Material list as collapsible sections in dat.gui or a separate side panel
- Color swatches for baseColor/emissive
- Texture thumbnails in a grid below each material section
- "Reset" button per material to revert to original values
- "Export Modified GLB" button at the top

## File Structure

```
src/
├── material-editor.js    # Material inspector & editor logic
├── glb-export.js         # glTF-Transform export pipeline
```

## Validation

- Load DamagedHelmet.glb → material panel shows all PBR properties
- Change roughness slider → viewport updates in real-time
- Export modified GLB → re-import → changes are persisted
- Works with multi-material models (FlightHelmet, etc.)
- Original file is never mutated
