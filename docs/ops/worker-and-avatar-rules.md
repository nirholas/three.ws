# Worker and avatar rules

Rules for agents touching Python model workers or avatar animation. CLAUDE.md links here so the base context stays small; read this before editing either area.

## Shared worker code is vendored

Each worker's Docker build context is its own directory, so `../` is unreachable. Shared modules (`worker_security.py`, `oin.py`, `oin_upload.py`, `gltf_meshopt.py`, `test_gltf_meshopt.py`) therefore live as a byte-identical copy inside every worker that needs them.

1. Fix the canonical copy.
2. Mirror it to every worker that vendors it.
3. Rerun `npm run check:vendored` (`scripts/check-vendored-workers.mjs`, wired into `npm run gate`). It prints the exact `cp` command for each drifted copy.

## Caller-supplied glTF is meshopt-decoded before it is read

Most three.ws avatars ship with `EXT_meshopt_compression`, which trimesh cannot decode. A worker that loads a caller's mesh must route it through `gltf_meshopt.decode_if_meshopt` first (stylize, remesh, texture, segment and rig already do) and ship the pinned `gltfpack` binary in its image. A new mesh-consuming worker inherits that requirement.

## Avatar animation is universal: no rig allowlist

Any humanoid avatar drives the pre-baked clip library. `src/glb-canonicalize.js` maps its bone names (Mixamo, Avaturn, Unreal, VRM/VRoid, VRM 1.0, Daz/Genesis, MakeHuman, Blender `.L`, simple `shoulderL` rigs) to the canonical set, and `src/animation-retarget.js` retargets idle/walk onto them, legs included.

- A rig that genuinely cannot be skeleton-driven (no skin, non-humanoid prop) falls back to the default rig (the `AnimationManager.supportsCanonicalClips()` gate), never a bind-pose T-pose.
- Hit a new skeleton convention? Add its bone-name mapping to `glb-canonicalize.js` and cover it with a case in `tests/glb-canonicalize.test.js`. Do not hardcode a curated rig list.
