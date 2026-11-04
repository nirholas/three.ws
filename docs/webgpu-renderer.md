# WebGPU renderer (opt-in)

three.ws ships on three r187. The classic WebGL2 renderer is still the default everywhere. WebGPU is strictly opt-in and always degrades to the same WebGL2 picture.

## Opting in

- Query string: `?renderer=webgpu` on `/restyle`, `/app` and any page that hosts `<agent-3d>`.
- Element attribute (read by `pagePreference(el)`): `<agent-3d renderer="webgpu">`. The attribute wins over the query string, so an embedder can pin `renderer="webgl"`. It is read once when the element boots: the backend is fixed for the life of the canvas.

Only the exact value `webgpu` opts in. The factory is [src/renderer-factory.js](../src/renderer-factory.js): `createAutoRenderer(options, { prefer, fallback })` returns `{ renderer, backend, reason }` and stamps `data-renderer` on the canvas. It falls back to the guarded WebGL2 path when `navigator.gpu` is missing, `requestAdapter()` resolves null or throws, `WebGPURenderer.init()` fails, or the node renderer lands on its own GL backend. Callers branch on `backend`, never on what was requested.

## Where it is wired

### Main viewer and `<agent-3d>`

`Viewer` keeps its synchronous constructor for the default WebGL2 path. WebGPU needs an async adapter and device, so the opt-in goes through `Viewer.create(el, options)` (or `Viewer.prepareRenderer(options)` followed by the constructor, which is what `/app` does so its sync `createViewer()` stays intact). `prepareRenderer` resolves to `null`, meaning "build WebGL2", whenever WebGPU was not requested, has no adapter, its modules fail to load, or the factory fell back. `<agent-3d>` always boots through `Viewer.create` with `rendererPreference: pagePreference(this)`.

On the WebGPU backend the viewer swaps three pieces and keeps everything else (loading, animation, framing, lights, annotations, the editor) on one code path:

| Piece | WebGL2 | WebGPU |
| --- | --- | --- |
| Cinematic post chain | `CinematicPipeline`, [src/viewer/cinematic.js](../src/viewer/cinematic.js) (postprocessing EffectComposer, N8AO) | `CinematicPipelineTSL`, [src/viewer/cinematic-tsl.js](../src/viewer/cinematic-tsl.js) (three `RenderPipeline`, GTAO, DoF and Bloom nodes) |
| Environment prefilter, light-probe bake | `PMREMGenerator`, `WebGLCubeRenderTarget` | the `three/webgpu` twins |
| Materials the node renderer cannot draw | unchanged | [src/render/webgpu-material-compat.js](../src/render/webgpu-material-compat.js) |

Both pipelines read the same presets ([src/viewer/cinematic-presets.js](../src/viewer/cinematic-presets.js)) and the Cinematic FX panel drives either one. The per-pixel grade (hue and saturation, brightness and contrast, radial chromatic aberration, overlay film grain, vignette) is the exact formula of the postprocessing shaders the WebGL chain runs; `tests/cinematic-tsl.test.js` pins the CPU-side mappings against the real effects. Bloom, depth of field and ambient occlusion are three's own TSL nodes with the preset values mapped onto their units, so the default Studio look matches and the heavier looks match in character. Effects that own render targets are only in the node graph while the active look uses them; switching them rebuilds the graph once, and sliders only write uniforms.

Material compatibility: WebGPURenderer converts every built-in material by itself. Hand-written GLSL `ShaderMaterial`s it cannot run. The one the viewer meets is three-vrm's `MToonMaterial`; the node port that three-vrm 3.5.x ships (`@pixiv/three-vrm/nodes`) imports TSL names three r187 removed, so on WebGPU MToon surfaces become `MeshToonMaterial` with the same colour, textures, emission and alpha, and the MToon outline pass is hidden. When three-vrm publishes a node build that loads on our three, swap the conversion for `MToonNodeMaterial`. Any other `ShaderMaterial` becomes a `MeshStandardMaterial` carrying its map and colour.

Lifecycle and the features that stay WebGL:

- Device loss: WebGPU has no context restore. A lost device swaps in a fresh canvas on WebGL2 (a canvas that ever held a WebGPU context can never get WebGL), rebuilds environments and the cinematic chain, rebinds controls, and fires `viewer-canvas-replaced` on the viewer's host element with `{ previous, canvas, backend }`. Scene Studio's transform gizmo and Magic Brush listen for it and move their pointer listeners.
- AR: WebXR needs a WebGL XR binding, so on WebGPU the viewer offers only the platform viewers (Scene Viewer, Quick Look). Pin `renderer="webgl"` on pages that need in-page WebXR.
- Photoreal stills (`renderPhotoreal`): three-gpu-pathtracer is WebGL2-only, so on WebGPU the path tracer runs on its own offscreen WebGL2 renderer sized to the canvas and is disposed when the still is done.

### Restyle Studio

[Restyle Studio](restyle.md) (`/restyle`) uses the factory. Its view-only Fresnel rim light lives in [src/restyle-effects.js](../src/restyle-effects.js):

- WebGL2: an `onBeforeCompile` GLSL patch on the glTF PBR materials.
- WebGPU: `MeshStandard/PhysicalNodeMaterial` with a TSL `emissiveNode` (`three/tsl`).

Node materials are not glTF-exportable, so on WebGPU every export goes through `withClassicMaterials`, which swaps the original classic materials back (carrying live edits) for the duration of the export. The exported GLB is identical on both paths and never contains the rim.

A renderer badge in the Restyle toolbar shows the backend in use. The Rim slider and color are in the same toolbar.

## Not ported, and why

- `three/examples` `GaussianSplat` is WebGPU-only. The viewer splat stage keeps Spark, which also runs on WebGL2 and so serves both backends from one code path.
- `three-mesh-bvh/webgpu` (pinned 0.9.17) accelerates GPU-side (compute) queries. The viewer's picking is CPU raycasting, which `three-mesh-bvh`'s CPU build already accelerates on both backends, so it does not apply.
- Path-traced photoreal stills stay on WebGL2 (see above) until three-gpu-pathtracer has a WebGPU backend.

## Measuring

```
npm run dev                      # or any server on another port
node scripts/renderer-bench.mjs --base http://localhost:3000 --frames 200
```

Both harnesses take `--adapter swiftshader|hardware`. `swiftshader` (the default) forces Chromium's software adapter so runs are reproducible anywhere. `hardware` drives the machine's real GPU through Vulkan and needs a GPU-capable host. Every run prints the WebGPU and WebGL2 adapters Chromium actually picked (`adapter=... webgpu="..." webgl2="..."`) and the `--json` output carries them as `adapter` and `adapterInfo`. The launcher lives in [scripts/lib/bench-browser.mjs](../scripts/lib/bench-browser.mjs).

The harness loads `/restyle?bench` three ways (default, `?renderer=webgpu`, `?renderer=webgpu` with `navigator.gpu` removed) and reports backend, console errors, offscreen render time per frame, pixel difference and silhouette overlap against the default, and the rim effect. It exits non-zero on any console error or wrong fallback. Parity and timing use an offscreen render target with readback because headless software WebGPU cannot present to a canvas.

### Results (2026-10-24, software adapter)

Headless Chromium with SwiftShader, 384x512 target, 200 frames, same model. This is a software rasterizer, so it compares the two code paths and is not GPU hardware data. Hardware numbers are in the 2026-11-04 section below.

| Case | Backend | Render ms/frame (2 runs) | Mean diff vs default | Silhouette overlap | Console errors |
| --- | --- | --- | --- | --- | --- |
| default | WebGL2 | 9.2, 10.9 | n/a | n/a | 0 |
| `?renderer=webgpu` | WebGPU | 12.8, 17.0 | 0.01 / 255 | 1.0 | 0 |
| `?renderer=webgpu`, GPU denied | WebGL2 (fallback) | 9.4, 10.1 | 0 / 255 | 1.0 | 0 |

The rim effect shifts the frame by 1.18 / 255 on both paths and the two paths agree on it to 0.02 / 255.

### Main viewer and `<agent-3d>`

```
node scripts/viewer-renderer-bench.mjs --base http://localhost:3000 --frames 60
```

The viewer harness loads `/app?bench` (default, `?renderer=webgpu`, `?renderer=webgpu` with `navigator.gpu` removed) and `public/agent-3d-renderer-harness.html` (`renderer="webgpu"`, and `renderer="webgl"` with `?renderer=webgpu` on the page to prove the attribute wins). Each case freezes clips to the rest pose, then reports backend, console errors, scene pass ms/frame, full cinematic frame ms/frame (EffectComposer on WebGL2, TSL RenderPipeline on WebGPU), and pixel parity against the default. Add `--shots` to save the captured frames and `--json` for machine output. It exits non-zero on any console error or wrong backend.

#### Results (2026-11-03, software adapter)

Headless Chromium with SwiftShader, 384x512 target, 60 frames, `/avatars/cz.glb`, on a heavily shared machine, so absolute times swing between runs (the scene pass ran 44 to 157 ms on WebGL2 across runs). Compare paths within one run and treat these as code path data, not GPU hardware data.

| Case | Backend | Scene ms/frame | Cinematic ms/frame | Mean diff vs default | Silhouette overlap | Console errors |
| --- | --- | --- | --- | --- | --- | --- |
| `/app` default | WebGL2 | 156.9 | 1277.5 | n/a | n/a | 0 |
| `/app?renderer=webgpu` | WebGPU | 163.2 | 219.3 | 2.28 / 255 | 0.956 | 0 |
| `/app?renderer=webgpu`, GPU denied | WebGL2 (fallback) | 284.5 | 1664.8 | 0.02 / 255 | 0.9995 | 0 |
| `<agent-3d renderer="webgpu">` | WebGPU | 270.8 | 115.2 | n/a | n/a | 0 |
| `<agent-3d renderer="webgl">` + `?renderer=webgpu` | WebGL2 | 174.2 | 802.8 | n/a | n/a | 0 |

An earlier 30-frame run of the same build measured the WebGPU case at 0.05 / 255 mean diff and 0.9986 silhouette overlap; the residual difference is a sub-pixel camera offset between page loads, not shading. The TSL cinematic chain is consistently several times cheaper than the WebGL2 EffectComposer chain on the software adapter.

### Results (2026-11-04, hardware: NVIDIA L4)

Google Compute Engine `g2-standard-8` with one NVIDIA L4 (us-east4-a), NVIDIA driver 580.178.04 server, headless Chromium 156 (`chromium` channel) through Vulkan, 384x512 target, 200 frames, 2 runs per case. The probe reported the NVIDIA adapter on both WebGPU and WebGL2 (ANGLE Vulkan) for every case. Commands:

```
node scripts/viewer-renderer-bench.mjs --base http://localhost:3000 --adapter hardware --frames 200
node scripts/renderer-bench.mjs --base http://localhost:3000 --adapter hardware --frames 200
```

Main viewer and `<agent-3d>` (`/avatars/cz.glb`):

| Case | Backend | Scene ms/frame | Cinematic ms/frame | Mean diff vs default | Silhouette overlap | Console errors |
| --- | --- | --- | --- | --- | --- | --- |
| `/app` default | WebGL2 | 0.44, 0.50 | 0.89, 1.11 | n/a | n/a | 0 |
| `/app?renderer=webgpu` | WebGPU | 0.44, 0.45 | 0.54, 0.55 | 0.01 / 255 | 1.0 | 0 |
| `/app?renderer=webgpu`, GPU denied | WebGL2 (fallback) | 0.44, 0.51 | 0.61, 1.08 | 0 / 255 | 1.0 | 0 |
| `<agent-3d renderer="webgpu">` | WebGPU | 0.25, 0.31 | 0.50, 0.52 | n/a | n/a | 0 |
| `<agent-3d renderer="webgl">` + `?renderer=webgpu` | WebGL2 | 0.36, 0.36 | 0.98, 1.13 | n/a | n/a | 0 |

Restyle (`/restyle?bench`):

| Case | Backend | Render ms/frame | Mean diff vs default | Silhouette overlap | Console errors |
| --- | --- | --- | --- | --- | --- |
| default | WebGL2 | 0.58, 0.59 | n/a | n/a | 0 |
| `?renderer=webgpu` | WebGPU | 0.39, 0.40 | 0 / 255 | 1.0 | 0 |
| `?renderer=webgpu`, GPU denied | WebGL2 (fallback) | 0.56, 0.61 | 0 / 255 | 1.0 | 0 |

The rim effect shifts the frame by 1.18 / 255 on both paths and the paths agree on it to 0.01 / 255. On real hardware the scene pass is equal or faster on WebGPU and the cinematic post chain runs about twice as fast as the WebGL2 EffectComposer chain, with pixel parity held.

Host setup for a headless Linux NVIDIA run: the GCE deeplearning images ship the compute-only driver, so install `libnvidia-gl-<driver>-server` and GLVND `libegl1`, confirm `vulkaninfo --summary` lists the GPU, and install the full Chromium build (`npx playwright install chromium`). The `hardware` adapter in [scripts/lib/bench-browser.mjs](../scripts/lib/bench-browser.mjs) passes `--use-vulkan=native --disable-vulkan-surface` and launches the `chromium` channel. Without them, headless Chromium falls back to SwiftShader for WebGPU.
