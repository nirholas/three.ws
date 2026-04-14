---
mode: agent
description: "Add measurement tools for distances, angles, and bounding box dimensions"
---

# Measurement Tools

## Context

The README roadmap lists **"Measurement Tools — click two points to measure distances, angles, bounding boxes"**. Essential for any professional 3D tool.

## Implementation

### 1. Point-to-Point Distance (`src/measurements.js`)

- **Activate measurement mode** via GUI button or keyboard shortcut (M)
- User clicks two points on model surface (raycasting to mesh)
- Draw a line between the two points with a label showing distance
- Distance in model units (meters for glTF)
- Support for snapping to vertices

### 2. Angle Measurement

- Click three points: A, B, C
- Measure angle at vertex B (angle ABC)
- Display arc visualization with degree label
- Useful for checking joint angles, surface normals

### 3. Bounding Box Dimensions

- Toggle bounding box overlay per mesh or entire model
- Show dimensions (width × height × depth) in model units
- Display center point coordinates
- Show total model extents

### 4. Cross-Section / Clipping Plane

- Draggable clipping plane that slices through the model
- Shows cross-section outline
- Plane normal and position are adjustable
- Useful for inspecting internal geometry

### 5. Surface Area & Volume

- Calculate and display:
  - Total surface area (sum of triangle areas)
  - Estimated volume (for closed meshes)
  - Per-mesh surface area

### 6. Measurement Display

- Measurements rendered as Three.js sprites (always face camera)
- Measurement list panel showing all active measurements
- Delete individual measurements or "Clear All"
- Units toggle: meters, centimeters, millimeters, inches, feet

### 7. GUI Integration

Add "Measure" folder to dat.gui:
```
▸ Measure
  Mode          (dropdown: Off, Distance, Angle, BBox)
  Units         (dropdown: m, cm, mm, in, ft)
  Snap to Vertex (checkbox)
  Show BBox      (checkbox)
  Clipping Plane (checkbox)
  Clear All      (button)
```

## File Structure

```
src/
├── measurements.js  # Raycasting, distance/angle calc, display, clipping
```

## Validation

- Click two points on DamagedHelmet → shows distance in meters
- Click three points → shows angle in degrees
- Toggle bounding box → shows correct dimensions
- Clipping plane reveals internal geometry
- Units switch correctly converts displayed values
