---
name: 3d-viewer
description: "Full project workflow for the 3D Agent viewer app. Use when: developing features, debugging rendering, modifying UI, understanding architecture, running dev server, or making any code changes to this glTF/GLB viewer project."
argument-hint: "Describe what you want to do with the 3D viewer app"
---

# 3D Agent — Project Workflow

## Overview

3D Agent is a browser-based glTF 2.0 / GLB viewer built with Three.js. Users drag-and-drop 3D model files to preview them with interactive controls for lighting, animation, and display. Deployed at [3dagent.vercel.app](https://3dagent.vercel.app/).

## Architecture

```
index.html          → Entry point, loads app.js
src/app.js          → App class: dropzone, file loading, URL params, orchestrates Viewer + Validator
src/viewer.js       → Viewer class: Three.js scene, camera, lighting, dat.gui controls, animation
src/validator.js    → Validator class: gltf-validator integration, report rendering
src/environments.js → HDR/EXR environment map presets
src/components/     → JSX components (vhtml): footer, validator-toggle, validator-report, validator-table
style.css           → Global styles + dat.gui dark theme overrides
public/avatars/     → Default 3D model assets
```

## Key Classes

| Class | File | Responsibility |
|-------|------|----------------|
| `App` | `src/app.js` | File drop handling, URL param parsing, error UI, lifecycle |
| `Viewer` | `src/viewer.js` | Three.js scene setup, model loading, GUI panels, animation playback |
| `Validator` | `src/validator.js` | glTF validation, report generation, lightbox display |

## Tech Stack

- **Three.js** v0.176 — WebGL rendering, GLTFLoader, DRACOLoader, KTX2Loader, OrbitControls
- **dat.gui** — Interactive control panels
- **simple-dropzone** — Drag-and-drop file input
- **vhtml** — JSX-like component rendering
- **gltf-validator** — KhronosGroup glTF 2.0 validation
- **Vite** — Dev server and build tool
- **Vercel** — Deployment

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server on port 3000
npm run build        # Production build with Vite
npm run clean        # Remove dist/
npm run deploy       # Build + deploy to Vercel
```

## Conventions

- Components use **vhtml JSX** syntax (not React)
- URL params: `?model=`, `?preset=`, `?cameraPosition=x,y,z`, `?kiosk=true`
- Styles in a single `style.css` file (no CSS modules)
- Code formatted with Prettier (tabs, single quotes, 100 print width)

## When Making Changes

1. Check the architecture map above to find the right file
2. `src/viewer.js` for anything Three.js / rendering / GUI controls
3. `src/validator.js` for validation logic or report display
4. `src/app.js` for file loading, URL params, or top-level orchestration
5. `src/components/` for UI templates (vhtml JSX, not React)
6. Run `npm run dev` to test changes at `http://localhost:3000`
