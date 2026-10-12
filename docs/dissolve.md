# Dissolve

`/dissolve` turns any glTF/GLB model into a storm of GPU particles (65k, 262k or 1M), morphs one shape into another, and lets you bend the storm with forces.

## How it works

1. `shape.js` samples the model surface in world space (skinned meshes included), area-weighted, and reads texture, vertex or material colour per sample.
2. Both shapes are Morton-sorted over a shared stage box, so particle `i` of A pairs with particle `i` of B and the morph stays spatially coherent.
3. `engine.js` keeps position and velocity in float textures and runs two ping-pong passes per frame. Points render straight from those textures.
4. Forces: black hole (with jets past the horizon), vortex, up to four shockwaves, collapse (gravity and a bouncing floor). The microphone adds bass and mid energy.

## Controls

| Key | Action |
| --- | --- |
| Space | Morph A to B and back |
| 1 to 4 | Orbit, black hole, vortex, shockwave |
| S | Swap A and B |
| C | Collapse |
| B | Detonate |
| M | Microphone |
| P | PNG snapshot |
| R | Record a clip |
| H | Hide or show the dock |

Drop a `.glb` onto the stage to load it into B (hold Shift for A). Quality (Lite, Standard, Ultra) is remembered, and the page offers Lite if frames run slow.

## Share links

`/dissolve?a=agent&b=fox&p=storm&q=standard`. `a` and `b` are shelf ids or https GLB URLs. Files from your device cannot travel in a link.

## Privacy

The microphone is opt-in, analysed in the browser as three band levels, and never recorded or uploaded.
