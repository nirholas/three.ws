# src/render: shared rendering kit for standalone three.js pages

`src/viewer.js` (behind `<agent-3d>`) has a full image pipeline. Pages that build their own `WebGLRenderer` did not: no image-based light (metal renders black, PBR reads as clay), no tone curve, loops that run forever in background tabs, and a blank canvas after a GPU reset. This kit gives every such page the same baseline the best viewers ship (model-viewer, drei `<Stage>`, Sketchfab, the Babylon sandbox) in two calls.

```js
import { applyStudioLook, createRenderLoop } from '../render/index.js';

const renderer = new WebGLRenderer({ antialias: true });
const undoLook = applyStudioLook(renderer, scene, { environmentIntensity: 0.8 });

const loop = createRenderLoop({
	renderer,
	frame: (dt) => {
		mixer?.update(dt);
		renderer.render(scene, camera);
	},
	onPixelRatioChange: () => composer?.setSize(width, height),
});
loop.start();

// teardown
loop.dispose();
undoLook();
```

## `applyStudioLook(renderer, scene?, opts?)`

| Option                 | Default | Meaning |
| ---------------------- | ------- | ------- |
| `toneMapping`          | keep the page's curve, else `'neutral'` | `'neutral'` (Khronos PBR Neutral), `'agx'`, `'aces'`, `'none'`, or a three.js constant |
| `exposure`             | unchanged | `renderer.toneMappingExposure` |
| `environment`          | `true`  | `true` = shared studio room (PMREM `RoomEnvironment`), a `Texture` = your own, `false` = none |
| `environmentIntensity` | `1`     | `scene.environmentIntensity`; lower it (0.4 to 0.8) when the page keeps strong direct lights |
| `maxPixelRatio`        | `2`     | caps `setPixelRatio`; `false` leaves it alone |

Returns an undo function that clears the scene's environment and releases the shared texture. The studio environment is generated once per renderer and reference counted, so several scenes drawn by one renderer share one GPU texture. After a lost-and-restored WebGL context it is rebuilt and reassigned automatically.

Stylised scenes made only of `MeshBasicMaterial`, points or lines gain nothing from the environment; pass `environment: false`, or `toneMapping: 'none'` if a tone curve would shift a hand-picked palette.

## `createRenderLoop(opts)`

A `requestAnimationFrame` loop that:

- pauses while the tab is hidden or the canvas (or `opts.observe`) is offscreen;
- starts at full resolution and adapts the pixel ratio to the frame rate the GPU actually sustains (`createFrameGovernor`; `adaptive: false` to opt out), calling `onPixelRatioChange(ratio)` so composers and render targets can follow;
- on `webglcontextlost` pauses, shows a short status notice over the canvas, and on `webglcontextrestored` calls `onContextRestored()` and resumes;
- passes `frame(dt, now)` a delta clamped to 1/15 s so a pause never teleports an animation.

Returns `{ start, stop, dispose, running, pixelRatio }`.

## `createFrameGovernor(opts)`

The pure, DOM-free controller behind the adaptive pixel ratio. Averages frame times over a window, steps the ratio down below `lowFps` (45) and up at `highFps` (57) with a cooldown, ignores gaps longer than 250 ms (background tabs, GC pauses), and settles on the lower ratio after `maxFlips` reversals so it never oscillates. Tested in `tests/render-kit.test.js`.

WebGL only: `three/webgpu` renderers have their own PMREM path.
