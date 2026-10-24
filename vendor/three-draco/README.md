# vendor/three-draco

`draco_encoder.js` from three.js r184 (`examples/jsm/libs/draco/`), Google Draco, Apache-2.0.

three r186 dropped the file from the npm package, but Scene Studio (`pages/scene.html`) loads
`/three/draco/draco_encoder.js` to compress exported scenes. `scripts/copy-three-decoders.mjs`
copies this file into `public/three/draco/` after it copies the decoders from `node_modules/three`.
Replace it only with a newer Draco encoder build, never by deleting it while Scene Studio uses it.
