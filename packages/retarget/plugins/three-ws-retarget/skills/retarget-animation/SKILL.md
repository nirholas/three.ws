---
name: retarget-animation
description: Canonicalize humanoid bone names and retarget animation clips onto any rig with @three-ws/retarget, then play them with its crossfading AnimationManager. Use when an animation does not fit a GLB avatar.
---

# Retargeting with @three-ws/retarget

Maps bone names from Mixamo, Avaturn, VRM/VRoid, Daz/Genesis, MakeHuman, Unreal and Blender rigs onto one canonical skeleton, retargets canonical clips with rest-pose and hip-axis correction, and drives playback.

## Install

```
npm install @three-ws/retarget three
```

`three` 0.150 or newer is a peer dependency. ESM only.

## API

- `canonicalizeGLBBones(arrayBuffer)`: rewrites bone names inside a GLB in memory. Returns `{ buffer }`. Other helpers: `canonicalizeBoneName(name)`, `canonicalizeJointNodes(json)`, `canonicalizeArmatureOrientation(json)`, `CANONICAL_BONES`.
- `parseClipJSON(json, name)`: build an `AnimationClip` from a canonical clip JSON.
- `retargetClipToObject(clip, root, opts?)`: returns `{ clip, coverage, matched, total, dropped, hipScale, face }`. `clip` is `null` when bone coverage is below `MIN_COVERAGE` (0.5), meaning the model is not a humanoid. Handle that case instead of forcing playback.
- Lower level: `retargetClipToRig`, `retargetClip`, `canonicalNodeMapFromObject`, `hipRestHeight`, `scaleClipSpeed`.
- `AnimationManager`: `attach(root)`, `supportsCanonicalClips()`, `setAnimationDefs([{ name, url, loop }])`, `await loadAll()`, `crossfadeTo(name, seconds)`, `update(dt)` each frame.

## Example

```js
import { AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { canonicalizeGLBBones, retargetClipToObject, parseClipJSON } from '@three-ws/retarget';

const raw = await fetch('https://three.ws/avatars/xbot.glb').then((r) => r.arrayBuffer());
const { buffer } = canonicalizeGLBBones(raw);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(buffer, '');

const json = await fetch('https://three.ws/animations/clips/walk.json').then((r) => r.json());
const result = retargetClipToObject(parseClipJSON(json, 'walk'), gltf.scene);
if (result.clip) new AnimationMixer(gltf.scene).clipAction(result.clip).play();
else console.warn('not a humanoid', result.coverage, result.dropped);
```

three.ws GLBs are meshopt compressed, so the loader needs the meshopt decoder. The clip URLs above are served by three.ws with open CORS.
