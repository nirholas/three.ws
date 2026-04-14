---
mode: agent
description: "Build texture inspector with channel separation and full-size preview"
---

# Texture Inspector

## Context

The README roadmap lists **"Texture Inspector — view individual texture channels (baseColor, normal, metallic-roughness, AO, emissive)"**. This complements the Material Editor by letting users visually inspect every texture in the model.

## Implementation

### 1. Texture Catalog (`src/texture-inspector.js`)

After a model loads, traverse all materials and collect every unique texture:

| Slot | Three.js Property | glTF Channel |
|------|-------------------|--------------|
| Base Color | `material.map` | baseColorTexture |
| Normal | `material.normalMap` | normalTexture |
| Metallic-Roughness | `material.metalnessMap` / `material.roughnessMap` | metallicRoughnessTexture |
| Occlusion | `material.aoMap` | occlusionTexture |
| Emissive | `material.emissiveMap` | emissiveTexture |
| Alpha | (from `material.map` alpha channel) | — |

### 2. Channel Separation

For packed textures (metallic-roughness is R+G channels in one image):
- Extract individual channels using a canvas 2D context
- Display each channel as a separate grayscale image:
  - **R** = Occlusion (if packed)
  - **G** = Roughness
  - **B** = Metallic

Use `getImageData()` and pixel manipulation to isolate channels.

### 3. Texture Info Display

For each texture, show:
- Resolution (width × height)
- Format (PNG/JPEG/KTX2/Basis)
- Memory estimate (width × height × 4 bytes for RGBA, accounting for mipmaps)
- UV channel index
- Wrap mode (repeat/clamp/mirror)
- Min/mag filter
- Which materials reference this texture

### 4. Full-Size Preview

- Click any texture thumbnail → opens a lightbox/modal with the full-resolution image
- Zoom/pan controls in the lightbox
- Channel toggle buttons (R/G/B/A) to view individual channels
- Optional checkerboard background to see alpha transparency

### 5. UV Visualization

- Render UV wireframe overlay on the texture in the lightbox
- Uses the mesh's UV coordinates drawn as lines on a canvas
- Helps identify UV islands, overlap, and wasted texture space

### 6. Integration

- Add "Textures" folder to dat.gui in `src/viewer.js`
- Or integrate as a tab in the Scene Explorer side panel
- Keyboard shortcut (X) to toggle texture inspector panel

## File Structure

```
src/
├── texture-inspector.js  # Texture catalog, channel extraction, UV overlay
```

## Validation

- Load DamagedHelmet.glb → shows all 5 texture slots with thumbnails
- Metallic-roughness texture shows separated R/G/B channels
- Click thumbnail → full-size lightbox with zoom
- Memory estimates are reasonable (match GPU inspector tools)
- Works with KTX2/Basis textures (after decode)
