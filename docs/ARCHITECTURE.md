# Architecture

This document provides a deep technical overview of how three.ws is structured, how data flows through the system, and how each module fulfills its responsibilities.

---

## High-Level Overview

three.ws is a single-page application (SPA) that runs entirely in the browser. There is no backend server — all model parsing, rendering, and validation happens client-side using WebGL 2.0.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│  index.html                                                  │
│    ├── style.css          (all styles)                       │
│    └── src/app.js         (ES module entry point)            │
│          ├── Viewer       (Three.js scene, renderer, GUI)    │
│          │    └── environments.js  (HDR map registry)        │
│          ├── Validator    (glTF spec validation)             │
│          │    ├── ValidatorToggle   (status bar)             │
│          │    ├── ValidatorReport   (full report)            │
│          │    └── ValidatorTable    (issue tables)           │
│          └── Footer       (social links)                     │
│                                                              │
│  public/avatars/cz.glb   (default model)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Application Boot

```
DOMContentLoaded
  └─► new App(document.body, location)
        ├─► Parse URL hash parameters (model, kiosk, preset, cameraPosition)
        ├─► Create SimpleDropzone (drag-and-drop handler)
        ├─► Create Validator instance
        └─► Load default model (hash `model` param, or `/avatars/cz.glb`)
              └─► this.view(modelURL, '', new Map())
```

### 2. Model Loading (via URL)

```
App.view(rootFile, rootPath, fileMap)
  ├─► Create Viewer if not already created
  ├─► Generate blob URL (if File object) or use string URL directly
  └─► Viewer.load(fileURL, rootPath, fileMap)
        ├─► Configure MANAGER.setURLModifier() for blob URL resolution
        ├─► GLTFLoader.load()
        │     ├─► DRACOLoader (if Draco compressed)
        │     ├─► KTX2Loader  (if KTX2 textures)
        │     └─► MeshoptDecoder (if meshopt compressed)
        ├─► Viewer.setContent(scene, clips)
        │     ├─► Compute bounding box, center model
        │     ├─► Position camera based on model size
        │     ├─► Detect embedded lights (disable punctual if found)
        │     ├─► Set up AnimationMixer with clips
        │     ├─► Update GUI folders (animations, morph targets, cameras)
        │     └─► Apply lighting, environment, display settings
        └─► Validator.validate(fileURL, rootPath, fileMap, gltf)
              ├─► Fetch model as ArrayBuffer
              ├─► validateBytes() from gltf-validator
              ├─► Categorize issues by severity
              └─► Render toggle bar + bind click → lightbox report
```

### 3. Model Loading (via Drag-and-Drop)

```
User drops files onto page
  └─► SimpleDropzone 'drop' event
        └─► App.load(fileMap: Map<string, File>)
              ├─► Find root .gltf/.glb file in the fileset
              ├─► Extract rootPath (directory prefix)
              └─► App.view(rootFile, rootPath, fileMap)
                    └─► (same flow as URL loading above)
```

### 4. Multi-File Resolution

When a user drops a multi-file glTF (e.g., `scene.gltf` + `scene.bin` + textures), the `Viewer.load()` method installs a URL modifier on the Three.js `LoadingManager`:

```javascript
MANAGER.setURLModifier((url, path) => {
	const normalizedURL =
		rootPath +
		decodeURI(url)
			.replace(baseURL, '')
			.replace(/^(\.?\/)/, '');

	if (assetMap.has(normalizedURL)) {
		const blob = assetMap.get(normalizedURL);
		return URL.createObjectURL(blob); // Serve from local blob
	}

	return (path || '') + url; // Fall back to network fetch
});
```

This intercepts every resource request from GLTFLoader and serves matching files from the user's dropped fileset as blob URLs, avoiding any server round-trips.

### 5. Render Loop

```
requestAnimationFrame(this.animate)
  └─► animate(time)
        ├─► controls.update()       (OrbitControls)
        ├─► stats.update()          (FPS/MS counter)
        ├─► mixer.update(dt)        (AnimationMixer)
        └─► render()
              ├─► renderer.render(scene, activeCamera)   (main viewport)
              └─► axesRenderer.render(axesScene, axesCamera)  (axes helper)
```

---

## Module Reference

### `App` — `src/app.js`

The application controller. Creates the dropzone, viewer, and validator. Routes user interactions.

| Method                              | Description                                                 |
| ----------------------------------- | ----------------------------------------------------------- |
| `constructor(el, location)`         | Parses hash params, sets up dropzone, loads initial model   |
| `createDropzone()`                  | Binds SimpleDropzone to `.wrap` element and `#file-input`   |
| `createViewer()`                    | Instantiates `Viewer` on first model load                   |
| `load(fileMap)`                     | Finds root glTF/GLB in a dropped fileset and calls `view()` |
| `view(rootFile, rootPath, fileMap)` | Passes model to `Viewer.load()` and `Validator.validate()`  |
| `onError(error)`                    | Normalizes error messages and shows `window.alert()`        |
| `showSpinner()` / `hideSpinner()`   | Toggle loading indicator visibility                         |

### `Viewer` — `src/viewer.js`

The Three.js rendering engine. Manages the full 3D pipeline: scene, camera, renderer, lights, environment, controls, animations, and GUI.

See [API Reference](API.md#viewer) for the complete method listing.

### `Validator` — `src/validator.js`

Runs the Khronos glTF-Validator against loaded models and renders results.

See [API Reference](API.md#validator) for the complete method listing.

### `environments` — `src/environments.js`

Exports a flat array of environment map definitions:

```javascript
[
	{ id: '', name: 'None', path: null },
	{ id: 'neutral', name: 'Neutral', path: null },
	{ id: 'venice-sunset', name: 'Venice Sunset', path: '...1k.exr' },
	{ id: 'footprint-court', name: 'Footprint Court', path: '...2k.exr' },
];
```

- `id: ''` — no environment map applied
- `id: 'neutral'` — uses `THREE.RoomEnvironment` (procedural, no network fetch)
- All others — fetched via `EXRLoader` and processed through `PMREMGenerator`

### Components — `src/components/`

All components use [vhtml](https://github.com/developit/vhtml) — a JSX-compatible library that outputs plain HTML strings (no virtual DOM, no reactivity).

| Component         | File                   | Description                                                |
| ----------------- | ---------------------- | ---------------------------------------------------------- |
| `Footer`          | `footer.jsx`           | Social links (X/Twitter, GitHub) and feedback link         |
| `ValidatorToggle` | `validator-toggle.jsx` | Status bar with severity color and dismiss button          |
| `ValidatorReport` | `validator-report.jsx` | Full report with metadata, stats, extensions, issue tables |
| `ValidatorTable`  | `validator-table.jsx`  | Color-coded table of issues (code, message, JSON pointer)  |

---

## Three.js Setup Details

### Renderer

```javascript
new WebGLRenderer({ antialias: true })
	.setClearColor(0xcccccc)
	.setPixelRatio(window.devicePixelRatio)
	.setSize(el.clientWidth, el.clientHeight);
```

### Camera

- **Default camera:** `PerspectiveCamera(60°, aspect, 0.01, 1000)`
- **Asset generator preset:** `PerspectiveCamera(0.8 * 180/π ≈ 45.8°, ...)`
- Near/far planes are dynamically adjusted based on model bounding box size
- Embedded glTF cameras can be selected; they disable OrbitControls

### Lights

When the model does **not** contain embedded lights (`state.punctualLights = true`):

| Light       | Type               | Default Intensity | Position                    |
| ----------- | ------------------ | ----------------- | --------------------------- |
| Ambient     | `AmbientLight`     | 0.3               | Attached to camera          |
| Directional | `DirectionalLight` | 0.8π ≈ 2.51       | `(0.5, 0, 0.866)` on camera |

When the model **does** contain lights, punctual lights are disabled and the model's own lights are used.

Asset generator preset uses a single `HemisphereLight` instead.

### Loaders

| Loader           | CDN Source                                                     | Purpose                                  |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `GLTFLoader`     | Bundled (three.js)                                             | Core glTF 2.0 parser                     |
| `DRACOLoader`    | `unpkg.com/three@0.{REVISION}.x/examples/jsm/libs/draco/gltf/` | Draco mesh decompression                 |
| `KTX2Loader`     | `unpkg.com/three@0.{REVISION}.x/examples/jsm/libs/basis/`      | KTX2/Basis Universal texture transcoding |
| `MeshoptDecoder` | Bundled (three.js)                                             | Meshopt compression decoding             |

All loaders are shared singleton instances to avoid redundant initialization.

### Caching

`THREE.Cache.enabled = true` — enables the built-in three.js HTTP request cache, preventing duplicate fetches for shared resources (textures referenced by multiple materials, etc.).

---

## Validation Pipeline

```
Validator.validate(fileURL, rootPath, assetMap, gltfResponse)
  │
  ├─► fetch(fileURL) → ArrayBuffer
  │
  ├─► validateBytes(Uint8Array, { externalResourceFunction })
  │     │
  │     └─► For each external URI:
  │           resolveExternalResource(uri, rootFile, rootPath, assetMap)
  │             ├─► Check assetMap (dropped files) → blob URL
  │             └─► Fall back to network fetch
  │
  ├─► setReport(report, response)
  │     ├─► Determine maxSeverity (0=Error, 1=Warning, 2=Info, 3=Hint)
  │     ├─► Split messages into errors[], warnings[], infos[], hints[]
  │     ├─► Aggregate repetitive messages (ACCESSOR_NON_UNIT, etc.)
  │     ├─► Extract asset.extras metadata (author, license, source, title)
  │     └─► Render ValidatorToggle HTML
  │
  └─► Bind click → open ValidatorReport in new tab
```

### Severity Levels

| Level | Color  | CSS Class | Meaning                     |
| ----- | ------ | --------- | --------------------------- |
| 0     | Red    | `level-0` | Errors — spec violations    |
| 1     | Yellow | `level-1` | Warnings — potential issues |
| 2     | Blue   | —         | Informational notes         |
| 3     | Green  | —         | Optimization hints          |

### Message Aggregation

Certain high-frequency validation messages (like `ACCESSOR_NON_UNIT` appearing thousands of times for vertex normals) are aggregated into a single summary message with a count, to keep reports readable.

---

## GUI Structure (dat.gui)

The dat.gui panel is built programmatically in `Viewer.addGUI()`:

```
dat.gui
├── Display/
│   ├── background          (boolean)
│   ├── autoRotate          (boolean)
│   ├── wireframe           (boolean)
│   ├── skeleton            (boolean)
│   ├── grid                (boolean)
│   ├── screenSpacePanning  (boolean)
│   ├── pointSize           (number: 1–16)
│   └── bgColor             (color)
│
├── Lighting/
│   ├── environment         (dropdown: None/Neutral/Venice Sunset/Footprint Court)
│   ├── toneMapping         (dropdown: Linear/ACES Filmic)
│   ├── exposure            (number: -10–10)
│   ├── punctualLights      (boolean, listen)
│   ├── ambientIntensity    (number: 0–2)
│   ├── ambientColor        (color)
│   ├── directIntensity     (number: 0–4)
│   └── directColor         (color)
│
├── Animation/              (hidden if no clips)
│   ├── playbackSpeed       (number: 0–1)
│   ├── playAll             (button)
│   └── [per-clip toggles]  (boolean, dynamic)
│
├── Morph Targets/          (hidden if no morphs)
│   └── [per-mesh per-target sliders]  (number: 0–1, dynamic)
│
├── Cameras/                (hidden if no embedded cameras)
│   └── camera              (dropdown: [default] + glTF camera names)
│
└── Performance/
    └── stats.js panel      (FPS / MS / MB)
```

Dynamic folders (Animation, Morph Targets, Cameras) have their controls rebuilt every time a new model loads via `Viewer.updateGUI()`.

---

## Styling Architecture

All styles live in a single `style.css` file with clearly delineated sections:

| Section             | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| Base reset          | `html, body` reset, dark background, Inter font                     |
| Layout              | Flexbox column: header → main (viewer + dropzone)                   |
| Viewer              | Full-bleed canvas container                                         |
| Axes                | Fixed 100×100 px overlay, bottom-left, `pointer-events: none`       |
| Header              | Sticky top bar, blur backdrop, 3.5rem height                        |
| GUI wrap            | Absolute positioning, right side, `pointer-events: none` on wrapper |
| dat.gui overrides   | Dark theme: `#0a0a0a` backgrounds, subtle borders                   |
| Responsive (≤700px) | Collapsed header, hidden drop hint, 65vw max GUI width              |
| Footer              | Absolute bottom-right, monospace, low opacity                       |
| Upload button       | Custom file input styling                                           |
| Validation report   | Tables, toggle bar, severity colors                                 |
| Spinner             | CSS-only pulsing circle animation                                   |

### Safe Area Support

The layout respects iOS safe areas via `env(safe-area-inset-*)` for notch/home-indicator clearance on the header, footer, and dropzone.

---

## Security Considerations

- **No server uploads** — files are read via the File API and rendered locally
- **Blob URL lifecycle** — all `URL.createObjectURL()` calls are paired with `URL.revokeObjectURL()` in cleanup callbacks
- **HTML escaping** — the validator escapes HTML in asset metadata via `escapeHTML()` before rendering, then applies `linkify()` to convert URLs to `<a>` tags
- **CORS** — the `cors.json` configuration restricts cross-origin access to known domains
- **CSP** — no inline scripts; the entry point uses `<script defer type="module">`
