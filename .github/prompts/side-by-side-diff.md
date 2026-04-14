---
mode: agent
description: "Add side-by-side model diff for comparing two versions of the same model"
---

# Side-by-Side Model Diff

## Context

The README roadmap lists **"Side-by-Side Diff — compare two versions of the same model"**. Critical for workflows where models are iterated (e.g., optimization passes, LOD comparison, before/after edits).

## Implementation

### 1. Dual Viewport (`src/model-diff.js`)

Split the viewer into two synchronized viewports:
- Left: Model A (original / before)
- Right: Model B (modified / after)
- Both viewports share camera controls (orbit synced)
- Divider bar is draggable for reveal/wipe comparison

### 2. Loading Two Models

Entry points:
- **Drag-and-drop**: Drop model A, then use "Compare With..." button → file picker for model B
- **URL params**: `#model=A.glb&compare=B.glb`
- **From avatar gallery**: Select two avatars to compare

### 3. Comparison Modes

| Mode | Description |
|------|-------------|
| **Side by Side** | Two viewports, synced camera |
| **Overlay** | Both models rendered in same viewport, toggle A/B with slider |
| **Onion Skin** | Model B overlaid with adjustable opacity |
| **Wireframe Diff** | Show wireframe of both, highlight geometry differences |
| **Stats Diff** | Table comparing vertex count, triangle count, file size, materials, textures |

### 4. Stats Comparison Table

```
Property          | Model A      | Model B      | Delta
─────────────────┼──────────────┼──────────────┼──────────
Vertices          | 14,556       | 8,234        | -43%
Triangles         | 46,356       | 27,896       | -40%
Materials         | 1            | 1            | 0
Textures          | 5            | 5            | 0
File Size         | 3.7 MB       | 1.2 MB       | -68%
Extensions        | 2            | 3            | +1
Animations        | 0            | 0            | 0
```

### 5. Visual Diff Highlights

- If geometry differs: overlay wireframe showing added/removed triangles
- If materials differ: list changed properties
- If textures differ: show texture thumbnails side by side
- Color-code: green = smaller/better, red = larger/worse

### 6. Synchronized Controls

Both viewports share:
- Camera position, rotation, zoom (OrbitControls synced)
- Environment map selection
- Animation playback (if both have animations)
- Display settings (wireframe, skeleton, grid)

### 7. GUI Integration

Add "Compare" mode:
- "Compare With..." button in header
- "Exit Comparison" button to return to single viewport
- Comparison mode dropdown (side-by-side, overlay, onion skin)
- Stats diff panel toggle

## File Structure

```
src/
├── model-diff.js   # Dual viewport, synced controls, comparison logic
├── diff-stats.js   # Statistical comparison, delta calculation
```

## Validation

- Load two models → split viewport shows both
- Orbit one viewport → other follows exactly
- Stats table shows correct deltas with percentage changes
- Overlay mode blends both models with slider
- Works with different-sized models (auto-scales to fit)
