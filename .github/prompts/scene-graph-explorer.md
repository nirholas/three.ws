---
mode: agent
description: "Build a visual scene graph explorer with node inspection and transform controls"
---

# Scene Graph Explorer

## Context

The README roadmap lists **"Scene Graph Explorer — visual tree of all nodes, meshes, materials, and their properties"**. Currently the viewer provides model info stats (vertex/triangle counts) but no way to inspect or navigate the scene hierarchy.

## Implementation

### 1. Scene Tree Panel (`src/scene-explorer.js`)

Build a collapsible tree view that mirrors the Three.js scene graph:

```
▸ Scene
  ▸ DamagedHelmet (Mesh)
    ▸ Material_MR (MeshStandardMaterial)
    ▸ BufferGeometry (14556 verts)
  ▸ DirectionalLight
  ▸ AmbientLight
```

Each tree node shows:
- **Name** (or type if unnamed)
- **Icon** by type: 📦 Mesh, 💡 Light, 📷 Camera, 🦴 Bone, 🎯 Empty/Group
- **Visibility toggle** (eye icon) — sets `object.visible`
- **Expand/collapse** for children

### 2. Node Inspector

When a node is selected in the tree, show a properties panel:

**For all nodes:**
- Name (editable)
- Position (x, y, z)
- Rotation (x, y, z in degrees)
- Scale (x, y, z)
- Visible (checkbox)
- Matrix (read-only, 4x4)

**For Meshes:**
- Geometry stats: vertices, triangles, indexed, attributes list
- Material reference (click to jump to Material Editor)
- Bounding box dimensions
- Morph targets list

**For Lights:**
- Type, color, intensity
- Shadow settings

**For Cameras:**
- FOV, near, far, aspect

**For Bones/SkinnedMesh:**
- Joint index, skin reference
- Inverse bind matrix

### 3. Viewport Interaction

- **Click-to-select**: Raycasting from mouse position to select meshes in the viewport. Highlights the selected mesh with an outline or wireframe overlay. Syncs selection with the tree panel.
- **Transform Gizmo**: Use Three.js `TransformControls` for translate/rotate/scale. Toggle mode with keyboard shortcuts (W/E/R or G/R/S).
- **Focus/Frame**: Double-click a tree node to orbit the camera to frame that object.

### 4. Search & Filter

- Search box at top of tree to filter by node name
- Filter buttons: Show only Meshes / Lights / Cameras / All
- Highlight matching nodes in the tree

### 5. UI Layout

The scene explorer should be a **resizable side panel** (left or right side):
- Tree view takes most of the vertical space
- Properties panel below the tree (or tabbed)
- Panel can be toggled with keyboard shortcut (T) or GUI button
- Panel width is draggable

Use plain DOM (no framework) to match the existing codebase style. CSS in `style.css`.

### 6. Integration

In `src/viewer.js`:
- After model load (`setContent`), call `sceneExplorer.buildTree(this.content)`
- Wire click-to-select raycasting in the render loop
- Add `TransformControls` from `three/addons/controls/TransformControls.js`
- Add GUI toggle in Display folder: "scene explorer"

### 7. Export Transform Changes

If the user moves/rotates/scales objects:
- Track which nodes were modified
- On GLB export (via `glb-export.js` from Material Editor), apply transform changes to the glTF-Transform document
- Serialize updated transforms into the exported file

## File Structure

```
src/
├── scene-explorer.js     # Tree view, node inspector, selection
├── transform-controls.js # Gizmo wrapper & keyboard shortcuts
```

## Validation

- Load FlightHelmet.gltf → tree shows full hierarchy with correct nesting
- Click a mesh in the tree → highlights in viewport, shows properties
- Click a mesh in the viewport → selects in tree
- Drag transform gizmo → node moves, tree properties update
- Toggle visibility → mesh disappears in viewport
- Search "helmet" → filters tree to matching nodes
- Works with animated models (Fox.glb) — bones visible in tree
