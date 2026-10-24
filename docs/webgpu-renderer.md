# WebGPU renderer (opt-in)

three.ws ships on three r186. The classic WebGL2 renderer is still the default everywhere. WebGPU is strictly opt-in and always degrades to the same WebGL2 picture.

## Opting in

- Query string: `/restyle?renderer=webgpu`
- Element attribute (read by `pagePreference(el)`): `renderer="webgpu"`. The attribute wins over the query string, so an embedder can pin `renderer="webgl"`.

Only the exact value `webgpu` opts in. The factory is [src/renderer-factory.js](../src/renderer-factory.js): `createAutoRenderer(options, { prefer, fallback })` returns `{ renderer, backend, reason }` and stamps `data-renderer` on the canvas. It falls back to the guarded WebGL2 path when `navigator.gpu` is missing, `requestAdapter()` resolves null or throws, `WebGPURenderer.init()` fails, or the node renderer lands on its own GL backend. Callers branch on `backend`, never on what was requested.

## Where it is wired

[Restyle Studio](restyle.md) (`/restyle`) uses the factory. Its view-only Fresnel rim light lives in [src/restyle-effects.js](../src/restyle-effects.js):

- WebGL2: an `onBeforeCompile` GLSL patch on the glTF PBR materials.
- WebGPU: `MeshStandard/PhysicalNodeMaterial` with a TSL `emissiveNode` (`three/tsl`).

Node materials are not glTF-exportable, so on WebGPU every export goes through `withClassicMaterials`, which swaps the original classic materials back (carrying live edits) for the duration of the export. The exported GLB is identical on both paths and never contains the rim.

A renderer badge in the Restyle toolbar shows the backend in use. The Rim slider and color are in the same toolbar.

## Not ported, and why

- The main viewer and `<agent-3d>` still use `CinematicPipeline` (EffectComposer), which is WebGL-only. The factory and the `renderer` attribute parser are ready, but the viewer is not switched until its post-processing moves to TSL.
- `three/examples` `GaussianSplat` is WebGPU-only. The viewer splat stage keeps Spark, which also runs on WebGL2.
- `three-mesh-bvh/webgpu` (pinned 0.9.16) accelerates GPU-side queries. The viewer's picking is CPU raycasting, so it does not apply.

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
