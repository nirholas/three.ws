---
name: avatar-stream
description: Pack, inspect, verify and stream A3S progressive 3D files with the a3s CLI and @three-ws/avatar-stream. Use when a GLB avatar should render from its first 50 KB and refine in place over HTTP byte-range requests.
---

# Avatar stream (A3S)

An A3S file is a static asset: layer 0 is a complete, skinned, spec-valid GLB, and later layers refine geometry, textures and animations. Any host that supports HTTP `Range` can serve it. No custom server.

Install: `npm install @three-ws/avatar-stream` (Node 18+, ESM). The CLI is `a3s`, so you can also run `npx -y -p @three-ws/avatar-stream a3s <command>`.

## CLI

```
a3s pack <input.glb> [-o out.a3s] [--levels 0.03,0.1,0.3,1] [--base-texture 64] [--json]
a3s inspect <file.a3s|url> [--json]
a3s verify  <file.a3s|url> [--deep] [--json]
a3s extract <file.a3s|url> [-o preview.glb]
a3s bench   <input.glb> [--connection slow-3g|fast-3g|4g] [--json]
```

- `pack` builds the stream. `--levels` are triangle-count fractions per layer.
- `inspect` prints each layer's bytes, triangles and the Range it needs.
- `verify` re-hashes every layer. `--deep` replays the stream and proves the refined surface equals the source triangle for triangle.
- `extract` writes layer 0 as a standalone GLB.
- `bench` estimates time-to-first-frame against a classic GLB fetch.

## Library

- `@three-ws/avatar-stream/node`: `pack(glbBytes, { levels, baseTextureSize, name })` returns `{ container, header, stats }`. Also `reconstruct`, `triangleCount`, `triangleFingerprint`, `verifyNesting`.
- `@three-ws/avatar-stream` (browser-safe): `A3SStream.open(urlOrBytes, { prefixBytes, verify })`, then `stream.base` (layer 0 GLB bytes), `stream.header`, `stream.layerCount`, `stream.bytesThroughLayer(n)`, `await stream.layer(n)`, `for await (const l of stream.layers())`. Also `bytesSource`, `httpSource`.
- `@three-ws/avatar-stream/three`: `A3SPlayer.load(target, { THREE, GLTFLoader, onLayer, configureLoader })` returns a player whose `scene` is ready immediately. `await player.refine()` applies the remaining layers in place. Pass `configureLoader` to install meshopt or draco decoders.

## Worked example

```bash
a3s pack avatar.glb -o avatar.a3s --levels 0.03,0.1,0.3,1
a3s verify avatar.a3s --deep
a3s inspect avatar.a3s
# upload avatar.a3s to any static host or CDN that honours Range
```

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { A3SPlayer } from '@three-ws/avatar-stream/three';

const player = await A3SPlayer.load('https://cdn.example.com/avatar.a3s', {
  THREE, GLTFLoader,
  onLayer: ({ level, triangleCount, bytes }) => console.log(level, triangleCount, bytes),
});
scene.add(player.scene);   // coarse avatar is already on screen
await player.refine();     // refine in place, layer by layer
```

## Guidance

- Serve with `Accept-Ranges` and permissive CORS if the page is on another origin.
- Run `a3s verify --deep` in CI after packing so a regression in a layer fails the build.
- `pack` reads meshopt and Draco compressed input itself, and the base layer never depends on either extension.
