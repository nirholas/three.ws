# avatar-sources/ict-facekit: ARKit expression source (MIT)

Source of the 52 ARKit blendshapes on the reconstruction template's head (`workers/avatar-reconstruction/templates/parametric.glb`). Nothing here is served directly.

## Provenance and license

Vendored 2026-11-13 from [USC-ICT/ICT-FaceKit](https://github.com/USC-ICT/ICT-FaceKit) at commit `da5f95a607f5e6b37755b38d3385d7f2853732e5` by `python3 scripts/vendor-ict-facekit.py`. ICT-FaceKit is **MIT licensed**, Copyright (c) 2020 USC Institute for Creative Technologies. `LICENSE` and `CREDITS.md` are copied verbatim from upstream; keep them with any redistribution of these files or of anything derived from them (the `anny-targets/` set and the morph targets baked into `parametric.glb`).

Only the FaceXModel neutral mesh, its expression shapes and its index metadata are used. The upstream Python fitting code is not vendored.

## Contents

- `neutral.obj.gz`: `FaceXModel/generic_neutral_mesh.obj` positions and polygons (26,719 vertices, centimetres, Y up, facing +Z, `_L` is the character's left at +X). UVs and normals are dropped; the transfer does not use them.
- `expressions/<name>.delta.gz`: each of the 53 upstream expression OBJs stored as a sparse delta from the neutral, `vertex dx dy dz` lines in centimetres (deltas under 0.1 micron dropped). Lossless for every practical purpose and 5 MB instead of 143 MB.
- `vertex_indices.json`: upstream landmark and region indices, verbatim (`idx_to_landmark_verts` is the Multi-PIE 68-point set used as registration anchors).
- `anny-targets/<arkitName>.target.gz`: the 52 ARKit shapes transferred onto the CC0 Anny base mesh (`avatar-sources/anny`), in MakeHuman target format (`vertex dx dy dz`, decimetres, original `base.obj` vertex indices). These are what `scripts/build-reconstruction-template.mjs` bakes. `anny-targets/report.json` records the registration residual and per-shape stats of the last build.

## How the transfer works

`python3 scripts/build-ict-expression-targets.py [--preview <dir>]` (needs numpy and scipy, both in the reconstruction worker's requirements):

1. Similarity alignment from five anchors (eye centres, nose tip, visible mouth corners).
2. Non-rigid ICP pulls the ICT surface onto the Anny head, with the lip contact and eight eyelid-margin points per eye held as heavy constraints.
3. Each Anny head vertex reads the barycentric ICT delta at its closest registered point. Correspondence is class-restricted (upper vs lower lip, upper vs lower eyelid) because the lips touch at rest. Vertices the scan does not cover (the mouth cavity) take a harmonic fill from their covered neighbours, and every delta fades to zero before the head/body split.
4. Eyeballs take ICT's eyeball rotation about their own centre; teeth and tongue take ICT's teeth rigid transforms.

Naming follows ARKit: `_L`/`_R` become `Left`/`Right`, the `browInnerUp` and `cheekPuff` pairs merge into one shape each, and `tongueOut` (absent upstream) is synthesized as a third of `jawOpen` plus a forward tongue extension. `--preview` writes a software-rendered expression sheet for review.

Re-run the vendor script only to move to a newer upstream commit; re-run the transfer after any change to the Anny base mesh.
