# vendor/libheif

A WebAssembly build of [libheif](https://github.com/strukturag/libheif), as
packaged by [libheif-js](https://github.com/catdad-experiments/libheif-js).
`src/shared/forge-image-normalize.js` loads it from `/vendor/libheif/` to decode
iPhone HEIC photos dropped on /forge and Forge Studio when the browser cannot
decode HEIC itself (Chrome, Edge and Firefox; Safari decodes natively and never
fetches this file).

It is loaded lazily, only for a HEIC the browser could not open, so no other
page or photo pays for its 2 MB.

## Files

- `libheif-bundle.mjs`: byte-identical to `libheif-wasm/libheif-bundle.mjs` in
  `libheif-js` 1.23.5 (ES module, WebAssembly binary inlined).
  sha256 `095194187be00d3e36335b8ad7f5552d70655e5e2159486d7d36cd4daa47bba9`.
- `LICENSE`: the libheif license text shipped with that build (`libheif-wasm/LICENSE`).
- `LICENSE.libheif-js`: the libheif-js package license.

To update: install the new `libheif-js` in a scratch directory, copy
`libheif-wasm/libheif-bundle.mjs` and both license files here, update the version
and checksum above, and rerun the HEIC case of `scripts/forge-intake-verify.mjs`.

## License

libheif is licensed under the GNU Lesser General Public License, version 3
(LGPL-3.0). libheif-js is licensed under LGPL-3.0. The full texts are in
[LICENSE](LICENSE) and [LICENSE.libheif-js](LICENSE.libheif-js). The file is
served unmodified and loaded as a separate module, so it can be replaced with
any compatible build.

Corresponding source:

- libheif-js 1.23.5: https://github.com/catdad-experiments/libheif-js/tree/v1.23.5
- libheif: https://github.com/strukturag/libheif

These files are distributed under their own license above. The rest of this
repository is licensed as stated in the repository LICENSE.
