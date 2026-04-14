---
title: 3D Agent
description: 3D Agent is an open-source, browser-native 3D model viewer built on three.js. It renders glTF 2.0 and GLB files directly in WebGL. No plugins, no server uploads, no installs. Create your own models and agents or just open the site, drop a file, and inspect your model instantly. 
---

<video width="100%" height="auto" autoplay loop muted playsinline>
  <source src="public/skills.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

<p align="center">
  <a href="https://3d.irish"><strong>🌐 Live at 3d.irish</strong></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#-quickstart"><strong>Get Started</strong></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#-features"><strong>Features</strong></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#-tutorials"><strong>Tutorials</strong></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#-documentation"><strong>Docs</strong></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/nirholas/3d-agent/issues/new"><strong>Feedback</strong></a>
</p>

---

## 🧠 What is 3D Agent?

**3D Agent** is an open-source, browser-native 3D model viewer built on [three.js](https://threejs.org/) (r176). It renders **glTF 2.0** and **GLB** files directly in WebGL — no plugins, no server uploads, no installs. Just open [3d.irish](https://3d.irish), drop a file, and inspect your model instantly.

It's built for **3D artists** previewing exports, **game developers** debugging assets, **web developers** integrating models, and **anyone curious** about 3D on the web.

<br/>

---

<br/>

## ✨ Features

<br/>

<p align="center">
  <img src="assets/features.svg" width="650" height="320" alt="Features overview"/>
</p>

<br/>

### Full Feature Breakdown

| Category | What You Get |
|:---------|:-------------|
| **File Support** | `.glTF` and `.GLB` (glTF 2.0), with multi-file drag-and-drop (textures, bins) |
| **Compression** | Draco mesh compression, KTX2 texture compression, Meshopt decoder |
| **Lighting** | Ambient + directional lights, HDR environment maps (Venice Sunset, Footprint Court), neutral room environment, exposure & tone mapping (Linear / ACES Filmic) |
| **Display** | Wireframe overlay, skeleton visualization, grid + axes helpers, background color picker, auto-rotate, point size control |
| **Animation** | Full clip playback with per-clip toggle, playback speed control, play-all |
| **Morph Targets** | Real-time slider control for every morph target on every mesh |
| **Cameras** | Switch between default orbit camera and any cameras embedded in the glTF |
| **Validation** | Integrated [glTF-Validator](https://github.com/KhronosGroup/gltf-validator) — errors, warnings, hints, and info-level messages in a structured report |
| **Performance** | Live FPS/MS/MB stats panel via `stats.js` |
| **Deep Linking** | Load models via URL hash: `#model=url&preset=...&cameraPosition=x,y,z` |
| **Privacy** | 100% client-side — your files never leave your browser |

<br/>

---

<br/>

## 🚀 Quickstart

<br/>

<p align="center">
  <img src="assets/quickstart.svg" width="520" height="200" alt="Quickstart steps"/>
</p>

```bash
git clone https://github.com/nirholas/3d-agent.git
cd 3D
npm install
npm run dev
```

Open **http://localhost:3000** and drop any `.glb` or `.gltf` file onto the page.

<br/>

### Available Scripts

| Command | What It Does |
|:--------|:-------------|
| `npm run dev` | Starts Vite dev server on port 3000 with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run deploy` | Build + deploy to Vercel |
| `npm run clean` | Wipe the `dist/` directory |

<br/>

---

<br/>

## 🏗️ Architecture

<br/>

<p align="center">
  <img src="assets/architecture.svg" width="650" height="340" alt="Architecture diagram"/>
</p>

```
3D/
├── index.html              → Single-page app shell
├── style.css               → Dark theme + responsive layout
├── src/
│   ├── app.js              → Entry: dropzone, URL parsing, orchestration
│   ├── viewer.js           → Three.js renderer, scene, camera, GUI (dat.gui)
│   ├── validator.js        → glTF-Validator integration & report generation
│   ├── environments.js     → HDR environment map definitions
│   └── components/
│       ├── footer.jsx      → Social links (X, GitHub)
│       ├── validator-report.jsx   → Full validation report view
│       ├── validator-table.jsx    → Error/warning/hint tables
│       └── validator-toggle.jsx   → Collapsible validation summary bar
├── public/avatars/         → Default model assets
├── vercel.json             → Deployment + routing config
└── package.json            → Dependencies & scripts
```

<br/>

### Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Rendering** | [three.js](https://threejs.org/) r176 — WebGL 2.0 |
| **Model Loading** | `GLTFLoader` + `DRACOLoader` + `KTX2Loader` + `MeshoptDecoder` |
| **Controls** | `OrbitControls` — pan, zoom, rotate |
| **GUI** | [dat.gui](https://github.com/dataarts/dat.gui) — real-time parameter tweaking |
| **Validation** | [gltf-validator](https://github.com/KhronosGroup/gltf-validator) — Khronos spec compliance |
| **Templating** | [vhtml](https://github.com/developit/vhtml) — JSX → HTML string rendering |
| **Drag & Drop** | [simple-dropzone](https://github.com/donmccurdy/simple-dropzone) |
| **Build** | [Vite](https://vitejs.dev/) 5 — sub-second HMR |
| **Hosting** | [Vercel](https://vercel.com/) — edge CDN |

<br/>

---

<br/>

## 🔗 URL Parameters

Load models and configure the viewer directly via URL hash parameters. This is useful for embedding, sharing specific views, or automated testing.

```
https://3d.irish/#model=URL&kiosk=true&preset=assetgenerator&cameraPosition=1,2,3
```

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `model` | `string` | URL to a `.glb` or `.gltf` file to load on page open |
| `kiosk` | `boolean` | Hides the header and validation UI for clean embedding |
| `preset` | `string` | Set to `assetgenerator` for glTF asset generator testing mode |
| `cameraPosition` | `x,y,z` | Initial camera position as comma-separated floats |

**Example — embed a model in kiosk mode:**
```
https://3d.irish/#model=https://example.com/model.glb&kiosk=true
```

<br/>

---

<br/>

## 📖 Tutorials

<br/>

### 1. Preview a Local Model

<p align="center">
  <img src="assets/tutorial-steps.svg" width="500" height="80" alt="Step 1: Open 3d.irish · Step 2: Drop .glb file · Step 3: Inspect"/>
</p>

Just drag any `.glb` or `.gltf` file (along with its textures and `.bin` if separate) onto the page. The viewer auto-detects the root glTF file and resolves all relative resource URIs.

**Multi-file glTF?** Select _all_ the files (`.gltf` + `.bin` + textures) and drop them together. The viewer maps them by relative path, so your model loads correctly even with external resources.

<br/>

### 2. Tweak Lighting & Environment

The **Lighting** panel in the GUI sidebar gives you full control:

1. **Environment Map** — choose between `None`, `Neutral` (studio), `Venice Sunset` (warm), or `Footprint Court` (outdoor daylight)
2. **Tone Mapping** — switch between `Linear` (raw) and `ACES Filmic` (cinematic)
3. **Exposure** — slide from –10 to +10 to simulate camera exposure
4. **Ambient / Direct** — independently control intensity and color of ambient fill and key directional light
5. **Background** — toggle the environment map as the scene background, or pick a solid color

<br/>

### 3. Play & Control Animations

If your model has animation clips, the **Animation** panel appears automatically:

- Each clip gets its own checkbox — toggle individual animations on/off
- **Playback Speed** — slow down to 0 for freeze-frame or study
- **Play All** — fire every clip simultaneously

<br/>

### 4. Debug with Wireframe & Skeleton

Open the **Display** panel:

- **Wireframe** — see the mesh topology and triangle density
- **Skeleton** — visualize bones and joint hierarchy (great for rigging QA)
- **Grid** — ground plane + axes helper for spatial reference
- **Point Size** — if your model uses point clouds, control the render size

<br/>

### 5. Validate Your Model

Every model you load is automatically validated against the [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html). Click the validation bar at the bottom to expand a full report:

- **Errors** — spec violations that will likely cause rendering issues
- **Warnings** — non-fatal issues that may affect portability
- **Hints** — optimization suggestions
- **Info** — metadata (vertex count, draw calls, materials, extensions used)

<br/>

### 6. Embed in Your Own Site

Use an `<iframe>` with kiosk mode for clean embedding:

```html
<iframe
  src="https://3d.irish/#model=https://your-cdn.com/model.glb&kiosk=true"
  width="800"
  height="600"
  frameborder="0"
  allow="autoplay; fullscreen"
></iframe>
```

> **CORS note:** The model URL must allow cross-origin requests. If you hit CORS errors, serve the model from the same domain or configure your CDN to allow `https://3d.irish` as an origin.

<br/>

---

<br/>

## 💡 Ideas & Roadmap

<br/>

<p align="center">
  <img src="assets/roadmap.svg" width="650" height="260" alt="Roadmap"/>
</p>

- **AI Model Analysis** — describe meshes, materials, and suggest optimizations
- **Screenshot / Video Export** — capture PNGs or record animated WebM walkthroughs
- **Measurement Tools** — click two points to measure distances, angles, bounding boxes
- **Texture Inspector** — view individual texture channels (baseColor, normal, metallic-roughness, AO, emissive)
- **Side-by-Side Diff** — compare two versions of the same model
- **AR Quick Look** — launch your model in WebXR on supported devices
- **Scene Graph Explorer** — visual tree of all nodes, meshes, materials, and their properties
- **Material Editor** — tweak PBR params (roughness, metalness, colors) live in the viewport
- **Annotation System** — pin notes to specific vertices or mesh regions
- **File Format Expansion** — `.fbx`, `.obj`, `.usdz` import support
- **CLI Tool** — `npx 3d-agent inspect model.glb` for headless validation in CI/CD pipelines

<br/>

---

<br/>

## 🧪 Examples

<br/>

### Load the Khronos Sample Models

The glTF working group maintains a library of test models. Try these:

```
https://3d.irish/#model=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb
```

```
https://3d.irish/#model=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/FlightHelmet/glTF/FlightHelmet.gltf
```

```
https://3d.irish/#model=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb
```

### Use the JavaScript API (Advanced)

The viewer exposes its internals on `window.VIEWER` for debugging:

```javascript
// Access the loaded glTF JSON
console.log(window.VIEWER.json);

// Access the Three.js scene graph
console.log(window.VIEWER.scene);

// Traverse all meshes
window.VIEWER.scene.traverse((node) => {
  if (node.isMesh) {
    console.log(node.name, node.geometry.attributes);
  }
});
```

### Custom Environment Maps

Add your own HDR environments by editing `src/environments.js`:

```javascript
{
  id: 'my-studio',
  name: 'My Studio',
  path: 'https://your-cdn.com/studio_1k.exr',
  format: '.exr',
}
```

The viewer uses `EXRLoader` + `PMREMGenerator` to process equirectangular HDR maps into prefiltered environment cubemaps.

<br/>

---

<br/>

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and test locally with `npm run dev`
4. Submit a pull request

File issues and feature requests at [github.com/nirholas/3d-agent/issues](https://github.com/nirholas/3d-agent/issues).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

<br/>

---

<br/>

## 📖 Documentation

For deeper technical detail, see the `docs/` directory:

| Document | Description |
|:---------|:------------|
| **[Architecture](docs/ARCHITECTURE.md)** | Data flow, module responsibilities, Three.js setup, validation pipeline, GUI structure, styling architecture, and security considerations |
| **[API Reference](docs/API.md)** | Complete reference for all classes (`App`, `Viewer`, `Validator`), methods, properties, state objects, components, and the `window.VIEWER` debugging API |
| **[Deployment](docs/DEPLOYMENT.md)** | Build pipeline, Vercel deploy, routing, CORS config, custom domains, iframe embedding, self-hosting (nginx, Docker), CDN strategy, and troubleshooting |
| **[Development](docs/DEVELOPMENT.md)** | Local setup, code style, how-things-work guide, common tasks (new GUI controls, components, environments), debugging techniques, browser compatibility, and performance notes |
| **[Contributing](CONTRIBUTING.md)** | Bug reporting, feature requests, PR workflow, commit conventions, code guidelines, and testing checklist |

<br/>

---

<br/>

## 📚 Resources

| Resource | Link |
|:---------|:-----|
| **glTF 2.0 Spec** | [registry.khronos.org/glTF](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| **Sample Models** | [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) |
| **three.js Docs** | [threejs.org/docs](https://threejs.org/docs/) |
| **GLTFLoader** | [three.js GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader) |
| **glTF Validator** | [KhronosGroup/gltf-validator](https://github.com/KhronosGroup/gltf-validator) |
| **Sketchfab** | [sketchfab.com](https://sketchfab.com/) — download free glTF models |
| **Mixamo** | [mixamo.com](https://www.mixamo.com/) — free rigged & animated characters |
| **Poly Haven** | [polyhaven.com](https://polyhaven.com/) — free HDRIs, textures, and 3D models |

<br/>

---

<br/>

<p align="center">
  <img src="assets/footer-banner.svg" width="400" height="60" alt="Built by nirholas"/>
</p>

<p align="center">
  <sub>MIT License · Made with three.js · Hosted on Vercel</sub>
</p>
