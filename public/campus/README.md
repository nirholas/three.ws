# Campus textures

PBR texture sets for the three.ws campus (`src/desktop/world/campus.js`): the
grass, paving, paths, walls, floors, rock and roofs the visitor walks on and
past. Every set is CC0 from [Poly Haven](https://polyhaven.com), resized to
1k and recompressed; `manifest.json` records the role, the real-world size of
one tile, the byte size and the source page of each set.

Rebuild (downloads the 1k JPGs, resizes with sharp, rewrites the manifest):

```
node scripts/build-campus-textures.mjs
```

The 3D props placed around the campus (desks, chairs, lamps, trees) stream at
runtime from the three.ws object library on R2, listed in
`src/desktop/world/props.js`; nothing from that library is checked in here.
