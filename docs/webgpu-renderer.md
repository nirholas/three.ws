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

The harness loads `/restyle?bench` three ways (default, `?renderer=webgpu`, `?renderer=webgpu` with `navigator.gpu` removed) and reports backend, console errors, offscreen render time per frame, pixel difference and silhouette overlap against the default, and the rim effect. It exits non-zero on any console error or wrong fallback. Parity and timing use an offscreen render target with readback because headless software WebGPU cannot present to a canvas.

### Results (2026-10-24, software adapter)

Headless Chromium with SwiftShader, 384x512 target, 200 frames, same model. This is a software rasterizer, so it compares the two code paths and is not GPU hardware data. Run the command above on a machine with a GPU for hardware numbers.

| Case | Backend | Render ms/frame (2 runs) | Mean diff vs default | Silhouette overlap | Console errors |
| --- | --- | --- | --- | --- | --- |
| default | WebGL2 | 9.2, 10.9 | n/a | n/a | 0 |
| `?renderer=webgpu` | WebGPU | 12.8, 17.0 | 0.01 / 255 | 1.0 | 0 |
| `?renderer=webgpu`, GPU denied | WebGL2 (fallback) | 9.4, 10.1 | 0 / 255 | 1.0 | 0 |

The rim effect shifts the frame by 1.18 / 255 on both paths and the two paths agree on it to 0.02 / 255.
