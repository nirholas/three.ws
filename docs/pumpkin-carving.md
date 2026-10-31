# Pumpkin carving (/pumpkin)

A browser pumpkin carver. The pumpkin is a hollow, ribbed, real 3D shell and every cut is a boolean subtraction, so you can orbit the result, light the candle and see it shine through your design.

## How it works

- **Shell.** [src/pumpkin/geometry.js](../src/pumpkin/geometry.js) builds an indexed ribbed ellipsoid from an icosphere (ribs, squash and a dimple at each pole) and subtracts a copy scaled to 86% of it. The outer wall uses the `skin` material, the cavity uses `flesh`.
- **Cuts.** Each cut extrudes a shape (round, triangle, square, star, moon, bat) along the surface normal, 0.7 units deep so it clears the wall on both sides, and subtracts it with [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg). Walls a cut exposes take the cutter's `flesh` material, which is how the openings glow.
- **Knife.** Press and drag to lay a trail of round stamps (at most 70). They carve on release as one undo step.
- **Surface picking.** Pointer hits are tested against an invisible ellipsoid, not the carved mesh, so orientation stays stable once the mesh is full of holes.
- **Undo.** `carve()` never mutates its input; the page keeps up to 60 carved brushes and undo swaps one back in.
- **Persistence.** The cut log (up to 300 cuts) is saved in `localStorage` under `twx_pumpkin_v1` and replayed on load.
- **Export.** Save picture writes the canvas as PNG. Download GLB bakes the visible triangles (three-bvh-csg keeps spare capacity past `drawRange`) and writes a binary glTF with the stem, openable in the three.ws viewer.

## Files

| Path | Role |
| --- | --- |
| [pages/pumpkin.html](../pages/pumpkin.html) | Page shell, route `/pumpkin` |
| [src/pumpkin/page.js](../src/pumpkin/page.js) | Scene, input, history, candle, export |
| [src/pumpkin/geometry.js](../src/pumpkin/geometry.js) | DOM-free shell and carving |
| [src/pumpkin/pumpkin.css](../src/pumpkin/pumpkin.css) | Styles |
| [tests/pumpkin-carving.test.js](../tests/pumpkin-carving.test.js) | Volume, undo-safety and material checks |

## Notes

- three-bvh-csg 0.0.18 logs a `maxLeafSize` deprecation warning from three-mesh-bvh 0.9.x. It comes from the library and is harmless.
- Cutters are straight extrusions, so cut walls run along the surface normal, like a real carving.
